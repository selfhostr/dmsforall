import { Module } from '@nestjs/common';

import { JETON_STOCKAGE_PHOTOS } from './photos.jetons';
import { PhotosLigneController } from './photos-ligne.controller';
import { ServicePhotosLigne } from './service-photos-ligne';
import { StockagePhotosDisqueLocal } from './stockage-photos';

/**
 * Photos des lignes d'OR. Stockage : adaptateur disque local derrière `JETON_STOCKAGE_PHOTOS`
 * (même schéma que `JETON_STOCKAGE_PDF`) ; exporté pour que la résiliation d'un tenant puisse
 * appeler `purgerTenant` (voir le rapport de livraison : branchement hors périmètre).
 */
@Module({
  controllers: [PhotosLigneController],
  providers: [
    ServicePhotosLigne,
    { provide: JETON_STOCKAGE_PHOTOS, useClass: StockagePhotosDisqueLocal },
  ],
  exports: [JETON_STOCKAGE_PHOTOS],
})
export class PhotosLigneModule {}
