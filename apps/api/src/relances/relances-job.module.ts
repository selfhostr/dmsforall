import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { type ConfigAvecModeProcessus, modeIncluTraitementFilesAttente } from '../ordonnancement';

import { OrdonnanceurRelancesFacture } from './ordonnanceur-relances-facture';
import { ProcesseurRelancesFacture } from './processeur-relances-facture';
import { NOM_FILE_RELANCES_FACTURE } from './relances.jetons';
import { RelancesModule } from './relances.module';
import { ServiceJobRelancesFacture } from './service-job-relances-facture';

/**
 * Branchement BullMQ des relances de facturation (rappel #2,
 * `docs/specification-relances-automatiques.md`) — comble le trou documenté par
 * `service-relances-facture.ts` (§ en-tête : « Aucun ordonnanceur n'existe dans ce dépôt »).
 * `planifier()`/`envoyerPretes()` existaient déjà, exposées par `relances.controller.ts` en
 * APPELABLE À LA DEMANDE ; ce module ajoute le déclencheur PÉRIODIQUE qui les invoque désormais
 * automatiquement, pour chaque tenant actif.
 *
 * MÊME PATRON que les quatre bundles de job du dépôt (`pointage/pointage-cloture-automatique-
 * job.module.ts`, `reprise/reprise-job.module.ts`,
 * `exploitation/cycle-vie-tenant/cycle-vie-tenant-job.module.ts`,
 * `vehicules/referentiel/referentiel-vehicules-ch-job.module.ts`, tous issus du chantier
 * « découplage worker/API », 27.08.2026) : module DYNAMIQUE-SEUL, `.pourConfig(config)`, VIDE en
 * mode 'api'.
 *
 * VIDE EN MODE 'api', ET C'EST UN MÉCANISME, PAS UNE INTENTION : `{ module: RelancesJobModule }`
 * sans `imports`/`providers` ne pose NI la file BullMQ NI aucun des trois providers —
 * `ProcesseurRelancesFacture` (`@Processor`) n'est alors NULLE PART dans le graphe Nest, donc
 * jamais instancié, donc `BullExplorer.registerWorkers()` (`@nestjs/bullmq`, appelé
 * automatiquement au `onModuleInit` du socle BullMQ) ne crée AUCUN `Worker` pour cette file —
 * exigence 1 du chantier (« pas seulement inactif : pas enregistré »). `OrdonnanceurRelancesFacture`
 * (`@InjectQueue`/`OnApplicationBootstrap`) vit sur un PROVIDER ORDINAIRE, jamais sur la classe de
 * ce module — voir son en-tête pour pourquoi (un module Nest instancie toujours sa propre classe,
 * même quand le `DynamicModule` rendu est vide).
 *
 * Importé UNE SEULE FOIS, depuis `app.module.ts` — jamais depuis `relances.module.ts` lui-même,
 * qui N'EST PAS rendu dynamique : Nest 11 déduplique par référence d'objet, pas par contenu — deux
 * appels `.pourConfig` distincts sur un MÊME module produiraient une seconde instance si ce module
 * était importé ailleurs (il l'est : `relances.module.ts` reste importé en forme STATIQUE, classe
 * nue, par `app.module.ts` ET par ce fichier-ci).
 *
 * `RelancesModule` importé ici en forme STATIQUE (classe nue, jamais `.pourConfig(...)`) :
 * `ServiceRelancesFacture` (déjà exporté par `RelancesModule`) est la SEULE dépendance métier de
 * `ServiceJobRelancesFacture`.
 */
@Module({})
export class RelancesJobModule {
  static pourConfig(config: ConfigAvecModeProcessus): DynamicModule {
    if (!modeIncluTraitementFilesAttente(config)) {
      return { module: RelancesJobModule };
    }

    return {
      module: RelancesJobModule,
      imports: [RelancesModule, BullModule.registerQueue({ name: NOM_FILE_RELANCES_FACTURE })],
      providers: [
        ServiceJobRelancesFacture,
        ProcesseurRelancesFacture,
        OrdonnanceurRelancesFacture,
      ],
    };
  }
}
