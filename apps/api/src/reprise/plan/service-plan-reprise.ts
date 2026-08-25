/**
 * Plan de reprise proposé — génération (appelée par le worker d'analyse, DANS sa transaction),
 * lecture, ajustement (`PATCH`, le seul levier client), et validation (`POST .../valider`, qui
 * déclenche l'import DANS LE MÊME GESTE — voir `contrats/reprise.ts`).
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type {
  ElementPlanReprise,
  EntreeModificationPlanReprise,
  ReponsePlanReprise,
  TableDetecteeReprise,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import {
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
  JETON_IDEMPOTENCE,
} from '../../common/idempotence';

import { type LigneReprisePlanBrute, projeterPlanReprise } from '../db-reprise.types';
import { NOM_FILE_IMPORT_REPRISE, NOM_JOB_IMPORT_REPRISE } from '../reprise.jetons';
import { ServiceCycleVieDossierReprise } from '../service-cycle-vie-dossier-reprise';
import { genererPlanDepuisTables } from './generation-plan-reprise';

export interface DonneesJobImportReprise {
  readonly tenantId: string;
  readonly dossierRepriseId: string;
}

async function lireLignePlan(
  tx: TransactionDfa,
  tenantId: string,
  dossierId: string,
): Promise<LigneReprisePlanBrute | null> {
  const resultat = await tx.execute<LigneReprisePlanBrute>(sql`
    select *, propose_le::text as propose_le, valide_le::text as valide_le
      from public.reprise_plan
     where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
  `);
  return resultat.rows[0] ?? null;
}

function exigerLignePlan(
  ligne: LigneReprisePlanBrute | null,
  dossierId: string,
): LigneReprisePlanBrute {
  if (ligne === null) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Aucun plan de reprise pour le dossier ${dossierId}.`,
    );
  }
  return ligne;
}

@Injectable()
export class ServicePlanReprise {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @InjectQueue(NOM_FILE_IMPORT_REPRISE) private readonly fileImport: Queue,
    private readonly cycleVie: ServiceCycleVieDossierReprise,
  ) {}

  /**
   * Appelée par le WORKER D'ANALYSE, dans SA transaction : génère le plan et transitionne le
   * dossier `analyse_terminee -> plan_propose` — les deux ou rien (transition automatique, § tête
   * de contrat : « le système génère le plan »).
   */
  async genererDepuisAnalyseDansTransaction(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
    analyseId: string,
    tables: readonly TableDetecteeReprise[],
    tablesRattacheesParIndex: ReadonlySet<string>,
  ): Promise<void> {
    const { elements, exclusions } = genererPlanDepuisTables(tables, tablesRattacheesParIndex);
    const id = randomUUID();

    await tx.execute(sql`
      insert into public.reprise_plan
        (id, tenant_id, dossier_reprise_id, analyse_id, statut, elements, exclusions)
      values
        (${id}, ${tenantId}, ${dossierId}, ${analyseId}, 'propose',
         ${JSON.stringify(elements)}::jsonb, ${JSON.stringify(exclusions)}::jsonb)
    `);

    await this.cycleVie.transiter(tx, tenantId, dossierId, 'plan_propose');
  }

  async lire(ctx: ContexteTenant, dossierId: string): Promise<ReponsePlanReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = exigerLignePlan(await lireLignePlan(tx, ctx.tenantId, dossierId), dossierId);
      return projeterPlanReprise(ligne);
    });
  }

  async ajuster(
    ctx: ContexteTenant,
    dossierId: string,
    entree: EntreeModificationPlanReprise,
  ): Promise<ReponsePlanReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = exigerLignePlan(await lireLignePlan(tx, ctx.tenantId, dossierId), dossierId);
      if (ligne.statut !== 'propose') {
        throw new ErreurMetier(
          'REPRISE_PLAN_NON_VALIDABLE',
          `Ajustement refusé : plan du dossier ${dossierId} au statut « ${ligne.statut} » (attendu propose).`,
        );
      }

      const elementsParId = new Map(ligne.elements.map((e) => [e.id, e]));
      for (const ajustement of entree.ajustements) {
        if (!elementsParId.has(ajustement.elementId)) {
          throw new ErreurMetier(
            'REPRISE_AJUSTEMENT_ELEMENT_INCONNU',
            `Élément de plan ${ajustement.elementId} absent du plan courant du dossier ${dossierId}.`,
          );
        }
      }

      const parAjustementId = new Map(entree.ajustements.map((a) => [a.elementId, a.inclus]));
      const elements: ElementPlanReprise[] = ligne.elements.map((e) =>
        parAjustementId.has(e.id) ? { ...e, inclus: parAjustementId.get(e.id)! } : e,
      );

      const resultat = await tx.execute<LigneReprisePlanBrute>(sql`
        update public.reprise_plan set elements = ${JSON.stringify(elements)}::jsonb
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
        returning *, propose_le::text as propose_le, valide_le::text as valide_le
      `);
      return projeterPlanReprise(resultat.rows[0]!);
    });
  }

  async valider(
    ctx: ContexteTenant,
    dossierId: string,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponsePlanReprise }>> {
    if (ctx.utilisateurId === null) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        'ServicePlanReprise.valider exige un utilisateur authentifié.',
      );
    }
    const utilisateurId = ctx.utilisateurId;

    const resultat = await this.idempotence.executer<
      ReponseMemorisable & { corps: ReponsePlanReprise }
    >(
      ctx,
      {
        methode: 'POST',
        chemin: '/reprise/dossiers/{id}/plan/valider',
        cle: cleIdempotence,
        corps: { dossierId },
      },
      async (tx) => {
        const ligne = exigerLignePlan(await lireLignePlan(tx, ctx.tenantId, dossierId), dossierId);
        if (ligne.statut !== 'propose') {
          throw new ErreurMetier(
            'REPRISE_PLAN_NON_VALIDABLE',
            `Validation refusée : plan du dossier ${dossierId} au statut « ${ligne.statut} » (attendu propose).`,
          );
        }

        const resultatMaj = await tx.execute<LigneReprisePlanBrute>(sql`
          update public.reprise_plan
             set statut = 'valide', valide_le = now(), valide_par_utilisateur_id = ${utilisateurId}
           where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
          returning *, propose_le::text as propose_le, valide_le::text as valide_le
        `);
        const planValide = resultatMaj.rows[0]!;

        await this.cycleVie.transiter(tx, ctx.tenantId, dossierId, 'plan_valide');
        await this.cycleVie.transiter(tx, ctx.tenantId, dossierId, 'import_en_cours');

        const elementsInclus = (planValide.elements as readonly ElementPlanReprise[]).filter(
          (e) => e.inclus,
        );
        const volumeTotal = elementsInclus.reduce((somme, e) => somme + e.volumeAttenduLignes, 0);

        const importId = randomUUID();
        await tx.execute(sql`
          insert into public.reprise_import
            (id, tenant_id, dossier_reprise_id, plan_id, statut, elements_total, tentative)
          values
            (${importId}, ${ctx.tenantId}, ${dossierId}, ${planValide.id}, 'en_attente', ${volumeTotal}, 1)
        `);

        void importId; // insérée ci-dessus ; identifiant retrouvé par le worker via dossierRepriseId
        return { statutHttp: 200, corps: projeterPlanReprise(planValide) };
      },
    );

    if (!resultat.rejoue) {
      const donneesJob: DonneesJobImportReprise = {
        tenantId: ctx.tenantId,
        dossierRepriseId: dossierId,
      };
      await this.fileImport.add(NOM_JOB_IMPORT_REPRISE, donneesJob, {
        jobId: dossierId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
    }
    return resultat;
  }
}
