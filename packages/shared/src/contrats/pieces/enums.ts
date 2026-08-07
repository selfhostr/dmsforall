/**
 * Enums métier de l'étape 3 — Pièces (`docs/specification-etape-3-pieces.md`, repères `RP-xx`).
 *
 * Même doctrine que `contrats/atelier/enums.ts` : valeurs en **snake_case**, miroir exact des
 * types PostgreSQL à créer, deux classes de compatibilité :
 *  - **GELÉS** (`x-dfa-enum-extensible: false`) — machines à états qui portent un invariant
 *    inter-domaine (concurrence sur une réservation, chaîne financière de la consigne) : aucune
 *    valeur n'est ajoutée en v1, un client peut les énumérer exhaustivement.
 *  - **EXTENSIBLES** (`x-dfa-enum-extensible: true`) — tout le reste. Un client tiers doit traiter
 *    une valeur inconnue comme « autre » et ne jamais échouer.
 *
 * Chaque enum porte sa classe et sa source `RP-xx` en commentaire.
 */

/* ------------------------------------------------------------------ */
/* Article et références (RP-01 → RP-08)                               */
/* ------------------------------------------------------------------ */

/**
 * `statut_article` — extensible. Cycle réversible (`actif` ↔ `obsolete` ↔ `desactive`, §6.1 de la
 * spec) : PAS une machine à états stricte au sens `STATUTS_ORDRE_REPARATION` (aucune séquence
 * imposée, aucune action groupée inter-lignes qui en dépend), donc pas de raison de la geler.
 * `desactive` exige l'absence de réservation active — condition SERVEUR, pas visible dans l'enum.
 */
export const STATUTS_ARTICLE = ['actif', 'obsolete', 'desactive'] as const;
export type StatutArticle = (typeof STATUTS_ARTICLE)[number];

/**
 * `type_reference_article` — extensible (`RP-02`).
 *
 * INFÉRENCE, documentée : la spécification écrit littéralement `fournisseur_X` (« la référence
 * propre au catalogue d'un fournisseur donné ») — lu ici comme UNE valeur `fournisseur` plus un
 * champ structuré `fournisseurId` (voir `ReponseArticleReference`), plutôt que comme une famille de
 * valeurs d'enum dynamiques par fournisseur (`fournisseur_bosch`, `fournisseur_febi`…). Un enum ne
 * doit jamais porter de valeurs générées à l'exécution — le fournisseur est une donnée, pas un type.
 */
export const TYPES_REFERENCE_ARTICLE = ['equivalente', 'remplace_par', 'fournisseur'] as const;
export type TypeReferenceArticle = (typeof TYPES_REFERENCE_ARTICLE)[number];

/**
 * `categorie_article` — extensible (`RP-06`). Détermine au minimum le taux de TVA par défaut de
 * l'article et peut alimenter une remise catégorielle côté client (`RM-07`, spec étape 1).
 */
export const CATEGORIES_ARTICLE = [
  'piece_mecanique',
  'piece_carrosserie',
  'pneu',
  'lubrifiant',
  'produit_atelier',
  'fourniture',
] as const;
export type CategorieArticle = (typeof CATEGORIES_ARTICLE)[number];

/* ------------------------------------------------------------------ */
/* Stock et mouvements (RP-09 → RP-18)                                  */
/* ------------------------------------------------------------------ */

/**
 * `type_mouvement_stock` — extensible, **littéralement la liste de `RP-16`** (« Cette liste est
 * extensible… ajouter une valeur ne casse rien qui lise l'enum en s'attendant à une liste
 * fermée »).
 */
export const TYPES_MOUVEMENT_STOCK = [
  'entree_livraison',
  'sortie_or',
  'sortie_comptoir',
  'retour_fournisseur',
  'retour_client',
  'transfert',
  'ajustement_inventaire',
  'casse',
  'perte',
  'retour_consigne',
] as const;
export type TypeMouvementStock = (typeof TYPES_MOUVEMENT_STOCK)[number];

/* ------------------------------------------------------------------ */
/* Réservation (RP-19 → RP-25) — LE cœur du sujet                      */
/* ------------------------------------------------------------------ */

/**
 * `statut_reservation_piece` — **GELÉ**, §6.3. Trois états, deux TERMINAUX (`satisfaite`,
 * `liberee`) qui ne retirent plus rien du stock disponible (`RP-14`). Gelé délibérément malgré sa
 * petite taille : c'est l'objet qui arbitre le conflit `CP-02` (deux OR sur le dernier exemplaire)
 * — un client tiers doit pouvoir énumérer ces trois valeurs sans risque de valeur inconnue en
 * pleine lecture de disponibilité.
 */
export const STATUTS_RESERVATION_PIECE = ['active', 'satisfaite', 'liberee'] as const;
export type StatutReservationPiece = (typeof STATUTS_RESERVATION_PIECE)[number];

