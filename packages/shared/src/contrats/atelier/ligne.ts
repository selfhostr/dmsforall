import { z } from 'zod';

import {
  BLOCAGES_LIGNE_OR,
  ORIGINES_LIGNE_OR,
  PAYEURS_LIGNE_OR,
  STATUTS_LIGNE_OR,
  TYPES_LIGNE_OR,
  URGENCES_TRAVAIL,
  type BlocageLigneOr,
  type OrigineLigneOr,
  type PayeurLigneOr,
  type StatutLigneOr,
  type TypeLigneOr,
  type UrgenceTravail,
} from './enums';
import {
  schemaCentiemes,
  schemaCentimes,
  schemaIdentifiant,
  schemaListeIdentifiants,
  schemaMotif,
  schemaPourmille,
  schemaQuantiteMillieme,
  schemaTexteCourt,
} from './primitives';

/**
 * Lignes d'ordre de réparation (contrats-api-etape-1.md §7.8).
 *
 * **Aucun `DELETE`.** RM-71 / CT-27 : une ligne s'annule AVEC MOTIF et reste visible. C'est le
 * point où une API mal conçue détruit une preuve, et c'est la raison pour laquelle le privilège
 * `DELETE` n'est même pas accordé au rôle applicatif en base.
 */

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

/**
 * Montants d'une ligne. **Absents en bloc** pour un rôle sans droit aux montants
 * (`ROLES_SANS_MONTANT`, aujourd'hui `technicien`) : le filtrage est une décision
 * d'AUTORISATION, appliquée côté serveur, y compris dans `blocages` (§3.5 règle 4).
 *
 * Ordre de calcul GELÉ : montant brut -> rabais -> **arrondi au centime (ligne)** -> TVA sur le HT
 * arrondi de la ligne -> arrondi au centime -> agrégation. Aucun arrondi au 5 centimes au lot 1 :
 * c'est une règle de paiement en ESPÈCES, donc étape 2.
 *
 * Invariant garanti en base : `montantTtcCentimes = montantHtCentimes + montantTvaCentimes`.
 */
export interface MontantsLigneOr {
  readonly montantHtCentimes: number;
  readonly montantTvaCentimes: number;
  readonly montantTtcCentimes: number;
}

