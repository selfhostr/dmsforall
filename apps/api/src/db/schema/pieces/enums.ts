/**
 * Énumérations Postgres de l'étape 3 (pièces).
 *
 * Dérivées de `@dfa/shared` (`contrats/pieces/enums.ts`, `contrats/pieces/parametrage.ts`),
 * SOURCE UNIQUE — même doctrine que `schema/atelier/enums.ts`. Les types PG sont créés dans
 * `migrations/0022_pieces_referentiel.sql` (statut_fournisseur, statut_article,
 * type_reference_article, categorie_article), `0024_pieces_commande_fournisseur.sql`
 * (statut_commande_fournisseur, origine_commande_fournisseur), `0025_pieces_stock_mouvements.sql`
 * (type_mouvement_stock), `0026_pieces_reservation.sql` (statut_reservation_piece,
 * motif_liberation_reservation), `0027_pieces_consigne.sql` (statut_consigne_echange_standard) et
 * `0028_pieces_parametrage.sql` (methode_prix_achat).
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  CATEGORIES_ARTICLE,
  METHODES_PRIX_ACHAT,
  MOTIFS_LIBERATION_RESERVATION,
  ORIGINES_COMMANDE_FOURNISSEUR,
  STATUTS_ARTICLE,
  STATUTS_COMMANDE_FOURNISSEUR,
  STATUTS_CONSIGNE_ECHANGE_STANDARD,
  STATUTS_FOURNISSEUR,
  STATUTS_RESERVATION_PIECE,
  TYPES_MOUVEMENT_STOCK,
  TYPES_REFERENCE_ARTICLE,
} from '@dfa/shared';

// --- 0022 (référentiel) --------------------------------------------------------------------
export const statutFournisseurEnum = pgEnum('statut_fournisseur', STATUTS_FOURNISSEUR);
export const statutArticleEnum = pgEnum('statut_article', STATUTS_ARTICLE);
export const typeReferenceArticleEnum = pgEnum('type_reference_article', TYPES_REFERENCE_ARTICLE);
export const categorieArticleEnum = pgEnum('categorie_article', CATEGORIES_ARTICLE);

// --- 0024 (commande fournisseur) ---------------------------------------------------------------
export const statutCommandeFournisseurEnum = pgEnum(
  'statut_commande_fournisseur',
  STATUTS_COMMANDE_FOURNISSEUR,
);
export const origineCommandeFournisseurEnum = pgEnum(
  'origine_commande_fournisseur',
  ORIGINES_COMMANDE_FOURNISSEUR,
);

// --- 0025 (stock, mouvements) --------------------------------------------------------------
export const typeMouvementStockEnum = pgEnum('type_mouvement_stock', TYPES_MOUVEMENT_STOCK);

// --- 0026 (réservation) ---------------------------------------------------------------------
export const statutReservationPieceEnum = pgEnum(
  'statut_reservation_piece',
  STATUTS_RESERVATION_PIECE,
);
export const motifLiberationReservationEnum = pgEnum(
  'motif_liberation_reservation',
  MOTIFS_LIBERATION_RESERVATION,
);

// --- 0027 (consigne) ------------------------------------------------------------------------
export const statutConsigneEchangeStandardEnum = pgEnum(
  'statut_consigne_echange_standard',
  STATUTS_CONSIGNE_ECHANGE_STANDARD,
);

// --- 0028 (paramétrage) ---------------------------------------------------------------------
export const methodePrixAchatEnum = pgEnum('methode_prix_achat', METHODES_PRIX_ACHAT);
