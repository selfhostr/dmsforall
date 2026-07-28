import { Global, Module } from '@nestjs/common';
import { JETON_COMPTEURS } from './compteurs.jetons';
import { ServiceCompteursImpl } from './service-compteurs';

/**
 * Fournit `JETON_COMPTEURS` (`ServiceCompteurs`, numérotation atomique — RM-49/RM-11) à toute
 * l'application, sans que les consommateurs (`clients/`, `atelier/`) n'aient besoin d'importer
 * `ParametrageModule` — voir la doctrine posée dans `compteurs.jetons.ts` : le jeton est obtenu
 * par `Symbol.for`, la même règle que `JETON_DB`/`JETON_IDEMPOTENCE`/`JETON_EVENEMENTS`/
 * `JETON_AUDIT`, tous fournis par des modules `@Global`.
 *
 * Extrait de `ParametrageModule` (plutôt que fourni directement par lui) précisément pour pouvoir
 * être `@Global` indépendamment : `ParametrageModule` lui-même n'a pas de raison de l'être (ses
 * contrôleurs n'ont pas besoin d'être visibles ailleurs), alors que ce jeton, si.
 */
@Global()
@Module({
  providers: [{ provide: JETON_COMPTEURS, useClass: ServiceCompteursImpl }],
  exports: [JETON_COMPTEURS],
})
export class CompteursModule {}
