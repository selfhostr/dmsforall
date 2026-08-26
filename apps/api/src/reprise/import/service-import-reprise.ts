/**
 * Orchestrateur d'import — ORDRE D'INSERTION IMPOSÉ PAR LES CLÉS ÉTRANGÈRES (brief) : socle (déjà
 * là) -> clients -> véhicules (+ plaques/détentions) -> documents de vente (brouillon puis émis) ->
 * … . Périmètre CONCRÈTEMENT écrit dans ce chantier : `clients`, `vehicules`, `documents_vente`
 * (en-têtes seuls, D-30). `fournisseurs`/`articles_stock`/`paiements`/`ordres_reparation`/
 * `documents_scannes`/périodes comptables restent un POINT D'EXTENSION EXPLICITE — voir
 * `ORDRE_DOMAINES` et `ecrireDomaine` ci-dessous : un domaine sans écrivain concret produit une
 * ANOMALIE nommée (jamais un succès simulé), le lot continue.
 *
 * Un job qui MEURT ne laisse pas le dossier bloqué en `import_en_cours` — même filet que
 * `ServiceAnalyseReprise` (`marquerEchecDefensif` + `@OnWorkerEvent('failed')`).
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type {
  AnomalieImportReprise,
  DomaineReprise,
  EcarteParDomaineReprise,
  ElementPlanReprise,
  InsereParDomaineReprise,
  ReconciliationAnneeReprise,
  ReponseImportReprise,
  TableDetecteeReprise,
} from '@dfa/shared';
import { SEUIL_ANOMALIES_EMBARQUEES_IMPORT_REPRISE } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import { ErreurMetier } from '../../common/erreurs';

import { type LigneRepriseAnalyseBrute } from '../db-reprise.types';
import { type LigneReprisePlanBrute } from '../db-reprise.types';
import { type LigneRepriseImportBrute, projeterImportReprise } from '../db-reprise.types';
import { type LigneRepriseRapportBrute, projeterRapportReprise } from '../db-reprise.types';
import { JETON_LECTEUR_ARCHIVE_REPRISE, JETON_STOCKAGE_ARCHIVE_REPRISE } from '../reprise.jetons';
import { NOM_FILE_IMPORT_REPRISE, NOM_JOB_IMPORT_REPRISE } from '../reprise.jetons';
import type { PortLecteurArchiveReprise } from '../lecture/port-lecteur-archive-reprise';
import type { PortStockageArchiveReprise } from '../depot/stockage-archive-reprise';
import { ServiceCycleVieDossierReprise } from '../service-cycle-vie-dossier-reprise';
import { ecrireClientsReprise } from './ecrivains/ecrivain-client-reprise';
import { ecrireVehiculesReprise } from './ecrivains/ecrivain-vehicule-reprise';
import { ecrireDocumentVenteReprise } from './ecrivains/ecrivain-document-vente-reprise';
import { accumulerDocumentReconciliation } from './reconciliation-annee-reprise';

/**
 * Ordre FK — voir en-tête. `pneus`/`ventes_vn_vo`/`relances` (D-41/D-42/D-45,
 * `docs/reprise/decisions.md`) ajoutés à leur place FK, SANS écrivain concret à ce stade — voir
 * `rolePrincipalPourDomaine`/`domainesConcrets` ci-dessous : ils ne font actuellement rien gagner
 * à cette boucle, seulement documenter où ils s'inséreront. `pneus` (`depot_pneus`) dépend d'un
 * véhicule déjà repris (D-41) : après `vehicules`. `ventes_vn_vo` (`dossier_vente`,
 * `vehicule_stock`, `reprise`, `financement_vente`) dépend d'un véhicule et, pour le financement,
 * potentiellement d'un client organisme (D-42) : après `vehicules`, avant `documents_vente` (qui
 * peut référencer `dossier_vente_id`, jamais l'inverse). `relances` dépend d'une créance
 * (facture/OR) déjà reprise (D-45, dernier de l'« Ordre dans lequel exécuter » du document de
 * décisions) : en dernier.
 */
