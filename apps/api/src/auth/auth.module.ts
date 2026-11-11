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

import { CourrielModule } from '../courriel';
import { DbAmorcageModule } from '../db/db-amorcage.module';
import { GardeDroit } from '../common/droits';
import { AuthController } from './auth.controller';
import { GardeSession } from './garde-session';
import {
  JETON_SERVICE_MOT_DE_PASSE,
  JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE,
  JETON_SERVICE_SESSION,
} from './jetons';
import { ServicePolitiqueMotDePasse } from './politique-mot-de-passe';
import { ServiceProfilCourant } from './services/profil-courant.service';
import { ServiceAuthentificationImpl } from './services/authentification.service';
import { ServiceMotDePasseArgon2id } from './services/mot-de-passe.service';
import { ServiceReinitialisationMotDePasseImpl } from './services/reinitialisation-mot-de-passe.service';
import { ServiceSessionImpl } from './services/session.service';

@Module({
  // `CourrielModule` : `ServiceReinitialisationMotDePasseImpl` en a besoin pour envoyer le lien
  // de réinitialisation (`ServiceCourriel.envoyer`) — voir son en-tête. Interface PUBLIQUE du
  // socle courriel, déjà stable au moment où ce module a été branché (texte seul, sans pièce
  // jointe) ; `courriel/` reste hors périmètre d'écriture de cette tâche, aucun de ses fichiers
  // n'est touché ici.
  imports: [DbAmorcageModule, CourrielModule],
  controllers: [AuthController],
  providers: [
    // Services exposés par jeton : les consommateurs dépendent de l'interface du contrat
    // (§2.10) et jamais de l'implémentation — c'est ce qui permet de remplacer Argon2id ou le
    // stockage de session sans toucher une ligne des appelants.
    { provide: JETON_SERVICE_MOT_DE_PASSE, useClass: ServiceMotDePasseArgon2id },
    { provide: JETON_SERVICE_SESSION, useClass: ServiceSessionImpl },
    {
      provide: JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE,
      useClass: ServiceReinitialisationMotDePasseImpl,
    },

    // Injecté par classe : seul le contrôleur d'auth l'utilise, aucune substitution prévue.
    ServiceAuthentificationImpl,
    ServiceProfilCourant,
    ServicePolitiqueMotDePasse,

    // Garde d'authentification appliquée à TOUTE l'application. Les endpoints publics sont
    // l'exception explicite, marquée par @Public() — jamais l'inverse. Un endpoint qu'on
    // oublie de décorer est donc protégé par défaut, ce qui est le sens correct de l'oubli.
    { provide: APP_GUARD, useClass: GardeSession },

    // Garde d'AUTORISATION, appliquée à TOUTE l'application en second `APP_GUARD` — l'ordre de
    // déclaration dans ce tableau fixe l'ordre d'exécution : `GardeSession` résout et attache le
    // principal avant que `GardeDroit` ne l'évalue. Enregistrée ici (et non laissée au seul
    // `@UseGuards(GardeDroit)` posé au cas par cas sur les contrôleurs) parce que compter sur une
    // douzaine de contrôleurs du lot 1 (54 actions) pour poser chacun ce guard à la main est
    // exactement le genre de discipline qui finit par s'oublier une fois — voir le commentaire
    // d'en-tête de `GardeDroit.canActivate` sur le refus par défaut qui rend cet oubli visible
    // (403) plutôt que silencieux. `GardeDroit` lui-même reste fourni comme provider ordinaire par
    // `CommonModule` (`@Global()`) : un `@UseGuards(GardeDroit)` explicite sur un contrôleur reste
    // possible mais devient redondant avec ce guard global — le check est un pur calcul sans effet
    // de bord (aucune écriture, aucun log), donc l'exécuter deux fois ne casse rien, ça ne fait
    // que gaspiller un cycle. `MATRICE_DROITS` reste lue depuis `auth/matrice-droits.ts`, un
    // module de données pures — c'est ce qui évite le cycle d'imports common ↔ auth.
    { provide: APP_GUARD, useClass: GardeDroit },
  ],
  // `JETON_SERVICE_MOT_DE_PASSE` exporté depuis issue #137 : `SocleModule` (ServiceUtilisateur)
  // en a besoin pour hacher le mot de passe temporaire généré à la création d'un employé et à la
  // réinitialisation d'accès — même Argon2id que la connexion, jamais une seconde implémentation.
  // `JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE` exporté pour la même raison : `SocleModule`
  // (`ServiceUtilisateur.reinitialiserAcces`) en a besoin pour révoquer, DANS SA PROPRE
  // transaction, tout jeton de réinitialisation en libre-service encore valide d'un employé —
  // voir le commentaire de `revoquerJetonsActifsDansTransaction` (`auth.types.ts`).
  // `ServiceAuthentificationImpl` exporté pour `InstallationModule` : l'écran « Créer votre garage »
  // ouvre la session du premier compte par le même service que la connexion.
  exports: [
    ServiceAuthentificationImpl,
    JETON_SERVICE_SESSION,
    JETON_SERVICE_MOT_DE_PASSE,
    JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE,
  ],
})
export class AuthModule {}
