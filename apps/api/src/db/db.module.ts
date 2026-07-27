/**
 * `DbModule` — accès aux tables métier, disponible partout.
 *
 * `@Global` parce que tout module métier a besoin de la base, et qu'imposer un
 * `imports: [DbModule]` dans chaque module n'apporterait aucune garantie supplémentaire :
 * la vraie frontière n'est pas l'injection, c'est `enTenant()`, qui exige un `ContexteTenant`
 * pour produire la moindre requête.
 *
 * N'exporte que `JETON_DB`, typé `AccesBase`. Ni le `Pool` pg ni le handle Drizzle brut ne
 * sortent d'ici : il n'existe aucun chemin permettant à un service métier d'ouvrir une
 * transaction sans poser le contexte tenant.
 */

import { Global, Module } from '@nestjs/common';

import { ServiceAccesBase } from './acces-base.service';
import { JETON_DB } from './db.jetons';

@Global()
@Module({
  providers: [
    {
      provide: JETON_DB,
      useClass: ServiceAccesBase,
    },
  ],
  exports: [JETON_DB],
})
export class DbModule {}
