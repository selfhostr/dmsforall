import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { NOM_FILE_RELANCES_FACTURE } from './relances.jetons';
import { ServiceJobRelancesFacture } from './service-job-relances-facture';
import type { ResultatJobRelancesFacture } from './orchestration-job-relances';

/**
 * Worker BullMQ consommant la file `relances-facture` — un seul job planifié
 * (`ID_JOB_RELANCES_FACTURE`, voir `ordonnanceur-relances-facture.ts`), même patron que
 * `ProcesseurClotureAutomatiquePointage` (modèle) : ne fait QUE déléguer à
 * `ServiceJobRelancesFacture.executer()` — toute la logique (énumération des tenants,
 * planification puis envoi par tenant, isolation d'échec) vit dans ce service et la fonction pure
 * sous-jacente (`orchestration-job-relances.ts`), testables sans BullMQ ni worker réel.
 */
@Processor(NOM_FILE_RELANCES_FACTURE)
export class ProcesseurRelancesFacture extends WorkerHost {
  constructor(private readonly service: ServiceJobRelancesFacture) {
    super();
  }

  async process(_job: Job): Promise<ResultatJobRelancesFacture> {
    const resultat = await this.service.executer();
    if (resultat.tenantsEnErreur > 0) {
      // Fait échouer le job au sens BullMQ (retries configurés par le planificateur, voir
      // `ordonnanceur-relances-facture.ts`) SEULEMENT si au moins un tenant a levé une exception —
      // les tenants qui ont réussi ne sont PAS rejoués par ce retry (l'opération est idempotente
      // par tenant, RA-05 : un second passage ne planifie ni n'envoie jamais deux fois la même
      // relance).
      throw new Error(
        `Relances de facturation : ${String(resultat.tenantsEnErreur)}/` +
          `${String(resultat.tenantsTraites)} tenant(s) en erreur (runId ${resultat.runId}) — ` +
          'voir les logs pour le détail par tenant.',
      );
    }
    return resultat;
  }
}
