import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject } from '@nestjs/common';

import { JETON_DB, type AccesBase } from '../../db';
import { NOM_FILE_IMPORT_REPRISE, OPTIONS_WORKER_REPRISE } from '../reprise.jetons';
import { ServiceImportReprise } from './service-import-reprise';

interface DonneesJobImport {
  readonly tenantId: string;
  readonly dossierRepriseId: string;
}

/**
 * Worker BullMQ de la file `reprise-import` — même patron que `ProcesseurAnalyseReprise`, y
 * compris `OPTIONS_WORKER_REPRISE` (`lockDuration`/`concurrency` explicites — voir sa doc dans
 * `reprise.jetons.ts` pour la justification, défaut réel du 26.08.2026, RÉVISÉ le même jour avec
 * les durées réelles mesurées). L'import lit/écrit AU MOINS autant de lignes que l'analyse (plus,
 * en fait — pas seulement un échantillon) : même exposition mesurée à la famine d'event loop,
 * même filet. Cession explicite de l'event loop DANS la boucle d'import elle-même — traitée dans
 * `service-import-reprise.ts::executer` (lecture des lignes source) et les écrivains de domaine
 * (`ecrireClientsPreparesReprise`/`preparerCandidatsVehiculesReprise`, boucle de construction des
 * candidats), même mécanisme que l'analyse (`creerCedeurEventLoop`, `common/concurrence/`).
 *
 * COMMENTAIRE PÉRIMÉ CORRIGÉ ICI le 26.08.2026 : cette note affirmait auparavant qu'`executer()`
 * gardait TOUT le traitement (lecture des lignes source incluse) dans UNE SEULE transaction
 * Postgres — FAUX depuis le découpage « TROIS PHASES » documenté en tête de `service-import-
 * reprise.ts` (lecture de source HORS transaction, écriture par domaine dans des transactions
 * COURTES et SÉPARÉES) : ce point-là est réglé. Un commentaire qui décrit un défaut déjà corrigé
 * envoie le prochain lecteur chercher au mauvais endroit — mesuré en vrai le jour même, en
 * cherchant (à tort) ce défaut ici pendant l'investigation d'un crash process qui avait en réalité
 * une tout autre cause (voir `db/acces-base.service.ts`, écouteur `error` posé à la connexion).
 */
@Processor(NOM_FILE_IMPORT_REPRISE, OPTIONS_WORKER_REPRISE)
export class ProcesseurImportReprise extends WorkerHost {
  constructor(
    private readonly service: ServiceImportReprise,
    @Inject(JETON_DB) private readonly acces: AccesBase,
  ) {
    super();
  }

  async process(job: Job<DonneesJobImport>): Promise<void> {
    const { tenantId, dossierRepriseId } = job.data;
    await this.service.executer(
      { tenantId, utilisateurId: null, requeteId: `job:reprise-import:${job.id}` },
      dossierRepriseId,
    );
  }

  @OnWorkerEvent('failed')
  async surEchec(job: Job<DonneesJobImport> | undefined): Promise<void> {
    if (!job) return;
    const { tenantId, dossierRepriseId } = job.data;
    const ctx = { tenantId, utilisateurId: null, requeteId: `job:reprise-import:${job.id}:echec` };
    await this.acces
      .enTenant(ctx, (tx) => this.service.marquerEchecDefensif(tx, tenantId, dossierRepriseId))
      .catch(() => undefined);
  }
}
