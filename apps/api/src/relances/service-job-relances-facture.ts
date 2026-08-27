import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { JETON_CONFIG } from '../config';
import { ServiceJournal } from '../common/journal';

import type { ConfigAvecJobRelances } from './config-job-relances';
import { chargerTenantsActifsRelances } from './enumerer-tenants-actifs-relances';
import {
  executerJobRelancesFacture,
  type ResultatJobRelancesFacture,
} from './orchestration-job-relances';
import { ServiceRelancesFacture } from './service-relances-facture';

/**
 * Branche `executerJobRelancesFacture` (fonction pure d'orchestration, voir ce fichier) aux
 * implémentations réelles : énumération des tenants (`enumerer-tenants-actifs-relances.ts`, canal
 * `dfa_migrator`), le service métier déjà livré (`ServiceRelancesFacture.planifier`/
 * `.envoyerPretes`, RLS/`dfa_app`, une transaction par tenant), et le journal du dépôt. Appelée par
 * `ProcesseurRelancesFacture` (worker BullMQ) — voir `ordonnanceur-relances-facture.ts` pour le
 * déclenchement horaire. Même patron que `pointage/service-job-cloture-automatique-pointage.ts`
 * (modèle).
 *
 * `randomUUID()` — SEUL effet de bord non injecté de ce fichier : un `runId` par appel à
 * `executer()`, jamais réutilisé — voir `orchestration-job-relances.ts` § « IDENTITÉ DE L'APPELANT
 * SYSTÈME » pour ce qu'il porte dans l'audit trail.
 */
@Injectable()
export class ServiceJobRelancesFacture {
  constructor(
    @Inject(JETON_CONFIG) private readonly config: ConfigAvecJobRelances,
    private readonly serviceFacture: ServiceRelancesFacture,
    private readonly journal: ServiceJournal,
  ) {}

  async executer(): Promise<ResultatJobRelancesFacture> {
    return executerJobRelancesFacture({
      runId: randomUUID(),
      chargerTenantsActifs: () => chargerTenantsActifsRelances(this.config.DATABASE_URL_MIGRATION),
      planifier: (ctx) => this.serviceFacture.planifier(ctx),
      envoyerPretes: (ctx) => this.serviceFacture.envoyerPretes(ctx),
      journaliser: (message, donnees) =>
        this.journal.info(message, { job: 'relances-facture', ...donnees }),
    });
  }
}