/**
 * `motif_liberation_reservation` — extensible. Les TROIS cas de `RP-23`, littéralement : ligne
 * annulée, ligne refusée par décision de devis (`DECISIONS_DEVIS`, `contrats/atelier/enums.ts`),
 * ou geste explicite du magasinier. Catégorise un événement déjà survenu — ne pilote aucune
 * transition, donc pas de raison de le geler.
 *
 * `liberation_forcage_stock` (0047) — QUATRIÈME cas, automatique lui aussi : un mouvement `casse`/
 * `perte` FORCÉ (`forcer: true`, RP-15/PP-02) qui dépasse le stock PHYSIQUE, pas seulement le
 * disponible, oblige à réduire des réservations `active` pour que `reservee` ne dépasse jamais ce
 * qui reste VRAIMENT en stock (CP-02 reste vrai même quand la réalité physique vient d'être
 * corrigée à la baisse). Réservations les PLUS RÉCENTES du (article, site) libérées en premier,
 * en totalité (jamais une fraction), jusqu'à couvrir le déficit — voir
 * `ServiceReservation.libererPourCascadeForcageTx`, `apps/api/src/pieces/service-reservation.ts`.
 */
export const MOTIFS_LIBERATION_RESERVATION = [
  'annulation_ligne',
  'refus_devis',
  'liberation_manuelle',
  'liberation_forcage_stock',
] as const;
export type MotifLiberationReservation = (typeof MOTIFS_LIBERATION_RESERVATION)[number];

/* ------------------------------------------------------------------ */
/* Fournisseur et commande fournisseur (RP-26 → RP-31)                 */
/* ------------------------------------------------------------------ */

/** `statut_fournisseur` — extensible. Minimal, aucune notion de blocage/crédit à ce stade (§1). */
export const STATUTS_FOURNISSEUR = ['actif', 'inactif'] as const;
export type StatutFournisseur = (typeof STATUTS_FOURNISSEUR)[number];

/**
 * `statut_commande_fournisseur` — **GELÉ**, §6.2. Machine à états à part entière (transitions
 * nommées, invariant de reliquat inter-lignes `RP-27`/`RP-28`) — même doctrine que
 * `STATUTS_DOCUMENT_VENTE` : les transitions autorisées vivent côté serveur, pas dans ce type ; un
 * client ne doit jamais déduire une transition valide de cet enum seul.
 *
 * MÉCANISME EN BASE, corrigé pour suivre le schéma livré (une première version de ce commentaire
 * inventait une table dédiée `transition_commande_fournisseur_autorisee`, qui n'existe pas) :
 * `commande_fournisseur` passe par le dispositif GÉNÉRIQUE posé en `0003`
 * (`public.transition_autorisee`, filtrée sur `entite = 'commande_fournisseur'`, + trigger
 * `verifier_transition('commande_fournisseur')`) — PAS par une table dédiée comme
 * `transition_document_autorisee` (facturation, `0010`), qui est un mécanisme réellement distinct
 * propre à ce domaine-là. Les deux se lisent depuis l'API de la même façon (409 sur transition
 * refusée), mais un futur `GET /referentiel/transitions` ne doit pas supposer la même table
 * source pour les deux domaines.
 */
export const STATUTS_COMMANDE_FOURNISSEUR = [
  'brouillon',
  'envoyee',
  'partiellement_recue',
  'recue',
  'cloturee',
  'annulee',
] as const;
export type StatutCommandeFournisseur = (typeof STATUTS_COMMANDE_FOURNISSEUR)[number];

/** `origine_commande_fournisseur` — extensible (`RP-26`) : les trois façons littérales dont une
 *  commande peut naître. */
export const ORIGINES_COMMANDE_FOURNISSEUR = [
  'manuelle',
  'reservation_rupture',
  'reapprovisionnement',
] as const;
export type OrigineCommandeFournisseur = (typeof ORIGINES_COMMANDE_FOURNISSEUR)[number];

/* ------------------------------------------------------------------ */
/* Consigne — échange standard (RP-37 → RP-42)                         */
/* ------------------------------------------------------------------ */

/**
 * `statut_consigne_echange_standard` — **GELÉ**, §6.4. Gelé parce qu'un état de consigne engage
 * directement la chaîne financière `RF-100` (facturation) : un client qui affiche « consigne non
 * remboursée » sur la base de cet enum doit pouvoir le faire sans repli sur « valeur inconnue ».
 *
 * `deposee_par_client` reste dans l'enum pour fidélité au diagramme §6.4, mais N'EST ATTEINT PAR
 * AUCUNE action exposée par ce contrat : `RP-38` décrit le dépôt et la réception en stock comme le
 * MÊME geste (« un mouvement d'entrée particulier »), donc la création d'une consigne
 * (`POST /consignes`, voir `consigne.ts`) produit directement `en_attente_retour_fournisseur`.
 * Cette valeur est conservée pour un futur flux en deux temps (dépôt physique constaté par le
 * réceptionnaire, entrée en stock actée plus tard par le magasinier) si la pratique le confirme —
 * INFÉRENCE, à valider avec @laupernoe si le terrain distingue réellement les deux instants.
 */
export const STATUTS_CONSIGNE_ECHANGE_STANDARD = [
  'deposee_par_client',
  'en_attente_retour_fournisseur',
  'retournee_fournisseur',
] as const;
export type StatutConsigneEchangeStandard = (typeof STATUTS_CONSIGNE_ECHANGE_STANDARD)[number];
