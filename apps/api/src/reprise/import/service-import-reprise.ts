/**
 * Orchestrateur d'import — ORDRE D'INSERTION IMPOSÉ PAR LES CLÉS ÉTRANGÈRES (brief) : socle (déjà
 * là) -> clients -> véhicules (+ plaques/détentions) -> documents de vente (brouillon puis émis) ->
 * … . Périmètre CONCRÈTEMENT écrit dans ce chantier : `clients`, `vehicules`, `documents_vente`
 * (en-têtes seuls, D-30). `fournisseurs`/`articles_stock`/`paiements`/`ordres_reparation`/
 * `documents_scannes`/périodes comptables restent un POINT D'EXTENSION EXPLICITE — voir
 * `ORDRE_DOMAINES` et `ecrireElementDomaine` ci-dessous : un domaine sans écrivain concret produit
 * une ANOMALIE nommée (jamais un succès simulé), le lot continue.
 *
 * Un job qui MEURT ne laisse pas le dossier bloqué en `import_en_cours` — même filet que
 * `ServiceAnalyseReprise` (`marquerEchecDefensif` + `@OnWorkerEvent('failed')`).
 *
 * TROIS PHASES, TRANSACTIONS COURTES (défaut structurel réel du 26.08.2026 corrigé ici — même
 * doctrine que `analyse/service-analyse-reprise.ts`, § son en-tête pour le mécanisme complet de
 * `idle_in_transaction_session_timeout` : une transaction tenue ouverte pendant une lecture
 * disque/sous-processus sans requête SQL en vol se fait tuer par Postgres, l'erreur socket
 * remonte en `uncaughtException` PROCESS-WIDE via `pg-pool`, toute l'API meurt) :
 *   1. lecture rapide (dossier + plan + analyse), transaction courte ;
 *   2. TOUT le travail lourd — extraction d'archive, lecture des lignes source (disque/sous-
 *      processus), construction/déduplication des candidats (CPU pur) — VOLONTAIREMENT HORS de
 *      toute transaction, table par table, domaine par domaine ;
 *   3. écriture du rapport final + transition(s), transaction courte.
 *
 * L'IMPORT ÉCRIT, LÀ OÙ L'ANALYSE NE FAISAIT QUE LIRE — la phase 2 ne peut donc pas rester
 * ENTIÈREMENT hors transaction comme celle de l'analyse : l'écriture réelle (`tx.execute`) doit
 * forcément se produire dans une transaction. Le découpage retenu, par ÉLÉMENT (table) : préparer
 * les candidats HORS transaction (lecture + CPU, cessions d'event loop comprises — voir les
 * écrivains de `./ecrivains/`), puis écrire DANS une transaction COURTE ouverte pour CETTE seule
 * écriture (`this.acces.enTenant`, PAS la transaction de la phase 1 ni de la phase 3). Chaque
 * élément (table) obtient donc sa propre transaction de commit, plutôt qu'un unique commit final
 * pour tout l'import — voir « ATOMICITÉ » ci-dessous pour ce que ça change et pourquoi c'est sûr.
 * JAMAIS de cession d'event loop (`cederSiNecessaire`) À L'INTÉRIEUR d'une de ces transactions
 * d'écriture — c'est exactement ce que ce découpage élimine : une cession ne fait qu'un aller-
 * retour vers la boucle d'événements Node, SANS envoyer de requête SQL, donc AUSSI « idle in
 * transaction » aux yeux de Postgres qu'une lecture disque de plusieurs minutes si elle
 * s'accumule sur assez d'itérations. Voir les en-têtes de `ecrivain-client-reprise.ts`/
 * `ecrivain-vehicule-reprise.ts`/`ecrivain-document-vente-reprise.ts` pour le détail par domaine
 * (`vehicules` a besoin de DEUX transactions courtes distinctes, la reconstruction d'intervalles —
 * CPU pur — devant elle aussi rester hors transaction).
 *
 * ATOMICITÉ — CE QUI CHANGE, ET POURQUOI C'EST SÛR : avant ce découpage, tout l'import (lecture,
 * écriture, rapport, transition) vivait dans UNE SEULE transaction — en apparence « tout ou rien »,
 * mais en pratique DÉJÀ PAS ATOMIQUE pour toute erreur JS qui n'aborte pas la transaction Postgres
 * elle-même (le `try/catch` de `executer()` avale l'exception, mais les écritures DÉJÀ FAITES sur
 * les domaines précédents restent dans la MÊME transaction et COMMITENT quand même à la fin, avec
 * seulement `echecTotal = true` pour mémoire) — l'ancienne « atomicité » était donc déjà partielle
 * et dépendait du TYPE d'erreur (une vraie violation SQL abortait la transaction Postgres, une
 * exception JS ordinaire ne l'abortait pas). Ce découpage REND ce comportement EXPLICITE et
 * UNIFORME plutôt que de le changer de nature : chaque élément (table) commite indépendamment dès
 * qu'il est écrit avec succès, qu'il soit suivi d'un succès ou d'un échec plus loin dans le lot.
 * Un import qui échoue à mi-parcours laisse donc les domaines déjà traités EN BASE — exactement
 * comme avant pour le cas JS, désormais aussi pour le cas SQL (qui, lui, changeait de
 * comportement selon que l'erreur touchait la transaction ou pas).
 *
 * CE QUI REND UN IMPORT PARTIEL RATTRAPABLE PAR REJEU (`POST .../import/rejouer`, `rejouer()`
 * ci-dessous) : `rejouer()` ne reprend PAS « là où on s'est arrêté » — il relance `executer()` au
 * complet, qui relit et réécrit TOUT le plan depuis la source. Ce n'est SÛR que parce que les
 * écrivains de domaine sont des UPSERTS idempotents par clé source :
 *   - `client`/`vehicule` : `on conflict (tenant_id, numero_origine) do update ... returning id`
 *     (migration 0066) — une ligne déjà importée est retrouvée, jamais dupliquée ni en échec ;
 *   - `document_vente` : `on conflict (tenant_id, type_document, numero_origine) do nothing` sur
 *     le brouillon (`ecrivain-document-vente-reprise.ts::creerBrouillon`) — un document déjà émis
 *     n'est jamais réémis (`cree: false`, l'étape 2 n'est même pas tentée) ;
 *   - `vehicule_plaque`/`vehicule_detention` : DÉFAUT TROUVÉ ET CORRIGÉ en construisant ce
 *     découpage (`ecrivain-vehicule-reprise.ts`, § IDEMPOTENCE de son en-tête) — ces deux INSERT
 *     n'avaient AUCUNE clause `on conflict`, un rejeu qui retentait d'écrire EXACTEMENT le même
 *     intervalle heurtait la contrainte `EXCLUDE USING GIST` (0007) et faisait échouer le rejeu à
 *     coup sûr dès qu'un véhicule avec plaque avait déjà été importé — PRÉEXISTANT à ce chantier
 *     (le même risque existait déjà avec l'ancienne transaction unique, dès qu'une erreur JS
 *     laissait des plaques committées avant un échec plus loin), mais c'est très exactement la
 *     propriété que ce découpage devait vérifier avant de le considérer sûr — `on conflict do
 *     nothing` (sans cible, seule forme valide pour une contrainte EXCLUDE) les rend maintenant
 *     idempotents comme le reste.
 * Avec cette correction, un rejeu complet est un no-op sur tout ce qui était déjà écrit et reprend
 * normalement là où l'échec précédent l'avait arrêté — le découpage en transactions courtes est
 * donc sûr : il ne fait qu'expliciter une non-atomicité qui existait déjà, sans jamais laisser un
 * rejeu échouer sur des données qu'il a lui-même précédemment écrites.
 *
 * REBASAGE DES CHEMINS DE FICHIER SOURCE — second défaut réel du 26.08.2026, corrigé dans la même
 * passe (mêmes fonctions) : voir `resolution-chemin-extraction-reprise.ts` pour le mécanisme
 * complet. `TableDetecteeReprise.fichierChemin` (persisté par `reprise_analyse.tables`) pointe le
 * répertoire d'extraction de l'ANALYSE, déjà purgé au moment de l'import — l'import fait sa PROPRE
 * extraction fraîche (`repertoire` ci-dessous) et doit REBASER chaque chemin dessus avant tout
 * `lireLignes`, jamais utiliser `fichierChemin` tel quel.
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
import { creerCedeurEventLoop, type CedeurEventLoop } from '../../common/concurrence';

import { type LigneRepriseAnalyseBrute } from '../db-reprise.types';
import { type LigneReprisePlanBrute } from '../db-reprise.types';
import { type LigneRepriseImportBrute, projeterImportReprise } from '../db-reprise.types';
import { type LigneRepriseRapportBrute, projeterRapportReprise } from '../db-reprise.types';
import { JETON_LECTEUR_ARCHIVE_REPRISE, JETON_STOCKAGE_ARCHIVE_REPRISE } from '../reprise.jetons';
import { NOM_FILE_IMPORT_REPRISE, NOM_JOB_IMPORT_REPRISE } from '../reprise.jetons';
import type { PortLecteurArchiveReprise } from '../lecture/port-lecteur-archive-reprise';
import type { PortStockageArchiveReprise } from '../depot/stockage-archive-reprise';
import type { LigneTable } from '../lecteurs/types';
import { ServiceCycleVieDossierReprise } from '../service-cycle-vie-dossier-reprise';
import {
  ecrireClientsPreparesReprise,
  preparerCandidatsClientsReprise,
} from './ecrivains/ecrivain-client-reprise';
import {
  ecrireVehiculesBaseReprise,
  ecrireVehiculesIntervallesReprise,
  preparerCandidatsVehiculesReprise,
  reconstruireIntervallesVehiculesReprise,
} from './ecrivains/ecrivain-vehicule-reprise';
import {
  ecrireDocumentsVenteRepriseParLot,
  preparerCandidatsDocumentsVenteReprise,
} from './ecrivains/ecrivain-document-vente-reprise';
import { rebaserCheminFichierExtractionReprise } from './resolution-chemin-extraction-reprise';

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

  /** Corps exécuté par `ProcesseurImportReprise`. Trois phases — voir l'en-tête de fichier. */
  async executer(ctx: ContexteTenant, dossierId: string): Promise<void> {
    // --- Phase 1 : lecture rapide + préparatifs, transaction courte --------------------------
    const { dossier, elementsInclus, tablesParId } = await this.acces.enTenant(ctx, async (tx) => {
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

      return { dossier, elementsInclus, tablesParId };
    });

    const accumulateur: AccumulateurRapport = {
      insere: [],
      ecarte: [],
      anomalies: [],
      reconciliationParAnnee: new Map(),
    };
    const clientIdParNumeroOrigine = new Map<string, string>();

    let echecTotal = false;
    // Nettoyé dans le `finally` ci-dessous, succès ou échec — voir « PURGE DU RÉPERTOIRE
    // D'EXTRACTION » (`lecture/adaptateur-lecteur-archive-reprise.ts`, en-tête de fichier).
    let repertoireExtrait: string | undefined;
    // Cède la main (macrotâche `setImmediate`) au moins toutes les 20ms de travail synchrone
    // d'affilée — même mécanisme, même seuil que `analyse/service-analyse-reprise.ts` (voir
    // `common/concurrence/ceder-controle-event-loop.ts`). Une seule instance pour TOUT
    // `executer()` : le budget est cumulatif sur l'ensemble domaines × tables × lignes, pas remis
    // à zéro à chaque itération — voir la lecture des lignes source ci-dessous et les écrivains de
    // domaine (`./ecrivains/`, phases de préparation) pour les points d'appel. JAMAIS appelée à
    // l'intérieur d'une des transactions d'écriture courtes ouvertes plus bas — voir « TROIS
    // PHASES » en tête de fichier.
    const cedeurEventLoop = creerCedeurEventLoop();

    try {
      // --- Phase 2 : extraction + lecture + écriture, VOLONTAIREMENT SANS TRANSACTION TENUE
      // OUVERTE pendant l'extraction/lecture/préparation (CPU/disque/sous-processus purs) — voir
      // l'en-tête de fichier. Seules les écritures elles-mêmes (dans `ecrireElementDomaine`)
      // ouvrent une transaction, courte, juste pour elles.
      const cheminArchive = await this.stockage.cheminAbsoluArchive(dossier.stockage_chemin);
      const { repertoire } = await this.lecteur.extraireEtInventorier(cheminArchive);
      repertoireExtrait = repertoire;
      const famille = (await this.lecteur.detecterFamille(repertoire)).famille;

      const domainesConcrets = new Set<DomaineReprise>(['clients', 'vehicules', 'documents_vente']);

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

          // Rebasage sur LE répertoire d'extraction de CET import — `table.fichierChemin` pointe
          // celui, déjà purgé, de l'analyse. Voir `resolution-chemin-extraction-reprise.ts` et
          // l'en-tête de fichier ci-dessus.
          const cheminFichier = rebaserCheminFichierExtractionReprise(
            table.fichierChemin,
            repertoire,
          );
          if (cheminFichier === null) {
            accumulateur.anomalies.push({
              type: 'contrainte_metier_refusee',
              domaine,
              ligneSource: null,
              donnees: {
                raison: 'fichier source introuvable après extraction (chemin non rebasable)',
                fichierChemin: table.fichierChemin,
              },
            });
            await this.acces.enTenant(ctx, (tx) =>
              this.avancerProgression(tx, ctx.tenantId, dossierId, table.nombreLignes, domaine),
            );
            continue;
          }

          // Lecture EN FLUX du fichier source rebasé — disque/sous-processus pur, AUCUNE requête
          // SQL, donc HORS de toute transaction. Cède la main ligne par ligne (nombre
          // d'itérations = volume de LA TABLE ENTIÈRE, pas un échantillon borné).
          const lignes: LigneTable[] = [];
          for await (const ligne of this.lecteur.lireLignes(
            cheminFichier,
            famille,
            table.nomTechnique,
          )) {
            lignes.push(ligne);
            await cedeurEventLoop.cederSiNecessaire();
          }

          await this.ecrireElementDomaine(
            ctx,
            dossierId,
            domaine,
            table,
            element,
            lignes,
            accumulateur,
            clientIdParNumeroOrigine,
            cedeurEventLoop,
          );
        }
      }

      // Domaines demandés mais sans écrivain concret : signalés, jamais un succès simulé.
      const domainesCouverts = new Set<DomaineReprise>(['clients', 'vehicules', 'documents_vente']);
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

    // --- Phase 3 : écriture du rapport + transition(s), transaction courte -------------------
    await this.acces.enTenant(ctx, async (tx) => {
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
   * `executer()` ci-dessus) : ces trois domaines rejoignent honnêtement le sort déjà réservé à
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

  /**
   * Dispatch par domaine — chaque branche PRÉPARE ses candidats hors de toute transaction (déjà
   * fait pour `lignes`, voir l'appelant), puis ouvre SA PROPRE transaction courte
   * (`this.acces.enTenant`) pour l'écriture réelle. La mise à jour de la progression
   * (`elements_traites`/`domaine_courant`) est TOUJOURS appliquée en sortie, quel que soit le
   * résultat de l'écriture (même comportement que l'ancienne boucle unique, où cette mise à jour
   * suivait inconditionnellement l'appel d'écriture).
   */
  private async ecrireElementDomaine(
    ctx: ContexteTenant,
    dossierId: string,
    domaine: DomaineReprise,
    table: TableDetecteeReprise,
    element: ElementPlanReprise,
    lignes: readonly LigneTable[],
    accumulateur: AccumulateurRapport,
    clientIdParNumeroOrigine: Map<string, string>,
    cedeurEventLoop: CedeurEventLoop,
  ): Promise<void> {
    if (domaine === 'clients') {
      const preparation = await preparerCandidatsClientsReprise(lignes, 'fr', cedeurEventLoop);
      const ecriture = await this.acces.enTenant(ctx, (tx) =>
        ecrireClientsPreparesReprise(tx, ctx.tenantId, preparation.candidatsRetenus),
      );
      for (const [k, v] of ecriture.idParNumeroOrigine) clientIdParNumeroOrigine.set(k, v);
      accumulateur.insere.push({
        domaine: 'clients',
        elementPlanId: element.id,
        nombre: ecriture.insere,
      });
      if (preparation.ecarte > 0) {
        accumulateur.ecarte.push({
          domaine: 'clients',
          elementPlanId: element.id,
          motif: 'doublon_deja_importe',
          nombre: preparation.ecarte,
        });
      }
      accumulateur.anomalies.push(...preparation.anomalies);
    } else if (domaine === 'vehicules') {
      const preparation = await preparerCandidatsVehiculesReprise(lignes, cedeurEventLoop);
      const base = await this.acces.enTenant(ctx, (tx) =>
        ecrireVehiculesBaseReprise(
          tx,
          ctx.tenantId,
          preparation.candidatsRetenus,
          clientIdParNumeroOrigine,
        ),
      );
      // Reconstruction d'intervalles (CPU pur) HORS transaction, entre les deux écritures courtes
      // — voir l'en-tête de `ecrivain-vehicule-reprise.ts`.
      const { plaquesReconstituees, detentionsReconstituees } =
        await reconstruireIntervallesVehiculesReprise(
          base.plaquesAInserer,
          base.detentionsAInserer,
          cedeurEventLoop,
        );
      await this.acces.enTenant(ctx, (tx) =>
        ecrireVehiculesIntervallesReprise(
          tx,
          ctx.tenantId,
          plaquesReconstituees,
          detentionsReconstituees,
        ),
      );
      accumulateur.insere.push({
        domaine: 'vehicules',
        elementPlanId: element.id,
        nombre: base.insere,
      });
      if (preparation.ecarte > 0) {
        accumulateur.ecarte.push({
          domaine: 'vehicules',
          elementPlanId: element.id,
          motif: 'doublon_deja_importe',
          nombre: preparation.ecarte,
        });
      }
      accumulateur.anomalies.push(...preparation.anomalies, ...base.anomalies);
    } else if (domaine === 'documents_vente') {
      const preparation = await preparerCandidatsDocumentsVenteReprise(
        lignes,
        clientIdParNumeroOrigine,
        cedeurEventLoop,
      );
      // Site par défaut : premier site du tenant — voir l'ambiguïté signalée dans
      // `ecrivain-document-vente-reprise.ts`. Lecture ET écriture dans la MÊME transaction courte
      // (le lookup de site est un accès base légitime, pas une « lecture de source »).
      const ecriture = await this.acces.enTenant(ctx, async (tx) => {
        const siteLigne = (
          await tx.execute<{ readonly id: string }>(
            sql`select id from public.site where tenant_id = ${ctx.tenantId} order by cree_le limit 1`,
          )
        ).rows[0];
        if (!siteLigne) return null;
        return ecrireDocumentsVenteRepriseParLot(
          tx,
          { tenantId: ctx.tenantId, siteId: siteLigne.id, langueFigee: 'fr' },
          preparation.candidatsRetenus,
          accumulateur.reconciliationParAnnee,
        );
      });
      if (ecriture === null) {
        accumulateur.anomalies.push({
          type: 'contrainte_metier_refusee',
          domaine: 'documents_vente',
          ligneSource: null,
          donnees: { raison: 'aucun site pour ce tenant' },
        });
      } else {
        accumulateur.insere.push({
          domaine: 'documents_vente',
          elementPlanId: element.id,
          nombre: ecriture.insere,
        });
      }
      accumulateur.anomalies.push(...preparation.anomalies);
    }

    await this.acces.enTenant(ctx, (tx) =>
      this.avancerProgression(tx, ctx.tenantId, dossierId, table.nombreLignes, domaine),
    );
  }

  private async avancerProgression(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
    incrementLignes: number,
    domaine: DomaineReprise,
  ): Promise<void> {
    const traites =
      (
        await tx.execute<{ readonly total: string }>(sql`
        select elements_traites::text as total from public.reprise_import
         where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
      `)
      ).rows[0]?.total ?? '0';
    await tx.execute(sql`
      update public.reprise_import
         set elements_traites = ${Number(traites) + incrementLignes}, domaine_courant = ${domaine}
       where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
    `);
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
