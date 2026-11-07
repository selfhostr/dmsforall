import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CapacitesController } from './capacites.controller';
import { BorneController } from './borne.controller';
import { SiteController } from './site.controller';
import { TenantController } from './tenant.controller';
import { UtilisateurController } from './utilisateur.controller';
import { ServiceBorne } from './service-borne';
import { ServiceSite } from './service-site';
import { ServiceTenant } from './service-tenant';
import { ServiceUtilisateur } from './service-utilisateur';

/**
 * Endpoints 4-5-6 du contrat étape 0 (tenant courant + sites, lecture seule) + gestion des
 * employés (issue #137, `UtilisateurController`/`ServiceUtilisateur`).
 *
 * `AuthModule` importé UNIQUEMENT pour son `JETON_SERVICE_MOT_DE_PASSE` exporté (Argon2id) —
 * `ServiceUtilisateur` en a besoin pour hacher le mot de passe temporaire qu'il génère à la
 * création d'un employé et à la réinitialisation d'accès. `AuthModule` est déjà importé par
 * `AppModule` (il fournit les deux `APP_GUARD` globaux) : Nest ne l'instancie pas deux fois, ce
 * second import rend simplement ses exports résolvables ici.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    TenantController,
    SiteController,
    UtilisateurController,
    BorneController,
    CapacitesController,
  ],
  providers: [ServiceTenant, ServiceSite, ServiceUtilisateur, ServiceBorne],
})
export class SocleModule {}
