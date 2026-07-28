import { Module } from '@nestjs/common';
import { RechercheController } from './recherche.controller';
import { ServiceRecherche } from './service-recherche';

/**
 * `GET /recherche` — §7.5 du contrat d'API (L1-11).
 *
 * Importé dans `app.module.ts` par L1-16 (assemblage des 5 modules du lot 1).
 */
@Module({
  controllers: [RechercheController],
  providers: [ServiceRecherche],
})
export class RechercheModule {}
