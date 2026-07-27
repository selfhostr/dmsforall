/**
 * `AuthModule` — authentification par session et garde d'accès globale.
 *
 * Ce module est volontairement AUTOSUFFISANT : `AppModule` se contente de l'importer, sans
 * rien reconfigurer. C'est lui qui déclare son propre `APP_GUARD` et qui importe
 * `DbAmorcageModule`. La raison est de sécurité, pas de style : si le câblage de la garde
 * dépendait d'`AppModule`, un futur module racine de test (ou une refonte distraite) pourrait
 * démarrer l'application sans garde, et TOUS les endpoints deviendraient publics en silence.
 * Ici, importer `AuthModule` suffit à ce que la garde s'applique.
 *
 * `DbAmorcageModule` n'est importé QUE d'ici. C'est le seul module autorisé à atteindre les
 * 6 fonctions `SECURITY DEFINER` du schéma `amorcage`, qui travaillent hors contexte tenant —
 * inévitable puisque l'authentification consiste précisément à déterminer le tenant. La portée
 * du module EST le contrôle d'accès : aucun module métier ne peut injecter `JETON_DB_AMORCAGE`,
 * NestJS refuserait de résoudre la dépendance.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DbAmorcageModule } from '../db/db-amorcage.module';
import { AuthController } from './auth.controller';
import { GardeSession } from './garde-session';
import { JETON_SERVICE_MOT_DE_PASSE, JETON_SERVICE_SESSION } from './jetons';
import { ServiceAuthentificationImpl } from './services/authentification.service';
import { ServiceMotDePasseArgon2id } from './services/mot-de-passe.service';
import { ServiceSessionImpl } from './services/session.service';

@Module({
  imports: [DbAmorcageModule],
  controllers: [AuthController],
  providers: [
    // Services exposés par jeton : les consommateurs dépendent de l'interface du contrat
    // (§2.10) et jamais de l'implémentation — c'est ce qui permet de remplacer Argon2id ou le
    // stockage de session sans toucher une ligne des appelants.
    { provide: JETON_SERVICE_MOT_DE_PASSE, useClass: ServiceMotDePasseArgon2id },
    { provide: JETON_SERVICE_SESSION, useClass: ServiceSessionImpl },

    // Injecté par classe : seul le contrôleur d'auth l'utilise, aucune substitution prévue.
    ServiceAuthentificationImpl,

    // Garde d'authentification appliquée à TOUTE l'application. Les endpoints publics sont
    // l'exception explicite, marquée par @Public() — jamais l'inverse. Un endpoint qu'on
    // oublie de décorer est donc protégé par défaut, ce qui est le sens correct de l'oubli.
    { provide: APP_GUARD, useClass: GardeSession },

    // L'AUTORISATION n'est pas déclarée ici : `GardeDroit` (common/droits) est le mécanisme
    // unique, appliqué endpoint par endpoint via `@ExigerDroit(...)`. Il lit `MATRICE_DROITS`
    // depuis `auth/matrice-droits.ts`, un module de données pures — c'est ce qui évite le cycle
    // d'imports common ↔ auth.
  ],
  exports: [JETON_SERVICE_SESSION],
})
export class AuthModule {}
