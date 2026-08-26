import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject } from '@nestjs/common';

import { JETON_DB, type AccesBase } from '../../db';
import { NOM_FILE_ANALYSE_REPRISE, OPTIONS_WORKER_REPRISE } from '../reprise.jetons';
import { ServiceAnalyseReprise } from './service-analyse-reprise';

interface DonneesJobAnalyseReprise {
  readonly tenantId: string;
  readonly dossierRepriseId: string;
}

/**
 * Worker BullMQ de la file `reprise-analyse` — un job par lancement/relance. Même patron que
 * `ProcesseurExportResiliationTenant` : identité système (`utilisateurId: null`, `requeteId` porté
 * par le job). `ServiceAnalyseReprise.executer` traduit déjà tout échec de LECTURE en
 * `analyse_echouee` avant de rendre la main — `process()` ne laisse donc remonter que des
 * exceptions vraiment inattendues (panne DB, bug) ; `@OnWorkerEvent('failed')` pose alors le filet
 * de sécurité défensif (voir `ServiceAnalyseReprise.marquerEchecDefensif`).
 *
 * `OPTIONS_WORKER_REPRISE` (`lockDuration`/`concurrency` explicites, voir sa doc) — défaut réel du
 * 26.08.2026 : sans eux, une analyse longue (grosse archive) pouvait faire expirer le verrou
 * BullMQ par défaut (30s) et être redistribuée à un second worker pendant que le premier
 * continuait, à son insu, le même travail. Le VRAI correctif est la cession régulière de l'event
 * loop dans la boucle de profilage (`service-analyse-reprise.ts`) — ceci n'est que le filet.
 */
@Processor(NOM_FILE_ANALYSE_REPRISE, OPTIONS_WORKER_REPRISE)
export class ProcesseurAnalyseReprise extends WorkerHost {
  constructor(
    private readonly service: ServiceAnalyseReprise,
    @Inject(JETON_DB) private readonly acces: AccesBase,
  ) {
    super();
  }

  async process(job: Job<DonneesJobAnalyseReprise>): Promise<void> {
    const { tenantId, dossierRepriseId } = job.data;
    await this.service.executer(
      { tenantId, utilisateurId: null, requeteId: `job:reprise-analyse:${job.id}` },
      dossierRepriseId,
    );
  }

  @OnWorkerEvent('failed')
  async surEchec(job: Job<DonneesJobAnalyseReprise> | undefined): Promise<void> {
    if (!job) return;
    const { tenantId, dossierRepriseId } = job.data;
    const ctx = { tenantId, utilisateurId: null, requeteId: `job:reprise-analyse:${job.id}:echec` };
    await this.acces
      .enTenant(ctx, (tx) => this.service.marquerEchecDefensif(tx, tenantId, dossierRepriseId))
      .catch(() => undefined);
  }
}
