/**
 * Analyse asynchrone — `lancer()` (transition + pose du job) et `executer()` (corps exécuté par le
 * worker BullMQ, `processeur-analyse-reprise.ts`). Sur succès TOTAL (au moins une table
 * exploitable), génère AUSSI le plan et transitionne le dossier jusqu'à `plan_propose` DANS LA
 * MÊME transaction que l'écriture de l'analyse — « le système génère le plan », § tête de contrat.
 *
 * Un job qui ÉCHOUE (archive illisible, moteur non reconnu, exception inattendue) NE LAISSE PAS le
 * dossier bloqué en `analyse_en_cours` : toute erreur rencontrée PENDANT la lecture de l'archive
 * est capturée ICI et transcrite en `reprise_analyse.statut = 'echouee'` +
 * `dossier_reprise.statut = 'analyse_echouee'` — le job BullMQ se termine alors normalement (pas
 * de retry), l'utilisateur relance explicitement via `POST .../analyses`. Seule une mort du
 * PROCESSUS worker (SIGKILL, OOM) échappe à ce filet : `ProcesseurAnalyseReprise` pose en plus un
 * filet de sécurité sur l'événement `failed` de BullMQ (tentatives épuisées) qui fait la même
 * transition, défensivement.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type {
  AnomalieAnalyseReprise,
  FichierArchiveReprise,
  MoteurSourceDetecte,
  ReponseAnalyseReprise,
  TableDetecteeReprise,
  TypeFichierArchiveReprise,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import { ErreurMetier } from '../../common/erreurs';

import { JETON_LECTEUR_ARCHIVE_REPRISE, JETON_STOCKAGE_ARCHIVE_REPRISE } from '../reprise.jetons';
import { NOM_FILE_ANALYSE_REPRISE, NOM_JOB_ANALYSE_REPRISE } from '../reprise.jetons';
import {
  ErreurLimiteExtractionDepassee,
  type PortLecteurArchiveReprise,
} from '../lecture/port-lecteur-archive-reprise';
import type { PortStockageArchiveReprise } from '../depot/stockage-archive-reprise';
import { type LigneRepriseAnalyseBrute, projeterAnalyseReprise } from '../db-reprise.types';
import { ServiceCycleVieDossierReprise } from '../service-cycle-vie-dossier-reprise';
import { ServicePlanReprise } from '../plan/service-plan-reprise';
import { projeterFichierArchive, projeterTableDetectee } from './projection-analyse-reprise';

function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

const journal = new Logger('ServiceAnalyseReprise');

@Injectable()
export class ServiceAnalyseReprise {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_STOCKAGE_ARCHIVE_REPRISE) private readonly stockage: PortStockageArchiveReprise,
    @Inject(JETON_LECTEUR_ARCHIVE_REPRISE) private readonly lecteur: PortLecteurArchiveReprise,
    @InjectQueue(NOM_FILE_ANALYSE_REPRISE) private readonly file: Queue,
    private readonly cycleVie: ServiceCycleVieDossierReprise,
    private readonly servicePlan: ServicePlanReprise,
  ) {}

  /** `POST /reprise/dossiers/{id}/analyses` — lance ou relance. */
  async lancer(ctx: ContexteTenant, dossierId: string): Promise<void> {
    await this.acces.enTenant(ctx, async (tx) => {
      const id = randomUUID();
      await tx.execute(sql`
        delete from public.reprise_analyse where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);
      await tx.execute(sql`
        insert into public.reprise_analyse
          (id, tenant_id, dossier_reprise_id, statut, demarree_le)
        values (${id}, ${ctx.tenantId}, ${dossierId}, 'en_cours', now())
      `);
      await this.cycleVie.transiter(tx, ctx.tenantId, dossierId, 'analyse_en_cours');
    });

    await this.file.add(
      NOM_JOB_ANALYSE_REPRISE,
      { tenantId: ctx.tenantId, dossierRepriseId: dossierId },
      { jobId: dossierId, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  }

  async lire(ctx: ContexteTenant, dossierId: string): Promise<ReponseAnalyseReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneRepriseAnalyseBrute>(sql`
        select *, demarree_le::text as demarree_le, terminee_le::text as terminee_le
          from public.reprise_analyse
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);
      const ligne = resultat.rows[0];
      if (ligne === undefined) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Aucune analyse pour le dossier ${dossierId}.`,
        );
      }
      return projeterAnalyseReprise(ligne);
    });
  }

  /** Corps exécuté par `ProcesseurAnalyseReprise`. */
  async executer(ctx: ContexteTenant, dossierId: string): Promise<void> {
    await this.acces.enTenant(ctx, async (tx) => {
      const dossier = await this.cycleVie.ligneBrute(tx, ctx.tenantId, dossierId);

      let moteurDetecte: MoteurSourceDetecte;
      const fichiers: FichierArchiveReprise[] = [];
      const tables: TableDetecteeReprise[] = [];
      let anomalies: AnomalieAnalyseReprise[] = [];
      let partielle = false;
      let echecTotal = false;
      const tablesRattacheesParIndex = new Set<string>();
      // Nettoyé dans le `finally` ci-dessous, succès ou échec — voir « PURGE DU RÉPERTOIRE
      // D'EXTRACTION » (`lecture/adaptateur-lecteur-archive-reprise.ts`, en-tête de fichier).
      // `undefined` tant que l'extraction elle-même n'a pas produit de répertoire (rien à purger
      // dans ce cas — un échec DANS `extraireEtInventorier` nettoie déjà son propre résidu).
      let repertoireExtrait: string | undefined;

      try {
        const cheminArchive = await this.stockage.cheminAbsoluArchive(dossier.stockage_chemin);
        const { repertoire, fichiers: fichiersSource } =
          await this.lecteur.extraireEtInventorier(cheminArchive);
        repertoireExtrait = repertoire;
        const familleResultat = await this.lecteur.detecterFamille(repertoire);
        moteurDetecte = {
          // Déjà le type du contrat (`FamilleMoteurSourceReprise`) : la conversion depuis le
          // vocabulaire interne de `lecteurs/` se fait dans l'adaptateur, pas ici — voir l'en-tête
          // de `lecture/port-lecteur-archive-reprise.ts`.
          famille: familleResultat.famille,
          indiceConfiance: familleResultat.famille === 'inconnu' ? 0 : 80,
          donnees: {
            fichiersPertinents: familleResultat.fichiersPertinents,
            raison: familleResultat.raison,
          },
        };

        if (fichiersSource.length === 0) {
          echecTotal = true;
        }

        for (const fichierSource of fichiersSource) {
          if (!fichierSource.lisible) {
            anomalies.push({
              type: 'fichier_illisible',
              fichierChemin: fichierSource.chemin,
              tableDetecteeId: null,
              gravite: 'bloquante',
            });
            partielle = true;
            fichiers.push({ ...projeterFichierArchive(fichierSource), type: 'inconnu' });
            continue;
          }

          let nomsTables: readonly string[] = [];
          try {
            nomsTables = await this.lecteur.listerTables(
              fichierSource.chemin,
              familleResultat.famille,
            );
          } catch (erreur) {
            anomalies.push({
              type: 'fichier_illisible',
              fichierChemin: fichierSource.chemin,
              tableDetecteeId: null,
              gravite: 'bloquante',
              donnees: { message: messageErreur(erreur) },
            });
            partielle = true;
            fichiers.push({ ...projeterFichierArchive(fichierSource), type: 'inconnu' });
            continue;
          }

          const type: TypeFichierArchiveReprise = nomsTables.length > 0 ? 'base_donnees' : 'ignore';
          fichiers.push({ ...projeterFichierArchive(fichierSource), type });

          for (const nomTable of nomsTables) {
            try {
              const rapport = await this.lecteur.evaluerRole(
                fichierSource.chemin,
                familleResultat.famille,
                nomTable,
              );
              const profils = await this.lecteur.profilerColonnes(
                fichierSource.chemin,
                familleResultat.famille,
                nomTable,
              );
              const detectee = projeterTableDetectee(fichierSource.chemin, rapport, profils);
              tables.push(detectee);

              if (detectee.roleDeduit === 'index_documents_scannes') {
                const liens = await this.lecteur.detecterLiens(
                  fichierSource.chemin,
                  familleResultat.famille,
                  nomTable,
                );
                if (liens.some((l) => l.tauxAppariement > 0)) {
                  tablesRattacheesParIndex.add(detectee.id);
                }
              }
            } catch (erreur) {
              anomalies.push({
                type: 'fichier_illisible',
                fichierChemin: fichierSource.chemin,
                tableDetecteeId: null,
                gravite: 'bloquante',
                donnees: { table: nomTable, message: messageErreur(erreur) },
              });
              partielle = true;
            }
          }
        }

        if (tables.length === 0) echecTotal = true;
      } catch (erreur) {
        echecTotal = true;
        moteurDetecte = { famille: 'inconnu', indiceConfiance: 0 };
        anomalies =
          erreur instanceof ErreurLimiteExtractionDepassee
            ? [
                // Anomalie DÉDIÉE, distincte de la corruption générique — le garagiste a déposé
                // le fichier de son ancien logiciel, jamais parlé de « bombe zip »/« ratio de
                // compression » (finding sécurité, vocabulaire garagiste). `donnees` reste un sac
                // STRUCTURÉ (doctrine de tête de `contrats/reprise.ts`), jamais un texte affiché
                // tel quel.
                {
                  type: 'archive_volume_extrait_excessif',
                  fichierChemin: null,
                  tableDetecteeId: null,
                  gravite: 'bloquante',
                  donnees: {
                    limiteType: erreur.type,
                    mesure: erreur.mesure,
                    limite: erreur.limite,
                  },
                },
              ]
            : [
                {
                  type: 'archive_partiellement_corrompue',
                  fichierChemin: null,
                  tableDetecteeId: null,
                  gravite: 'bloquante',
                  donnees: { message: messageErreur(erreur) },
                },
              ];
      } finally {
        if (repertoireExtrait) {
          await this.lecteur.purgerRepertoireExtrait(repertoireExtrait).catch((erreurPurge) => {
            journal.warn(
              `Nettoyage du répertoire d'extraction en échec (dossier ${dossierId}) : ${messageErreur(erreurPurge)}`,
            );
          });
        }
      }

      const statutFinal = echecTotal ? 'echouee' : 'terminee';

      await tx.execute(sql`
        update public.reprise_analyse
           set statut = ${statutFinal}, partielle = ${partielle && !echecTotal},
               moteur_detecte = ${JSON.stringify(moteurDetecte)}::jsonb,
               fichiers = ${JSON.stringify(fichiers)}::jsonb,
               tables = ${JSON.stringify(tables)}::jsonb,
               anomalies = ${JSON.stringify(anomalies)}::jsonb,
               terminee_le = now()
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);

      if (echecTotal) {
        await this.cycleVie.transiter(tx, ctx.tenantId, dossierId, 'analyse_echouee');
        return;
      }

      await this.cycleVie.transiter(tx, ctx.tenantId, dossierId, 'analyse_terminee');

      const analyseLigne = await tx.execute<{ readonly id: string }>(sql`
        select id from public.reprise_analyse
         where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);
      const analyseId = analyseLigne.rows[0]!.id;

      await this.servicePlan.genererDepuisAnalyseDansTransaction(
        tx,
        ctx.tenantId,
        dossierId,
        analyseId,
        tables,
        tablesRattacheesParIndex,
      );
    });
  }

  /**
   * Filet de sécurité — appelé par `ProcesseurAnalyseReprise` sur l'événement BullMQ `failed`
   * (tentatives épuisées ou mort du process worker). Idempotent : si le dossier a déjà été
   * transitionné par `executer()` avant que le process ne meure, la transition est un no-op
   * silencieux (guard `transitionAutorisee`, pas de double échec signalé).
   */
  async marquerEchecDefensif(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
  ): Promise<void> {
    const dossier = await this.cycleVie.ligneBrute(tx, tenantId, dossierId);
    if (dossier.statut !== 'analyse_en_cours') return;
    await tx.execute(sql`
      update public.reprise_analyse
         set statut = 'echouee', terminee_le = now(),
             anomalies = anomalies || ${JSON.stringify([
               {
                 type: 'archive_partiellement_corrompue',
                 fichierChemin: null,
                 tableDetecteeId: null,
                 gravite: 'bloquante',
                 donnees: { message: 'Le worker a échoué sans marquer de résultat.' },
               },
             ])}::jsonb
       where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
    `);
    await this.cycleVie.transiter(tx, tenantId, dossierId, 'analyse_echouee');
  }
}
