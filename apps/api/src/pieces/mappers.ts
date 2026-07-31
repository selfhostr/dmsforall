import type {
  DonneesAvertissementReservationIndisponible,
  LigneReapprovisionnement,
  ReponseArticle,
  ReponseArticleReference,
  ReponseDisponibiliteArticle,
  ReponseMouvementStock,
  ReponseReservationPiece,
  ReponseStockArticle,
  ReservationActiveResume,
  ResultatRechercheComptoirArticle,
  StockResumeArticle,
} from '@dfa/shared';
import type { RoleUtilisateur } from '@dfa/shared';

import { enDate } from '../db';
import type {
  LigneArticle,
  LigneArticleReference,
  LigneMouvementStock,
  LigneReservationPiece,
  LigneStockArticle,
} from '../db/schema';

/**
 * Rôles auxquels `ReponseArticle.prixAchatCentimes` est masqué (`null` renvoyé quelle que soit la
 * valeur en base) — §11 de `docs/specification-etape-3-pieces.md`, ligne « Voir prix d'achat /
 * marge ». Même doctrine que `ROLES_SANS_MONTANT`/`ROLES_SANS_MONTANT_FACTURATION`
 * (`auth/matrice-droits.ts`, `facturation/documents/mappeurs.ts`) : le filtrage d'un champ
 * financier est une décision d'AUTORISATION appliquée côté serveur, jamais une préférence
 * d'affichage front — vit ici, localement au domaine, comme son homologue facturation.
 *
 * `vendeur`/`receptionnaire` : « non (P) » dans la matrice §11 — paramétrable en théorie, mais
 * AUCUN paramètre `parametre_pieces` ne porte ce réglage (`PP-01`→`PP-08` n'en prévoit aucun pour
 * la visibilité du prix d'achat) : traité comme un « non » ferme pour ce lot, non paramétrable.
 * `technicien` : « non » littéral. `admin` : « non » (RF-115, aucun droit métier). `direction`,
 * `comptable`, `chef_atelier` (« oui (P) », traité oui par défaut faute de paramètre dédié),
 * `magasinier` : « oui ».
 */
export const ROLES_SANS_PRIX_ACHAT_PIECES: readonly RoleUtilisateur[] = [
  'vendeur',
  'receptionnaire',
  'technicien',
  'admin',
];

export function versArticleReferenceResponse(ligne: LigneArticleReference): ReponseArticleReference {
  return {
    id: ligne.id,
    articleId: ligne.articleId,
    type: ligne.type,
    reference: ligne.reference,
    fournisseurId: ligne.fournisseurId,
    creeLe: enDate(ligne.creeLe).toISOString(),
  };
}

export function versArticleResponse(
  ligne: LigneArticle,
  role: RoleUtilisateur,
  references: readonly ReponseArticleReference[],
  referencesTronquees: boolean,
  stocksResume: readonly StockResumeArticle[],
): ReponseArticle {
  const masquerPrixAchat = ROLES_SANS_PRIX_ACHAT_PIECES.includes(role);
  return {
    id: ligne.id,
    // `numeroArticle` nullable côté Drizzle (voir schema/pieces/article.ts) mais toujours
    // renseigné après INSERT par le trigger `attribuer_numero_article()` (0022) — une ligne
    // chargée depuis la base porte donc toujours une valeur ; `?? ''` est un filet défensif
    // improbable plutôt qu'un cas normal, jamais silencieusement avalé (voir ARTICLE_NUMERO_ABSENT
    // en cas de doute futur — non introduit ici, hors périmètre de ce mapper).
    numeroArticle: ligne.numeroArticle ?? '',
    designation: ligne.designation,
    marque: ligne.marque,
    categorie: ligne.categorie,
    statut: ligne.statut,
    referencePrincipale: ligne.referencePrincipale,
    codeBarres: ligne.codeBarres,
    prixAchatCentimes: masquerPrixAchat ? null : ligne.prixAchatCentimes,
    prixVenteTtcCentimes: ligne.prixVenteTtcCentimes,
    tauxTvaPourmille: ligne.tauxTvaPourmille,
    estEchangeStandard: ligne.estEchangeStandard,
    montantConsigneTtcCentimes: ligne.montantConsigneTtcCentimes,
    referenceRemplacementId: ligne.referenceRemplacementId,
    references,
    referencesTronquees,
    stocksResume,
    creeLe: enDate(ligne.creeLe).toISOString(),
    modifieLe: enDate(ligne.modifieLe).toISOString(),
  };
}

export function versStockResumeArticle(ligne: LigneStockArticle): StockResumeArticle {
  return {
    siteId: ligne.siteId,
    quantitePhysiqueMillieme: ligne.quantitePhysiqueMillieme,
    quantiteDisponibleMillieme: ligne.quantitePhysiqueMillieme - ligne.quantiteReserveeMillieme,
  };
}

export function versStockResponse(ligne: LigneStockArticle): ReponseStockArticle {
  return {
    articleId: ligne.articleId,
    siteId: ligne.siteId,
    quantitePhysiqueMillieme: ligne.quantitePhysiqueMillieme,
    quantiteReserveeMillieme: ligne.quantiteReserveeMillieme,
    quantiteDisponibleMillieme: ligne.quantitePhysiqueMillieme - ligne.quantiteReserveeMillieme,
    emplacement: ligne.emplacement,
    stockMinimumMillieme: ligne.stockMinimumMillieme,
    quantiteCommandeStandardMillieme: ligne.quantiteCommandeStandardMillieme,
    modifieLe: enDate(ligne.modifieLe).toISOString(),
  };
}

