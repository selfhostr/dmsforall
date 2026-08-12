import { z } from 'zod';

import { schemaEmplacement } from './primitives';
import { schemaIdentifiant, schemaQuantiteMillieme } from '../atelier/primitives';
import { schemaParametresPage } from '../pagination';

/**
 * Le stock par site (`stock_article`) — `RP-09` → `RP-15`.
 *
 * `quantiteDisponibleMillieme = quantitePhysiqueMillieme - quantiteReserveeMillieme` (`RP-14`) est
 * TOUJOURS un champ DÉRIVÉ, jamais stocké ni entrant : c'est l'écart entre les deux qui rend
 * visible « cette pièce existe en stock mais n'est plus libre », et un client qui recalculerait ce
 * nombre lui-même finirait par diverger dès qu'une réservation change hors de sa vue.
 */

export interface ReponseStockArticle {
  readonly articleId: string;
  readonly siteId: string;
  readonly quantitePhysiqueMillieme: number;
  /** Somme des réservations `active` sur ce couple (article, site) — `reservation.ts`. */
  readonly quantiteReserveeMillieme: number;
  /** `RP-14`. Jamais négatif : une réservation ne peut excéder le stock physique au moment où
   *  elle est posée (voir `RP-19`/`RP-24` — au-delà, la ligne bascule `blocage = 'pieces'` plutôt
   *  que de produire une réservation partielle). */
  readonly quantiteDisponibleMillieme: number;
  readonly emplacement: string | null;
  readonly stockMinimumMillieme: number | null;
  /** Quantité de commande standard (`RP-12`) : le fournisseur vend par lot de 10, pas à l'unité. */
  readonly quantiteCommandeStandardMillieme: number | null;
  readonly modifieLe: string;
}

/* ------------------------------------------------------------------ */
/* Disponibilité — LE terrain de `CP-02`                               */
/* ------------------------------------------------------------------ */

/**
 * Trois informations qui NE SE RESSEMBLENT PAS, et qu'un simple nombre à 0 confond dangereusement
 * (constat terrain : plusieurs défauts produits par cette confusion) :
 *  - `suivi`             : une ligne `stock_article` existe pour CE (article, site) précis —
 *    `quantiteDisponibleMillieme` est fiable, y COMPRIS quand elle vaut 0 (« il n'en reste
 *    aucun » se lit alors dans le nombre, pas dans ce statut).
 *  - `nonSuiviSurCeSite` : aucune ligne pour ce site, mais l'article est suivi sur AU MOINS UN
 *    autre site du tenant — « on ne sait pas » pour CE site précisément, ce n'est ni un stock nul
 *    ni une absence de gestion en stock.
 *  - `nonSuiviNullePart` : aucune ligne `stock_article` n'existe pour cet article, sur AUCUN site
 *    du tenant — l'article n'a jamais été mis en stock (« l'article n'est suivi nulle part »).
 *
 * Quand `statutSuivi !== 'suivi'`, les quantités de la réponse valent 0 par convention et NE
 * DOIVENT JAMAIS être lues comme « stock nul » : c'est `statutSuivi` qui porte l'information,
 * jamais le nombre brut seul — voir `ReponseDisponibiliteArticle`/`ResultatRechercheComptoirArticle`.
 */
export const STATUTS_SUIVI_STOCK_ARTICLE = [
  'suivi',
  'nonSuiviSurCeSite',
  'nonSuiviNullePart',
] as const;
export type StatutSuiviStockArticle = (typeof STATUTS_SUIVI_STOCK_ARTICLE)[number];

/**
 * `GET /articles/{id}/disponibilite?siteId=` — la réponse qui rend `RP-14`/`RP-19` VÉRIFIABLE par
 * un tiers, et qui donne au réceptionnaire de quoi dire « cette pièce est déjà réservée pour l'OR
 * de M. Dupont » plutôt que de laisser l'implémentation inventer une phrase.
 *
 * Distincte de `ReponseStockArticle` (qui ne porte que les AGRÉGATS) : celle-ci NOMME les
 * réservations actives, une par une, avec de quoi les afficher sans appel supplémentaire —
 * `reservationsActives` reste bornée (`SEUIL_RESERVATIONS_DISPONIBILITE`), un article ne devrait
 * jamais accumuler des dizaines de réservations actives simultanées sur un même site.
 */
export interface ReponseDisponibiliteArticle {
  readonly articleId: string;
  readonly siteId: string;
  readonly quantitePhysiqueMillieme: number;
  readonly quantiteReserveeMillieme: number;
  readonly quantiteDisponibleMillieme: number;
  /** Voir `StatutSuiviStockArticle` — à lire AVANT les quantités ci-dessus. */
  readonly statutSuivi: StatutSuiviStockArticle;
  readonly reservationsActives: readonly ReservationActiveResume[];
  readonly reservationsActivesTronquees: boolean;
}

