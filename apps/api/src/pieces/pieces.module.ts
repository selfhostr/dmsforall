import { Module } from '@nestjs/common';

import { ArticleController } from './article.controller';
import { MouvementController } from './mouvement.controller';
import { ReapprovisionnementController } from './reapprovisionnement.controller';
import { ReservationController } from './reservation.controller';
import { ServiceArticle } from './service-article';
import { ServiceMouvement } from './service-mouvement';
import { ServiceReservation } from './service-reservation';
import { ServiceStock } from './service-stock';
import { StockArticleController } from './stock.controller';

/**
 * Module pièces (étape 3) : référentiel article (priorité 1), stock/mouvements (priorité 2),
 * disponibilité (priorité 3), réservations (priorité 4) — `docs/specification-etape-3-pieces.md`.
 *
 * Fournisseurs, commandes fournisseur, consignes d'échange standard et paramétrage NE SONT PAS
 * dans ce lot (hors des quatre priorités du brief) : leurs schémas de base et contrats OpenAPI
 * existent déjà (`db/schema/pieces/{fournisseur,commande-fournisseur,consigne,parametrage}.ts`,
 * `@dfa/shared`, `contrats/pieces/*`), mais aucun contrôleur/service ne les expose encore — signalé
 * dans le rapport de livraison, pas une omission silencieuse.
 *
 * `JETON_DB`/`JETON_IDEMPOTENCE` sont fournis par `DbModule`/`CommonModule` (tous deux `@Global`,
 * voir `app.module.ts`) : aucun des deux n'est importé ici, même précédent que `ClientsModule`.
 */
@Module({
  controllers: [
    ArticleController,
    StockArticleController,
    ReapprovisionnementController,
    MouvementController,
    ReservationController,
  ],
  providers: [ServiceArticle, ServiceStock, ServiceMouvement, ServiceReservation],
  exports: [ServiceArticle, ServiceStock, ServiceMouvement, ServiceReservation],
})
export class PiecesModule {}