/** `ligne` peut être `null` : aucune ligne `stock_article` n'existe encore pour ce (article, site). */
export function versDisponibiliteResponse(
  articleId: string,
  siteId: string,
  ligne: LigneStockArticle | null,
  reservationsActives: readonly ReservationActiveResume[],
  reservationsActivesTronquees: boolean,
): ReponseDisponibiliteArticle {
  const physique = ligne?.quantitePhysiqueMillieme ?? 0;
  const reservee = ligne?.quantiteReserveeMillieme ?? 0;
  return {
    articleId,
    siteId,
    quantitePhysiqueMillieme: physique,
    quantiteReserveeMillieme: reservee,
    quantiteDisponibleMillieme: physique - reservee,
    reservationsActives,
    reservationsActivesTronquees,
  };
}

/**
 * `donnees` provient d'une jointure (`reservation_piece` × `ligne_or`/`ordre_reparation`/`client`) —
 * voir `service-stock.ts`. `type` et non `interface`, délibérément (même patron que `PostureTable`,
 * `db/acces-base.service.ts`, en-tête) : Drizzle contraint le paramètre de `tx.execute<T>()` à
 * `Record<string, unknown>`, satisfait par un alias de type structurel (TS2344 sinon), jamais par
 * une interface nominale.
 */
export type DonneesReservationActive = {
  readonly reservationId: string;
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  readonly numeroOrdreReparation: string;
  readonly clientNomAffichage: string;
  readonly quantiteMillieme: number;
  // `Date | string` : SQL brut (`tx.execute`), même piège que le reste du dépôt — voir `enDate()`.
  readonly reserveeLe: Date | string;
};

export function versReservationActiveResume(donnees: DonneesReservationActive): ReservationActiveResume {
  return {
    reservationId: donnees.reservationId,
    ligneOrId: donnees.ligneOrId,
    ordreReparationId: donnees.ordreReparationId,
    numeroOrdreReparation: donnees.numeroOrdreReparation,
    clientNomAffichage: donnees.clientNomAffichage,
    quantiteMillieme: donnees.quantiteMillieme,
    reserveeLe: enDate(donnees.reserveeLe).toISOString(),
  };
}

export function versAvertissementReservationIndisponible(
  articleId: string,
  siteId: string,
  reservationsActives: readonly ReservationActiveResume[],
): DonneesAvertissementReservationIndisponible {
  return { articleId, siteId, reservationsActives };
}

export function versMouvementResponse(ligne: LigneMouvementStock): ReponseMouvementStock {
  return {
    id: ligne.id,
    articleId: ligne.articleId,
    type: ligne.type,
    quantiteMillieme: ligne.quantiteMillieme,
    siteId: ligne.siteId,
    siteSourceId: ligne.siteSourceId,
    siteDestinationId: ligne.siteDestinationId,
    prixAchatReelCentimes: ligne.prixAchatReelCentimes,
    auteurId: ligne.auteurId,
    motif: ligne.motif,
    ligneOrId: ligne.ligneOrId,
    documentVenteLigneId: ligne.documentVenteLigneId,
    commandeFournisseurLigneId: ligne.commandeFournisseurLigneId,
    inventaireReferenceId: ligne.inventaireReferenceId,
    reservationId: ligne.reservationId,
    creeLe: enDate(ligne.creeLe).toISOString(),
  };
}

export function versReservationResponse(ligne: LigneReservationPiece): ReponseReservationPiece {
  return {
    id: ligne.id,
    articleId: ligne.articleId,
    siteId: ligne.siteId,
    ligneOrId: ligne.ligneOrId,
    ordreReparationId: ligne.ordreReparationId,
    quantiteMillieme: ligne.quantiteMillieme,
    statut: ligne.statut,
    creeLe: enDate(ligne.creeLe).toISOString(),
    satisfaiteLe: ligne.satisfaiteLe ? enDate(ligne.satisfaiteLe).toISOString() : null,
    mouvementSortieId: ligne.mouvementSortieId,
    libereeLe: ligne.libereeLe ? enDate(ligne.libereeLe).toISOString() : null,
    motifLiberation: ligne.motifLiberation,
    motifLiberationTexte: ligne.motifLiberationTexte,
    libereeParUtilisateurId: ligne.libereeParUtilisateurId,
  };
}

/** `ligne`/`emplacement` proviennent de `recherche-comptoir` — voir `service-article.ts`. */
export interface DonneesRechercheComptoir {
  readonly articleId: string;
  readonly numeroArticle: string;
  readonly designation: string;
  readonly referencePrincipale: string;
  readonly prixVenteTtcCentimes: number;
  readonly quantiteDisponibleMillieme: number;
  readonly emplacement: string | null;
  readonly estEchangeStandard: boolean;
  readonly montantConsigneTtcCentimes: number | null;
}

export function versRechercheComptoirResultat(donnees: DonneesRechercheComptoir): ResultatRechercheComptoirArticle {
  return { ...donnees };
}

export function versLigneReapprovisionnement(donnees: {
  readonly articleId: string;
  readonly numeroArticle: string;
  readonly designation: string;
  readonly siteId: string;
  readonly quantiteDisponibleMillieme: number;
  readonly stockMinimumMillieme: number;
  readonly quantiteCommandeStandardMillieme: number | null;
}): LigneReapprovisionnement {
  return {
    ...donnees,
    ecartMillieme: donnees.stockMinimumMillieme - donnees.quantiteDisponibleMillieme,
  };
}