export interface ReponseLigneOr {
  readonly id: string;
  readonly ordreReparationId: string;
  /** Rang d'affichage dans l'OR, stable. Tri par défaut de la sous-collection. */
  readonly numeroOrdre: number;
  readonly type: TypeLigneOr;
  readonly origine: OrigineLigneOr;
  readonly statut: StatutLigneOr;
  readonly payeur: PayeurLigneOr;
  /** Ce qui remonte dans les drapeaux `attentes` de l'OR (A-03). */
  readonly blocage: BlocageLigneOr;
  readonly designation: string;
  readonly referenceTexte: string | null;
  /** Accroche étape 3 (stock pièces) : `null` tant que le module n'existe pas. */
  readonly articleId: string | null;
  readonly quantiteMillieme: number;
  readonly tempsBaremeCentiemes: number | null;
  /** RM-69 : le barème constructeur, conservé même quand le garage applique le sien. */
  readonly tempsBaremeConstructeurCentiemes: number | null;
  readonly tempsReelCentiemes: number | null;
  /**
   * VALEURS FIGÉES à la création (RM-50, RM-65, RM-07) : taux horaire, prix unitaire, taux de TVA
   * et conditions client sont CAPTURÉS PAR LE SERVEUR au moment de la création. Le client ne les
   * envoie jamais et ne les recalcule jamais ; ils sont en lecture seule, avec `figeLe`.
   */
  readonly tauxHoraireCentimes?: number | null;
  readonly prixUnitaireCentimes?: number | null;
  readonly rabaisPourmille: number;
  readonly tauxTvaPourmille: number;
  readonly figeLe: string | null;
  /** Absents pour un rôle sans droit aux montants. */
  readonly montants?: MontantsLigneOr;
  readonly technicienId: string | null;
  readonly codeOperation: string | null;
  readonly codeDefaut: string | null;
  readonly numeroSinistre: string | null;
  readonly numeroAccord: string | null;
  readonly urgence: UrgenceTravail | null;
  /** §6.12 : une ligne de sécurité refusée déclenche `OR_RESERVE_SECURITE_REQUISE` à la restitution. */
  readonly securite: boolean;
  /** RM-77 : pièce apportée par le client (décharge). */
  readonly fournieParClient: boolean;
  /** RM-78 : pièce remplacée que le client demande à récupérer. */
  readonly aRestituer: boolean;
  readonly restituee: boolean;
  readonly motifAnnulation: string | null;
  /** Accroche étape 2. Absent tant qu'il est vide — l'ajout d'un champ est additif. */
  readonly factureId: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/* ------------------------------------------------------------------ */
/* Filtres et tris (§6.2)                                              */
/* ------------------------------------------------------------------ */

/**
 * `GET /ordres-reparation/{orId}/lignes` est une collection paginée destinée aux CONNECTEURS ;
 * l'écran lit les lignes embarquées dans l'OR (§8.3). Les deux existent, aucune ne doublonne
 * l'autre.
 */
export const TRIS_LIGNES_OR = ['ordreAffichage:asc', 'ordreAffichage:desc'] as const;
export const TRI_DEFAUT_LIGNES_OR = 'ordreAffichage:asc';

export const schemaFiltresLignesOr = z.object({
  statut: z.array(z.enum(STATUTS_LIGNE_OR)).optional(),
  origine: z.enum(ORIGINES_LIGNE_OR).optional(),
  payeur: z.enum(PAYEURS_LIGNE_OR).optional(),
  technicienId: schemaIdentifiant.optional(),
  tri: z.enum(TRIS_LIGNES_OR).default(TRI_DEFAUT_LIGNES_OR),
});

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /ordres-reparation/{orId}/lignes` — `Idempotency-Key` OBLIGATOIRE : la saisie se fait en
 * rafale au comptoir, et un double `Entrée` ne doit pas créer deux lignes.
 *
 * `statut` n'est JAMAIS entrant : il découle de l'origine et des paramètres. `tauxHoraireCentimes`
 * et `tauxTvaPourmille` non plus — ils sont figés par le serveur.
 */
export const schemaCreationLigneOr = z.object({
  type: z.enum(TYPES_LIGNE_OR),
  origine: z.enum(ORIGINES_LIGNE_OR),
  designation: schemaTexteCourt,
  referenceTexte: z.string().trim().max(80).nullish(),
  quantiteMillieme: schemaQuantiteMillieme.default(1000),
  tempsBaremeCentiemes: schemaCentiemes.nullish(),
  /**
   * Prix saisi par le comptoir quand il n'y a pas de catalogue. Signé : une ligne de type
   * `remise` porte un montant négatif. Pour une prestation catalogue, utiliser
   * `POST /lignes-depuis-prestation` — le prix y est figé par le serveur.
   */
  prixUnitaireCentimes: schemaCentimes.nullish(),
  rabaisPourmille: schemaPourmille.default(0),
  payeur: z.enum(PAYEURS_LIGNE_OR).default('client'),
  technicienId: schemaIdentifiant.nullish(),
  urgence: z.enum(URGENCES_TRAVAIL).nullish(),
  securite: z.boolean().default(false),
  fournieParClient: z.boolean().default(false),
  pieceARestituer: z.boolean().default(false),
  codeOperation: z.string().trim().max(40).nullish(),
  codeDefaut: z.string().trim().max(40).nullish(),
  numeroSinistre: z.string().trim().max(60).nullish(),
  numeroAccord: z.string().trim().max(60).nullish(),
  blocage: z.enum(BLOCAGES_LIGNE_OR).default('aucun'),
});

/**
 * `PATCH /ordres-reparation/{orId}/lignes/{ligneId}` — champs LIBRES seulement.
 * `statut` reste en lecture seule : il change par action nommée, jamais par mise à jour de champ.
 * Sur une ligne déjà `validee`, une hausse de montant peut produire `409 OR_PLAFOND_DEPASSE`.
 */
export const schemaModificationLigneOr = schemaCreationLigneOr
  .omit({ origine: true, blocage: true })
  .partial()
  .extend({ blocage: z.enum(BLOCAGES_LIGNE_OR).optional() });

/**
 * `POST /…/lignes/{ligneId}/marquer-realisee` — RESTE SUR LA LIGNE (et non groupée au niveau de
 * l'OR) parce que son corps est propre à la ligne et qu'elle ne porte AUCUN invariant inter-lignes.
 * `refusee` ne devient jamais `realisee` (RM-72, CT-28 -> `LIGNE_TRANSITION_INTERDITE`).
 */
export const schemaMarquageRealisee = z.object({
  tempsReelCentiemes: schemaCentiemes.optional(),
});

/**
 * Actions GROUPÉES, portées par l'OR (§7.7) — voir `ordre-reparation.ts`.
 *
 * Une action de ligne est groupée au niveau de l'OR **si et seulement si** elle porte un invariant
 * INTER-LIGNES (le plafond) ou un motif PARTAGÉ. Sinon elle reste sur la ligne.
 */
export const schemaValidationLignes = z.object({ ligneIds: schemaListeIdentifiants });

export const schemaRefusLignes = z.object({
  ligneIds: schemaListeIdentifiants,
  motif: schemaMotif.optional(),
});

/** RM-71 : le motif est OBLIGATOIRE — une annulation sans motif détruit la traçabilité. */
export const schemaAnnulationLignes = z.object({
  ligneIds: schemaListeIdentifiants,
  motif: schemaMotif,
});

export const schemaSoumissionLignesADevis = z.object({ ligneIds: schemaListeIdentifiants });

/** `POST /…/lignes-depuis-prestation` — prix FIGÉS par le serveur à la création (catalogue §7.9). */
export const schemaLigneDepuisPrestation = z.object({
  prestationId: schemaIdentifiant,
  quantiteMillieme: schemaQuantiteMillieme.optional(),
});

/** `POST /…/lignes-depuis-travaux-reportes` (RM-73) — reprise au passage suivant. */
export const schemaLignesDepuisTravauxReportes = z.object({
  travailReporteIds: schemaListeIdentifiants,
});

export type EntreeCreationLigneOr = z.infer<typeof schemaCreationLigneOr>;
export type EntreeModificationLigneOr = z.infer<typeof schemaModificationLigneOr>;
export type EntreeMarquageRealisee = z.infer<typeof schemaMarquageRealisee>;
export type EntreeValidationLignes = z.infer<typeof schemaValidationLignes>;
export type EntreeRefusLignes = z.infer<typeof schemaRefusLignes>;
export type EntreeAnnulationLignes = z.infer<typeof schemaAnnulationLignes>;
export type EntreeSoumissionLignesADevis = z.infer<typeof schemaSoumissionLignesADevis>;
export type EntreeLigneDepuisPrestation = z.infer<typeof schemaLigneDepuisPrestation>;
export type EntreeLignesDepuisTravauxReportes = z.infer<typeof schemaLignesDepuisTravauxReportes>;
export type FiltresLignesOr = z.infer<typeof schemaFiltresLignesOr>;
