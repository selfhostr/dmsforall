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
 * `reprise.jetons.ts` pour la justification, défaut réel du 26.08.2026). L'import lit/écrit AU
 * MOINS autant de lignes que l'analyse (plus, en fait — pas seulement un échantillon) : même
 * exposition mesurée à la famine d'event loop, même filet. Cession explicite de l'event loop DANS
 * la boucle d'import elle-même — traitée dans `service-import-reprise.ts::ecrireDomaine` (lecture
 * des lignes source) et les écrivains de domaine (`ecrireClientsReprise`/`ecrireVehiculesReprise`,
 * boucle de construction des candidats), même mécanisme que l'analyse (`creerCedeurEventLoop`,
 * `common/concurrence/`). Point encore ouvert, signalé au rapport de livraison : `executer()`
 * garde TOUT le traitement (lecture des lignes source incluse, disque/sous-processus, sans requête
 * SQL pendant ce temps) dans UNE SEULE transaction Postgres — le défaut structurel que
 * `service-analyse-reprise.ts` vient d'éliminer (extraction hors transaction) n'a PAS été reproduit
 * ici ; la cession de l'event loop ne le corrige pas (elle ne fait qu'éviter la famine du
 * renouvellement de verrou BullMQ), une restructuration équivalente à celle de l'analyse reste à
 * décider séparément.
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
