import { Module } from '@nestjs/common';

import { BlocCreancierController } from './bloc-creancier/bloc-creancier.controller';
import { ServiceBlocCreancier } from './bloc-creancier/service-bloc-creancier';
import { CompteursModule } from './compteurs/compteurs.module';
import { ParametresAtelierController } from './parametres-atelier/parametres-atelier.controller';
import { ServiceParametresAtelier } from './parametres-atelier/service-parametres-atelier';
import { ParametresSiteController } from './parametres-site/parametres-site.controller';
import { ServiceParametresSite } from './parametres-site/service-parametres-site';
import { PrestationsController } from './referentiels/prestations/prestations.controller';
import { ServicePrestations } from './referentiels/prestations/service-prestations';
import { TauxHorairesController } from './referentiels/taux-horaires/taux-horaires.controller';
import { ServiceTauxHoraires } from './referentiels/taux-horaires/service-taux-horaires';

/**
 * Assemble `GET|PATCH /parametres-atelier`, `GET|PATCH /sites/:siteId/parametres-atelier`,
 * `GET|POST /referentiels/prestations(/{id})`, `GET|POST /referentiels/taux-horaires(/{id})`,
 * `GET|PATCH /parametres-facturation/creancier` (contrats-api-etape-1.md §8.2, §7.9, §7.12,
 * RM-65 ; bloc créancier RF-54/PF-03, migration 0014).
 *
 * `CompteursModule` importé ici (et pas directement par `AppModule`) parce que `compteurs/` est
 * un sous-domaine de `parametrage/` — mais il est `@Global`, donc son unique import, où qu'il ait
 * lieu dans le graphe, suffit à rendre `JETON_COMPTEURS` disponible partout (`clients/`,
 * `atelier/`) sans qu'ils importent `ParametrageModule` (anti-cycle, voir `atelier.jetons.ts`).
 */
@Module({
  imports: [CompteursModule],
  controllers: [
    ParametresAtelierController,
    ParametresSiteController,
    PrestationsController,
    TauxHorairesController,
    BlocCreancierController,
  ],
  providers: [
    ServiceParametresAtelier,
    ServiceParametresSite,
    ServicePrestations,
    ServiceTauxHoraires,
    ServiceBlocCreancier,
  ],
})
export class ParametrageModule {}
