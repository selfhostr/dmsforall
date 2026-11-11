/**
 * `InstallationModule` — création du premier garage depuis le navigateur (routes publiques).
 *
 * Importe `AuthModule` pour la session et le hachage du mot de passe (mêmes services que la
 * connexion). L'accès base propre à l'installation (rôle propriétaire, voir
 * `fournisseur-connexion-pg.ts`) n'est fourni qu'ici.
 */
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JETON_CONFIG } from '../config/config.jetons';
import type { Config } from '../config/config.types';
import { FournisseurConnexionPg } from './fournisseur-connexion-pg';
import { InstallationController } from './installation.controller';
import { JETON_CONNEXION_INSTALLATION } from './installation.types';
import { ServiceInstallation } from './service-installation';

@Module({
  imports: [AuthModule],
  controllers: [InstallationController],
  providers: [
    ServiceInstallation,
    {
      provide: JETON_CONNEXION_INSTALLATION,
      inject: [JETON_CONFIG],
      useFactory: (config: Config) => new FournisseurConnexionPg(config.DATABASE_URL_MIGRATION),
    },
  ],
  exports: [ServiceInstallation],
})
export class InstallationModule {}
