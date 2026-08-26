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
import { creerCedeurEventLoop } from '../../common/concurrence';

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

  /**
   * Corps exécuté par `ProcesseurAnalyseReprise`. DEUX transactions COURTES, jamais une seule
   * transaction tenue ouverte pendant l'extraction/profilage (défaut réel du 25.08.2026, § tête de
   * fichier) :
   *   1. lecture rapide de `dossier_reprise.stockage_chemin` ;
   *   2. extraction + reconnaissance de famille + classification de rôle + profilage — TRAVAIL
   *      CPU/DISQUE PUR (`this.lecteur.*`), potentiellement plusieurs minutes sur une grosse
   *      archive (2+ Go réels mesurés), HORS de toute connexion Postgres ;
   *   3. écriture du résultat + transition(s) + génération du plan, à nouveau dans une transaction
   *      courte.
   *
   * POURQUOI l'ancienne structure (une seule transaction pour tout) faisait tomber TOUTE l'API,
   * pas seulement ce dossier : `acces-base.service.ts` pose `idle_in_transaction_session_timeout`
   * pour tuer côté Postgres une transaction oubliée ouverte — mais l'extraction/profilage ne
   * touche PAS la base pendant tout ce temps (aucune requête en vol), donc la connexion est bien
   * « idle in transaction » aux yeux de Postgres, qui la ferme. Le pilote `pg` reçoit alors une
   * erreur socket sur une connexion QUE `pg-pool` a déjà retirée de son propre gestionnaire
   * d'erreurs pendant qu'elle est extraite du pool pour la transaction (`pg-pool/index.js::
   * _acquireClient` : `client.removeListener('error', idleListener)`, ré-attaché seulement à la
   * RELEASE) — sans écouteur `error` sur ce client précis à cet instant, Node la traite comme un
   * événement non géré, c'est-à-dire un `uncaughtException` PROCESS-WIDE, ramassé par
   * `observabilite/installer-gestionnaires-crash.ts` qui journalise puis appelle
   * `process.exit(1)` : toute l'API meurt, tous tenants confondus, pas seulement ce job BullMQ
   * (qui aurait sinon simplement échoué via `@OnWorkerEvent('failed')`, filet déjà en place et
   * intact, voir plus bas). En ne tenant plus JAMAIS une transaction ouverte pendant du travail non
   * lié à la base, cette fenêtre d'inactivité disparaît : les deux transactions ci-dessous ne
   * contiennent plus que des `tx.execute` consécutifs, jamais un `await` de plusieurs minutes entre
   * deux requêtes.
   *
   * Toute erreur PENDANT l'extraction/profilage (phase 2, hors transaction) reste capturée par le
   * `try/catch` ci-dessous exactement comme avant : elle transitionne CE dossier vers
   * `analyse_echouee` avec un message utile (phase 3), jamais un dossier bloqué et jamais un rejet
   * qui remonterait au worker BullMQ.
   */
  async executer(ctx: ContexteTenant, dossierId: string): Promise<void> {
    // --- Phase 1 : lecture rapide, transaction courte ----------------------------------------
    const dossier = await this.acces.enTenant(ctx, (tx) =>
      this.cycleVie.ligneBrute(tx, ctx.tenantId, dossierId),
    );

    // --- Phase 2 : extraction + profilage, VOLONTAIREMENT HORS TRANSACTION ------------------
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
    // Cède la main (macrotâche `setImmediate`) au moins toutes les `SEUIL_CESSION_EVENT_LOOP_MS_
    // DEFAUT` (20ms) de travail synchrone d'affilée — voir `common/concurrence/
    // ceder-controle-event-loop.ts` pour le mécanisme et la mesure qui le justifient (défaut réel
    // du 26.08.2026 : boucle de 359 tables affamant le renouvellement du verrou BullMQ). Une seule
    // instance pour TOUTE la phase 2 : le budget de 20ms est global à l'ensemble
    // fichiers × tables, pas remis à zéro à chaque itération de boucle.
    const cedeurEventLoop = creerCedeurEventLoop();

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
          // Après CHAQUE table, succès ou anomalie — voir le commentaire de `cedeurEventLoop`
          // ci-dessus. `evaluerRole`/`profilerColonnes` travaillent déjà sur un échantillon borné
          // (rapide), mais le budget de 20ms est CUMULATIF sur toute la phase 2 : sans cette
          // cession régulière, des centaines de tables consécutives peuvent affamer le
          // renouvellement du verrou BullMQ sans qu'aucun appel individuel ne soit lui-même long.
          await cedeurEventLoop.cederSiNecessaire();
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

    // --- Phase 3 : écriture du résultat + transition(s) + plan, transaction courte ----------
    await this.acces.enTenant(ctx, async (tx) => {
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
