import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject } from '@nestjs/common';

import { JETON_DB, type AccesBase } from '../../db';
import { NOM_FILE_IMPORT_REPRISE } from '../reprise.jetons';
import { ServiceImportReprise } from './service-import-reprise';

interface DonneesJobImport {
  readonly tenantId: string;
  readonly dossierRepriseId: string;
}

/** Worker BullMQ de la file `reprise-import` — même patron que `ProcesseurAnalyseReprise`. */
@Processor(NOM_FILE_IMPORT_REPRISE)
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
