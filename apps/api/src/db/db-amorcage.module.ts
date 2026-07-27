/**
 * `DbAmorcageModule` — accès aux 6 opérations d'authentification hors contexte tenant.
 *
 * DÉLIBÉRÉMENT PAS `@Global`, contrairement à `DbModule`.
 *
 * Ces opérations contournent le RLS (fonctions SECURITY DEFINER) : c'est inévitable, puisque
 * l'authentification consiste précisément à déterminer le tenant. Mais l'inévitable se confine.
 * Ce module n'est importé que par `AuthModule` ; aucun module métier ne peut injecter
 * `JETON_DB_AMORCAGE`, même par erreur d'inattention, car NestJS refusera de résoudre la
 * dépendance.
 *
 * La portée du module EST le contrôle d'accès. Si un jour un autre module a besoin d'importer
 * ce module, c'est le signe qu'il faut d'abord se demander pourquoi il travaille hors tenant.
 */

import { Module } from '@nestjs/common';

import { ServiceAccesAmorcage } from './acces-amorcage.service';
import { JETON_DB_AMORCAGE } from './db.jetons';

@Module({
  providers: [
    {
      provide: JETON_DB_AMORCAGE,
      useClass: ServiceAccesAmorcage,
    },
  ],
  exports: [JETON_DB_AMORCAGE],
})
export class DbAmorcageModule {}
