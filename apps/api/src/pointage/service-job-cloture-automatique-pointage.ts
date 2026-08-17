import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { JETON_CONFIG } from '../config';
import { ServiceJournal } from '../common/journal';

import type { ConfigAvecJobClotureAutomatiquePointage } from './config-job-cloture-automatique-pointage';
import { chargerTenantsActifsPointage } from './enumerer-tenants-actifs-pointage';
import {
  executerJobClotureAutomatiquePointage,
  type ResultatJobClotureAutomatiquePointage,
} from './orchestration-job-cloture-automatique-pointage';
import { ServiceClotureAutomatiquePointage } from './service-cloture-automatique-pointage';

/**
 * Branche `executerJobClotureAutomatiquePointage` (fonction pure d'orchestration, voir ce
 * fichier) aux implémentations réelles : énumération des tenants (`enumerer-tenants-actifs-
 * pointage.ts`, canal `dfa_migrator`), le service métier déjà livré
 * (`ServiceClotureAutomatiquePointage.executerPourTenant`, RLS/`dfa_app`, une transaction par
 * tenant), et le journal du dépôt. Appelée par `ProcesseurClotureAutomatiquePointage` (worker
 * BullMQ) — voir `ordonnanceur-cloture-automatique-pointage.ts` pour le déclenchement quotidien.
 *
 * `randomUUID()` — SEUL effet de bord non injecté de ce fichier (au même titre que
 * `ServiceJobReferentielVehiculesCh` n'injecte pas non plus son horloge dans le corps de
 * `executer()`, mais la passe en paramètre) : un `runId` par appel à `executer()`, jamais réutilisé
 * — voir `orchestration-job-cloture-automatique-pointage.ts` § « IDENTITÉ DE L'APPELANT SYSTÈME »
 * pour ce qu'il porte dans l'audit trail.
 */
@Injectable()
export class ServiceJobClotureAutomatiquePointage {
  constructor(
    @Inject(JETON_CONFIG) private readonly config: ConfigAvecJobClotureAutomatiquePointage,
    private readonly serviceCloture: ServiceClotureAutomatiquePointage,
    private readonly journal: ServiceJournal,
  ) {}

  async executer(): Promise<ResultatJobClotureAutomatiquePointage> {
    return executerJobClotureAutomatiquePointage({
      runId: randomUUID(),
      chargerTenantsActifs: () => chargerTenantsActifsPointage(this.config.DATABASE_URL_MIGRATION),
      executerPourTenant: (ctx) => this.serviceCloture.executerPourTenant(ctx),
      journaliser: (message, donnees) =>
        this.journal.info(message, { job: 'pointage-cloture-automatique', ...donnees }),
    });
  }
}
