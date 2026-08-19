import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { NOM_FILE_REFERENTIEL_VEHICULES_CH } from './referentiel-vehicules-ch.jetons';
import { ServiceJobReferentielVehiculesCh } from './service-job-referentiel-vehicules-ch';
import type { ResultatJobReferentielVehiculesCh } from './job-mise-a-jour-referentiel-vehicules-ch';

/**
 * Worker BullMQ consommant la file `referentiel-vehicules-ch` — un seul job planifié
 * (`ID_JOB_REFERENTIEL_VEHICULES_CH`, voir `referentiel-vehicules-ch-job.module.ts`), mais tout
 * appel manuel (`file.add(...)`, ex. futur bouton d'exploitation « forcer un contrôle
 * maintenant ») passerait par le même worker sans code supplémentaire.
 *
 * Ne fait QUE déléguer à `ServiceJobReferentielVehiculesCh.executer()` — toute la logique
 * (détection de changement, décision réimporter/pas réimporter, traçabilité) vit dans ce
 * service et sa fonction pure sous-jacente (`job-mise-a-jour-referentiel-vehicules-ch.ts`),
 * testables sans BullMQ ni worker réel.
 */
@Processor(NOM_FILE_REFERENTIEL_VEHICULES_CH)
export class ProcesseurReferentielVehiculesCh extends WorkerHost {
  constructor(private readonly service: ServiceJobReferentielVehiculesCh) {
    super();
  }

  async process(_job: Job): Promise<ResultatJobReferentielVehiculesCh> {
    return this.service.executer();
  }
}