/**
 * Le « qui » de la réservation — champs minimaux pour que le réceptionnaire identifie l'OR et le
 * client SANS exposer de montant (cette réponse est accessible à tout rôle qui peut consulter le
 * stock, `§11` de la spec, y compris le technicien — donc AUCUN champ financier ici).
 */
export interface ReservationActiveResume {
  readonly reservationId: string;
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  /** Numéro d'affichage de l'OR (ex. `OR-1042`), même champ que `ReponseOrdreReparation.numero`
   *  côté atelier — recopié ici pour éviter un aller-retour, PAS une nouvelle numérotation. */
  readonly numeroOrdreReparation: string;
  /** Nom d'affichage du client de l'OR (`ReponseClient.designation`, recopié) — jamais l'objet
   *  client complet : cette réponse n'est pas un point d'entrée vers la fiche client. */
  readonly clientNomAffichage: string;
  readonly quantiteMillieme: number;
  readonly reserveeLe: string;
}

export const SEUIL_RESERVATIONS_DISPONIBILITE = 20;

/**
 * Même forme, portée par `Avertissement.donnees` quand une ligne d'OR pièce ne peut PAS obtenir de
 * réservation faute de disponibilité (`RP-24`, `CP-02`) — succès AVEC réserve, jamais une erreur
 * (la ligne se crée quand même, `blocage = 'pieces'`). Le code d'avertissement associé,
 * `PIECE_RESERVATION_INDISPONIBLE`, est déclaré dans `contrats/probleme.ts::CODES_AVERTISSEMENT`.
 *
 * INTÉGRATION HORS PÉRIMÈTRE DE CE FICHIER : c'est `POST /ordres-reparation/{orId}/lignes`
 * (`contrats/atelier/ligne.ts`, GELÉ, propriété d'un autre agent) qui doit émettre cet
 * avertissement avec ces données au moment de la création de ligne. Ce fichier fige la FORME de
 * l'information ; le raccordement au point d'émission est un signalement à l'orchestrateur, pas
 * une implémentation ici.
 */
export interface DonneesAvertissementReservationIndisponible {
  readonly articleId: string;
  readonly siteId: string;
  readonly reservationsActives: readonly ReservationActiveResume[];
}

/* ------------------------------------------------------------------ */
/* Réapprovisionnement (RP-12)                                         */
/* ------------------------------------------------------------------ */

/**
 * `GET /stock/reapprovisionnement?siteId=` — articles sous leur `stockMinimumMillieme`. **Ne
 * commande jamais automatiquement** (`RP-12` : « ça propose, ça ne commande jamais automatiquement
 * sans validation du magasinier ») — strictement une liste consultable, dont chaque ligne peut
 * ensuite alimenter `POST /commandes-fournisseur` avec `origine: 'reapprovisionnement'`.
 */
export const TRIS_REAPPROVISIONNEMENT = ['ecartMillieme:desc', 'ecartMillieme:asc'] as const;
export const TRI_DEFAUT_REAPPROVISIONNEMENT = 'ecartMillieme:desc';

export const schemaFiltresReapprovisionnement = schemaParametresPage.extend({
  siteId: schemaIdentifiant,
  tri: z.enum(TRIS_REAPPROVISIONNEMENT).default(TRI_DEFAUT_REAPPROVISIONNEMENT),
});
export type FiltresReapprovisionnement = z.infer<typeof schemaFiltresReapprovisionnement>;

export interface LigneReapprovisionnement {
  readonly articleId: string;
  readonly numeroArticle: string;
  readonly designation: string;
  readonly siteId: string;
  readonly quantiteDisponibleMillieme: number;
  readonly stockMinimumMillieme: number;
  /** `stockMinimumMillieme - quantiteDisponibleMillieme`, toujours > 0 dans cette liste. */
  readonly ecartMillieme: number;
  readonly quantiteCommandeStandardMillieme: number | null;
}

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/** `PATCH /articles/{id}/stock/{siteId}` — réglages de site, PAS la quantité physique (qui ne
 *  bouge que par mouvement, `RP-16`→`RP-18` : aucune écriture directe sur `quantitePhysiqueMillieme`
 *  n'existe dans ce contrat, exactement pour empêcher un ajustement silencieux hors traçabilité). */
export const schemaModificationStockSite = z.object({
  emplacement: schemaEmplacement.nullish(),
  stockMinimumMillieme: schemaQuantiteMillieme.nullish(),
  quantiteCommandeStandardMillieme: schemaQuantiteMillieme.nullish(),
});
export type EntreeModificationStockSite = z.infer<typeof schemaModificationStockSite>;