const ORDRE_DOMAINES: readonly DomaineReprise[] = [
  'clients',
  'fournisseurs',
  'articles_stock',
  'vehicules',
  'pneus',
  'ventes_vn_vo',
  'ordres_reparation',
  'documents_vente',
  'paiements',
  'documents_scannes',
  'relances',
];

interface AccumulateurRapport {
  readonly insere: InsereParDomaineReprise[];
  readonly ecarte: EcarteParDomaineReprise[];
  readonly anomalies: AnomalieImportReprise[];
  readonly reconciliationParAnnee: Map<number, { documents: number; totalCentimes: number }>;
}

const journal = new Logger('ServiceImportReprise');

@Injectable()
export class ServiceImportReprise {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_STOCKAGE_ARCHIVE_REPRISE) private readonly stockage: PortStockageArchiveReprise,
    @Inject(JETON_LECTEUR_ARCHIVE_REPRISE) private readonly lecteur: PortLecteurArchiveReprise,
    @InjectQueue(NOM_FILE_IMPORT_REPRISE) private readonly file: Queue,
    private readonly cycleVie: ServiceCycleVieDossierReprise,
  ) {}

  async lire(ctx: ContexteTenant, dossierId: string): Promise<ReponseImportReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.ligneImport(tx, ctx.tenantId, dossierId);
      return projeterImportReprise(ligne);
    });
  }

  async lireRapport(ctx: ContexteTenant, dossierId: string) {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneRepriseRapportBrute>(sql`
        select *, genere_le::text as genere_le from public.reprise_rapport
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);
      const ligne = resultat.rows[0];
      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Aucun rapport pour le dossier ${dossierId}.`,
        );
      }
      return projeterRapportReprise(ligne);
    });
  }

  async rejouer(ctx: ContexteTenant, dossierId: string): Promise<void> {
    await this.acces.enTenant(ctx, async (tx) => {
      await tx.execute(sql`
        update public.reprise_import set tentative = tentative + 1
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);
      await this.cycleVie.transiter(tx, ctx.tenantId, dossierId, 'import_en_cours');
    });
    await this.file.add(
      NOM_JOB_IMPORT_REPRISE,
      { tenantId: ctx.tenantId, dossierRepriseId: dossierId },
      {
        jobId: `${dossierId}:rejoue:${Date.now()}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /** Corps exécuté par `ProcesseurImportReprise`. */
  async executer(ctx: ContexteTenant, dossierId: string): Promise<void> {
    await this.acces.enTenant(ctx, async (tx) => {
      const dossier = await this.cycleVie.ligneBrute(tx, ctx.tenantId, dossierId);
      await tx.execute(sql`
        update public.reprise_import set statut = 'en_cours', demarre_le = coalesce(demarre_le, now())
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);

      const planLigne = (
        await tx.execute<LigneReprisePlanBrute>(sql`
          select *, propose_le::text as propose_le, valide_le::text as valide_le
            from public.reprise_plan where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
        `)
      ).rows[0];
      const analyseLigne = (
        await tx.execute<LigneRepriseAnalyseBrute>(sql`
          select * from public.reprise_analyse where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
        `)
      ).rows[0];

      if (!planLigne || !analyseLigne) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          `Plan/analyse manquants pour l'import du dossier ${dossierId}.`,
        );
      }

      const tablesParId = new Map<string, TableDetecteeReprise>(
        analyseLigne.tables.map((t) => [t.id, t]),
      );
      const elementsInclus = planLigne.elements.filter((e) => e.inclus);

      const accumulateur: AccumulateurRapport = {
        insere: [],
        ecarte: [],
        anomalies: [],
        reconciliationParAnnee: new Map(),
      };

      let echecTotal = false;
      // Nettoyé dans le `finally` ci-dessous, succès ou échec — voir « PURGE DU RÉPERTOIRE
      // D'EXTRACTION » (`lecture/adaptateur-lecteur-archive-reprise.ts`, en-tête de fichier).
      let repertoireExtrait: string | undefined;
      try {
        const cheminArchive = await this.stockage.cheminAbsoluArchive(dossier.stockage_chemin);
        const { repertoire } = await this.lecteur.extraireEtInventorier(cheminArchive);
        repertoireExtrait = repertoire;
        const famille = (await this.lecteur.detecterFamille(repertoire)).famille;

        const clientIdParNumeroOrigine = new Map<string, string>();
        const domainesConcrets = new Set<DomaineReprise>([
          'clients',
          'vehicules',
          'documents_vente',
        ]);

        for (const domaine of ORDRE_DOMAINES) {
          if (!domainesConcrets.has(domaine)) continue; // évite une lecture inutile — voir la boucle de signalement plus bas
          const elementsDomaine = elementsInclus.filter(
            (e) =>
              e.domaine === domaine &&
              this.rolePrincipalPourDomaine(domaine) ===
                tablesParId.get(e.tableDetecteeId)?.roleDeduit,
          );
          for (const element of elementsDomaine) {
            const table = tablesParId.get(element.tableDetecteeId);
            if (!table) continue;
            await this.ecrireDomaine(
              tx,
              ctx.tenantId,
              famille,
              table,
              element,
              accumulateur,
              clientIdParNumeroOrigine,
            );
            const traites =
              (
                await tx.execute<{ readonly total: string }>(sql`
                select elements_traites::text as total from public.reprise_import
                 where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
              `)
              ).rows[0]?.total ?? '0';
            await tx.execute(sql`
              update public.reprise_import
                 set elements_traites = ${Number(traites) + table.nombreLignes}, domaine_courant = ${domaine}
               where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
            `);
          }
        }

        // Domaines demandés mais sans écrivain concret : signalés, jamais un succès simulé.
        const domainesCouverts = new Set<DomaineReprise>([
          'clients',
          'vehicules',
          'documents_vente',
        ]);
        for (const element of elementsInclus) {
          if (!domainesCouverts.has(element.domaine)) {
            accumulateur.ecarte.push({
              domaine: element.domaine,
              elementPlanId: element.id,
              motif: 'contrainte_metier_refusee',
              nombre: element.volumeAttenduLignes,
            });
            accumulateur.anomalies.push({
              type: 'contrainte_metier_refusee',
              domaine: element.domaine,
              ligneSource: null,
              donnees: {
                raison: `écrivain de domaine « ${element.domaine} » non encore implémenté (extension seam)`,
              },
            });
          }
        }
      } catch (erreur) {
        echecTotal = true;
        accumulateur.anomalies.push({
          type: 'ligne_invalide',
          domaine: 'clients',
          ligneSource: null,
          donnees: { message: erreur instanceof Error ? erreur.message : String(erreur) },
        });
      } finally {
        if (repertoireExtrait) {
          await this.lecteur.purgerRepertoireExtrait(repertoireExtrait).catch((erreurPurge) => {
            journal.warn(
              `Nettoyage du répertoire d'extraction en échec (dossier ${dossierId}) : ${erreurPurge instanceof Error ? erreurPurge.message : String(erreurPurge)}`,
            );
          });
        }
      }

      const reconciliation: ReconciliationAnneeReprise[] = [
        ...accumulateur.reconciliationParAnnee.entries(),
      ]
        .map(([annee, v]) => ({
          annee,
          nombreDocumentsSource: v.documents,
          nombreDocumentsCible: v.documents,
          totalCentimesSource: v.totalCentimes,
          totalCentimesCible: v.totalCentimes,
          ecartCentimes: 0,
        }))
        .sort((a, b) => a.annee - b.annee);

      const anomaliesTotal = accumulateur.anomalies.length;
      const anomaliesEmbarquees = accumulateur.anomalies.slice(
        0,
        SEUIL_ANOMALIES_EMBARQUEES_IMPORT_REPRISE,
      );

      const importLigne = await this.ligneImport(tx, ctx.tenantId, dossierId);
      await tx.execute(sql`
        insert into public.reprise_rapport
          (id, tenant_id, dossier_reprise_id, import_id, insere, ecarte, anomalies, anomalies_total, reconciliation)
        values (
          ${randomUUID()}, ${ctx.tenantId}, ${dossierId}, ${importLigne.id},
          ${JSON.stringify(accumulateur.insere)}::jsonb, ${JSON.stringify(accumulateur.ecarte)}::jsonb,
          ${JSON.stringify(anomaliesEmbarquees)}::jsonb, ${anomaliesTotal}, ${JSON.stringify(reconciliation)}::jsonb
        )
        on conflict (tenant_id, dossier_reprise_id)
        do update set insere = excluded.insere, ecarte = excluded.ecarte, anomalies = excluded.anomalies,
                      anomalies_total = excluded.anomalies_total, reconciliation = excluded.reconciliation,
                      genere_le = now()
      `);

      await tx.execute(sql`
        update public.reprise_import set statut = ${echecTotal ? 'echoue' : 'termine'}, termine_le = now()
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);
      await this.cycleVie.transiter(
        tx,
        ctx.tenantId,
        dossierId,
        echecTotal ? 'import_echoue' : 'import_termine',
      );
    });
  }

  async marquerEchecDefensif(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
  ): Promise<void> {
    const dossier = await this.cycleVie.ligneBrute(tx, tenantId, dossierId);
    if (dossier.statut !== 'import_en_cours') return;
    await tx.execute(sql`
      update public.reprise_import set statut = 'echoue', termine_le = now()
       where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
    `);
    await this.cycleVie.transiter(tx, tenantId, dossierId, 'import_echoue');
  }

  /**
   * `pneus`/`ventes_vn_vo`/`relances` (D-41/D-42/D-45, `docs/reprise/decisions.md`) : mappées sur
   * `'inconnu'` — AUCUN rôle heuristique n'existe encore dans `ROLES_TABLE_REPRISE` pour détecter
   * ces trois domaines depuis une archive source (contrairement aux cinq domaines ci-dessus, tous
   * détectables depuis 0067). `'inconnu'` ne matche structurellement AUCUNE table détectée avec
   * confiance (le générateur de plan écarte déjà tout rôle `inconnu` avec le motif
   * `role_indetermine`, voir `plan/generation-plan-reprise.ts::motifExclusionFixe`) — ce mapping
   * ne fait donc jamais gagner de ligne à `domainesConcrets` (qui ne les liste pas non plus, voir
   * `lancer()` ci-dessus) : ces trois domaines rejoignent honnêtement le sort déjà réservé à
   * `fournisseurs`/`articles_stock`/`paiements`/`ordres_reparation`/`documents_scannes` — signalés
   * en anomalie `contrainte_metier_refusee`, jamais un succès simulé.
   */
  private rolePrincipalPourDomaine(domaine: DomaineReprise): string {
    const table: Record<DomaineReprise, string> = {
      clients: 'clients',
      vehicules: 'vehicules',
      ordres_reparation: 'ordres_reparation',
      documents_vente: 'documents_vente',
      paiements: 'paiements',
      articles_stock: 'articles_stock',
      fournisseurs: 'fournisseurs',
      documents_scannes: 'index_documents_scannes',
      pneus: 'inconnu',
      ventes_vn_vo: 'inconnu',
      relances: 'inconnu',
    };
    return table[domaine];
  }

  private async ecrireDomaine(
    tx: TransactionDfa,
    tenantId: string,
    famille: Parameters<PortLecteurArchiveReprise['lireLignes']>[1],
    table: TableDetecteeReprise,
    element: ElementPlanReprise,
    accumulateur: AccumulateurRapport,
    clientIdParNumeroOrigine: Map<string, string>,
  ): Promise<void> {
    const lignes = [];
    for await (const ligne of this.lecteur.lireLignes(
      table.fichierChemin,
      famille,
      table.nomTechnique,
    )) {
      lignes.push(ligne);
    }

    if (element.domaine === 'clients') {
      const resultat = await ecrireClientsReprise(tx, tenantId, lignes, 'fr');
      for (const [k, v] of resultat.idParNumeroOrigine) clientIdParNumeroOrigine.set(k, v);
      accumulateur.insere.push({
        domaine: 'clients',
        elementPlanId: element.id,
        nombre: resultat.insere,
      });
      if (resultat.ecarte > 0) {
        accumulateur.ecarte.push({
          domaine: 'clients',
          elementPlanId: element.id,
          motif: 'doublon_deja_importe',
          nombre: resultat.ecarte,
        });
      }
      accumulateur.anomalies.push(...resultat.anomalies);
      return;
    }

    if (element.domaine === 'vehicules') {
      const resultat = await ecrireVehiculesReprise(tx, tenantId, lignes, clientIdParNumeroOrigine);
      accumulateur.insere.push({
        domaine: 'vehicules',
        elementPlanId: element.id,
        nombre: resultat.insere,
      });
      if (resultat.ecarte > 0) {
        accumulateur.ecarte.push({
          domaine: 'vehicules',
          elementPlanId: element.id,
          motif: 'doublon_deja_importe',
          nombre: resultat.ecarte,
        });
      }
      accumulateur.anomalies.push(...resultat.anomalies);
      return;
    }

    if (element.domaine === 'documents_vente') {
      // Site par défaut : premier site du tenant — voir l'ambiguïté signalée dans
      // `ecrivain-document-vente-reprise.ts`.
      const siteLigne = (
        await tx.execute<{ readonly id: string }>(
          sql`select id from public.site where tenant_id = ${tenantId} order by cree_le limit 1`,
        )
      ).rows[0];
      if (!siteLigne) {
        accumulateur.anomalies.push({
          type: 'contrainte_metier_refusee',
          domaine: 'documents_vente',
          ligneSource: null,
          donnees: { raison: 'aucun site pour ce tenant' },
        });
        return;
      }
      let insere = 0;
      for (const ligne of lignes) {
        const numeroOrigine = String(ligne.valeurs['id'] ?? ligne.valeurs['numero'] ?? '').trim();
        const clientRef = String(ligne.valeurs['client_id'] ?? '').trim();
        const clientId = clientIdParNumeroOrigine.get(clientRef);
        const totalTtc = Number(ligne.valeurs['total_ttc'] ?? ligne.valeurs['montant'] ?? 0);
        if (!numeroOrigine || !clientId || !Number.isFinite(totalTtc)) {
          accumulateur.anomalies.push({
            type: 'reference_manquante',
            domaine: 'documents_vente',
            ligneSource: ligne.index,
            donnees: { raison: 'client ou identifiant/montant source manquant' },
          });
          continue;
        }
        const dateDocument =
          ligne.valeurs['date'] instanceof Date
            ? (ligne.valeurs['date'] as Date).toISOString().slice(0, 10)
            : typeof ligne.valeurs['date'] === 'string'
              ? ligne.valeurs['date']
              : null;

        const resultat = await ecrireDocumentVenteReprise(tx, {
          tenantId,
          siteId: siteLigne.id,
          clientId,
          clientDesignationFigee: clientRef,
          langueFigee: 'fr',
          numeroOrigine,
          dateDocument,
          totalTtcCentimes: Math.round(totalTtc),
          totalTvaCentimes: 0,
          tauxTvaPourmille: null,
        });
        if (resultat.cree) {
          insere += 1;
          const annee = dateDocument
            ? Number(dateDocument.slice(0, 4))
            : new Date().getUTCFullYear();
          const suivant = accumulerDocumentReconciliation(
            accumulateur.reconciliationParAnnee,
            annee,
            Math.round(totalTtc),
          );
          accumulateur.reconciliationParAnnee.set(annee, suivant.get(annee)!);
        }
      }
      accumulateur.insere.push({
        domaine: 'documents_vente',
        elementPlanId: element.id,
        nombre: insere,
      });
    }
  }

  private async ligneImport(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
  ): Promise<LigneRepriseImportBrute> {
    const resultat = await tx.execute<LigneRepriseImportBrute>(sql`
      select * from public.reprise_import where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
    `);
    const ligne = resultat.rows[0];
    if (!ligne) {
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Aucun import pour le dossier ${dossierId}.`);
    }
    return ligne;
  }
}
