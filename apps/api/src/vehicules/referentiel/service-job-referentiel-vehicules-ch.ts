import { Inject, Injectable } from '@nestjs/common';

import { JETON_CONFIG } from '../../config';
import { Horloge } from '../../common/horloge';
import { ServiceJournal } from '../../common/journal';
import { importerReferentielVehiculesCh } from '../../db/seed/import-referentiel-vehicules-ch';

import type { ConfigAvecJobReferentielVehiculesCh } from './config-job-referentiel-vehicules-ch';
import {
  detecterSignatureSourcesTas,
  type FetchInjectable,
} from './detecter-changement-source-tas';
import {
  chargerEtatImportReferentielVehiculesCh,
  enregistrerResultatVerificationReferentielVehiculesCh,
} from './etat-import-referentiel-vehicules-ch';
import {
  executerVerificationReferentielVehiculesCh,
  type ResultatJobReferentielVehiculesCh,
} from './job-mise-a-jour-referentiel-vehicules-ch';

/**
 * Branche `executerVerificationReferentielVehiculesCh` (fonction pure d'orchestration, voir ce
 * fichier) aux implémentations réelles : `fetch` global, l'import existant
 * (`db/seed/import-referentiel-vehicules-ch.ts`, réutilisé tel quel), la persistance d'état
 * (migration 0057) et l'horloge/journal du dépôt. Appelée par `ProcesseurReferentielVehiculesCh`
 * (worker BullMQ) — voir `referentiel-vehicules-ch-job.module.ts` pour le déclenchement quotidien.
 */
@Injectable()
export class ServiceJobReferentielVehiculesCh {
  constructor(
    @Inject(JETON_CONFIG) private readonly config: ConfigAvecJobReferentielVehiculesCh,
    private readonly horloge: Horloge,
    private readonly journal: ServiceJournal,
  ) {}

  async executer(): Promise<ResultatJobReferentielVehiculesCh> {
    return executerVerificationReferentielVehiculesCh({
      urlMigration: this.config.DATABASE_URL_MIGRATION,
      // `fetch` global (Node ≥ 18, même API que `db/seed/import-referentiel-vehicules-ch.ts`) —
      // structurellement compatible avec `FetchInjectable` (ok/status/headers.get/body).
      fetchImpl: fetch as unknown as FetchInjectable,
      detecterSignature: detecterSignatureSourcesTas,
      chargerEtat: chargerEtatImportReferentielVehiculesCh,
      importer: importerReferentielVehiculesCh,
      enregistrerEtat: enregistrerResultatVerificationReferentielVehiculesCh,
      maintenant: () => this.horloge.maintenant(),
      journaliser: (message) => this.journal.info(message, { job: 'referentiel-vehicules-ch' }),
    });
  }
}
