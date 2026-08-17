import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE } from './cloture-automatique-pointage.jetons';
import { ServiceJobClotureAutomatiquePointage } from './service-job-cloture-automatique-pointage';
import type { ResultatJobClotureAutomatiquePointage } from './orchestration-job-cloture-automatique-pointage';

/**
 * Worker BullMQ consommant la file `pointage-cloture-automatique` — un seul job planifié
 * (`ID_JOB_CLOTURE_AUTOMATIQUE_POINTAGE`, voir `ordonnanceur-cloture-automatique-pointage.ts`),
 * même patron que `ProcesseurReferentielVehiculesCh` (modèle) : ne fait QUE déléguer à
 * `ServiceJobClotureAutomatiquePointage.executer()` — toute la logique (énumération des tenants,
 * clôture par tenant, isolation d'échec) vit dans ce service et la fonction pure sous-jacente
 * (`orchestration-job-cloture-automatique-pointage.ts`), testables sans BullMQ ni worker réel.
 */
@Processor(NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE)
export class ProcesseurClotureAutomatiquePointage extends WorkerHost {
  constructor(private readonly service: ServiceJobClotureAutomatiquePointage) {
    super();
  }

  async process(_job: Job): Promise<ResultatJobClotureAutomatiquePointage> {
    const resultat = await this.service.executer();
    if (resultat.tenantsEnErreur > 0) {
      // Fait échouer le job au sens BullMQ (retries configurés par le planificateur, voir
      // `ordonnanceur-cloture-automatique-pointage.ts`) SEULEMENT si au moins un tenant a levé une
      // exception — les tenants qui ont réussi ne sont PAS rejoués par ce retry (l'opération est
      // idempotente par tenant : un second passage sur un tenant déjà traité ne referme rien qui
      // le soit déjà, voir `service-cloture-automatique-pointage.ts`).
      throw new Error(
        `Clôture automatique du pointage : ${String(resultat.tenantsEnErreur)}/` +
          `${String(resultat.tenantsTraites)} tenant(s) en erreur (runId ${resultat.runId}) — ` +
          'voir les logs pour le détail par tenant.',
      );
    }
    return resultat;
  }
}
