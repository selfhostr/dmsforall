import { Module } from '@nestjs/common';

import { ArticleController } from './article.controller';
import { CommandeFournisseurController } from './commande-fournisseur.controller';
import { ConsigneController } from './consigne.controller';
import { FactureFournisseurModule } from './factures-fournisseur/facture-fournisseur.module';
import { FournisseurController } from './fournisseur.controller';
import { MouvementController } from './mouvement.controller';
import { ParametragePiecesController } from './parametrage-pieces.controller';
import { ReapprovisionnementController } from './reapprovisionnement.controller';
import { ReservationController } from './reservation.controller';
import { ServiceArticle } from './service-article';
import { ServiceCommandeFournisseur } from './service-commande-fournisseur';
import { ServiceConsigne } from './service-consigne';
import { ServiceFournisseur } from './service-fournisseur';
import { ServiceMouvement } from './service-mouvement';
import { ServiceParametragePieces } from './service-parametrage-pieces';
import { ServiceReservation } from './service-reservation';
import { ServiceStock } from './service-stock';
import { StockArticleController } from './stock.controller';

/**
 * Module pièces (étape 3) : référentiel article (priorité 1), stock/mouvements (priorité 2),
 * disponibilité (priorité 3), réservations (priorité 4) — livrés par le lot précédent
 * (`docs/specification-etape-3-pieces.md`) — ET, ce lot : commandes fournisseur (RP-26→RP-31,
 * §6.2, machine à états jusqu'à la réception, jonction avec le stock), fournisseurs (RP-26, §1),
 * consignes d'échange standard (RP-37→RP-42, §6.4, lecture + `marquer-retour-fournisseur`) et
 * `GET|PATCH /parametrage/pieces` (§10, PP-01→PP-08).
 *
 * Périmètre RESTANT hors de ce module (voir le rapport de livraison de ce lot) : `POST /consignes`
 * (aucune route, la pose naît comme effet de bord de `atelier/`, GELÉ), l'atomicité consigne ↔
 * avoir facturation (RF-100, cross-module, non résolue).
 *
 * Vente comptoir (`RP-43`→`RP-48`) : le pont vers `facturation/` est câblé (`sortieComptoirPourLigneTx`/
 * `retourClientPourLigneTx`/`trouverMouvementParLigneDocumentTx`, `service-mouvement.ts`) — voir la
 * note d'intégration de `contrats/pieces/mouvement.ts` pour ce qui est couvert et ce qui reste
 * ouvert. `FacturationModule` importe ce module pour cette seule raison (même patron que
 * `AtelierModule` important déjà `PiecesModule` pour `ServiceReservation`/`ServiceConsigne`).
 *
 * `JETON_DB`/`JETON_IDEMPOTENCE` sont fournis par `DbModule`/`CommonModule` (tous deux `@Global`,
 * voir `app.module.ts`) : aucun des deux n'est importé ici, même précédent que `ClientsModule`.
 *
 * `FactureFournisseurModule` (lecture automatique des factures fournisseurs, `factures-fournisseur/`)
 * IMPORTÉ plutôt que ses providers/contrôleur listés ici directement : sous-module complet avec
 * ses propres providers internes (orchestrateur de lecture, port OCR) — même patron qu'un futur
 * sous-domaine encapsulé, évite de faire fuir ici des jetons qui n'intéressent que lui.
 */
@Module({
  imports: [FactureFournisseurModule],
  controllers: [
    ArticleController,
    StockArticleController,
    ReapprovisionnementController,
    MouvementController,
    ReservationController,
    FournisseurController,
    CommandeFournisseurController,
    ConsigneController,
    ParametragePiecesController,
  ],
  providers: [
    ServiceArticle,
    ServiceStock,
    ServiceMouvement,
    ServiceReservation,
    ServiceFournisseur,
    ServiceCommandeFournisseur,
    ServiceConsigne,
    ServiceParametragePieces,
  ],
  exports: [
    ServiceArticle,
    ServiceStock,
    ServiceMouvement,
    ServiceReservation,
    ServiceFournisseur,
    ServiceCommandeFournisseur,
    ServiceConsigne,
    ServiceParametragePieces,
  ],
})
export class PiecesModule {}
