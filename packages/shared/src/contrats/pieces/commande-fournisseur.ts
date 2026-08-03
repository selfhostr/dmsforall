import { z } from 'zod';

import {
  ORIGINES_COMMANDE_FOURNISSEUR,
  STATUTS_COMMANDE_FOURNISSEUR,
  type OrigineCommandeFournisseur,
  type StatutCommandeFournisseur,
} from './enums';
import { schemaCentimesPositif } from './primitives';
import {
  schemaDateJour,
  schemaIdentifiant,
  schemaMotif,
  schemaQuantiteMillieme,
} from '../atelier/primitives';
import { schemaParametresPage } from '../pagination';

/**
 * La commande fournisseur (`commande_fournisseur`, `commande_fournisseur_ligne`) — `RP-26` →
 * `RP-31`, machine à états §6.2.
 *
 * PAS de `PATCH` générique sur `statut` — même patron que `ordre-reparation.ts` et `document.ts` :
 * chaque transition est une ACTION NOMMÉE avec son corps propre (`envoyer`, `reception`,
 * `annuler-reliquat`, `annuler`).
 */

export interface ReponseLigneCommandeFournisseur {
  readonly id: string;
  readonly commandeFournisseurId: string;
  readonly numeroOrdre: number;
  readonly articleId: string;
  readonly quantiteCommandeeMillieme: number;
  /** Cumul des réceptions déjà enregistrées sur cette ligne (`RP-27`). */
  readonly quantiteRecueCumuleeMillieme: number;
  /** DÉRIVÉ : `max(0, quantiteCommandeeMillieme - quantiteRecueCumuleeMillieme)`, sauf si le
   *  reliquat a été annulé explicitement (`RP-28`), auquel cas il vaut `0` même si le cumul reçu
   *  reste inférieur à la quantité commandée — c'est `reliquatAnnuleLe` qui distingue les deux
   *  raisons pour lesquelles le reliquat est à zéro (livré en entier / abandonné). */
  readonly quantiteReliquatMillieme: number;
  readonly reliquatAnnuleLe: string | null;
  readonly reliquatMotifAnnulation: string | null;
  readonly prixAchatAttenduCentimes: number | null;
  /** Renseigné quand cette ligne a été créée depuis une réservation en rupture (`RP-24`, `RP-26`)
   *  — le fil qui relie « la pièce commandée » à « la ligne d'OR qui l'attend », consommé par
   *  l'atelier pour afficher la date d'arrivée annoncée sur l'OR (`RP-24`, dernier paragraphe). */
  readonly ligneOrOrigineId: string | null;
}

export interface ReponseCommandeFournisseur {
  readonly id: string;
  readonly fournisseurId: string;
  readonly siteId: string;
  readonly statut: StatutCommandeFournisseur;
  readonly origine: OrigineCommandeFournisseur;
  readonly dateCommande: string;
  /** Renseigné à `envoyer` (§6.2). */
  readonly envoyeeLe: string | null;
  /** Référence externe libre (numéro de commande porté par le fournisseur, si communiqué). */
  readonly reference: string | null;
  /** Renseigné uniquement pour `statut = 'annulee'` (§6.2, `POST /{id}/annuler`) — raison saisie
   *  par l'appelant, exigée en base par `commande_fournisseur_annulation_coherente_chk` (0034). */
  readonly motifAnnulation: string | null;
  readonly lignes: readonly ReponseLigneCommandeFournisseur[];
  readonly lignesTronquees: boolean;
  readonly creeLe: string;
  readonly modifieLe: string;
}

export const SEUIL_LIGNES_EMBARQUEES_COMMANDE_FOURNISSEUR = 100;

/* ------------------------------------------------------------------ */
/* Lecture — collection                                                */
/* ------------------------------------------------------------------ */

export const TRIS_COMMANDES_FOURNISSEUR = [
  'creeLe:desc',
  'creeLe:asc',
  'dateCommande:desc',
] as const;
export const TRI_DEFAUT_COMMANDES_FOURNISSEUR = 'creeLe:desc';

export const schemaFiltresCommandesFournisseur = schemaParametresPage.extend({
  statut: z.array(z.enum(STATUTS_COMMANDE_FOURNISSEUR)).optional(),
  fournisseurId: schemaIdentifiant.optional(),
  siteId: schemaIdentifiant.optional(),
  /** `true` : commandes avec au moins un reliquat non soldé (`RP-27`) — sucre équivalent à
   *  `statut: ['envoyee','partiellement_recue']`, documenté explicitement (même doctrine que
   *  `VUES_ORDRE_REPARATION`, §6.3 de l'étape 1 : une vue est toujours reproductible par les
   *  filtres primitifs). */
  avecReliquat: z.coerce.boolean().optional(),
  tri: z.enum(TRIS_COMMANDES_FOURNISSEUR).default(TRI_DEFAUT_COMMANDES_FOURNISSEUR),
});
export type FiltresCommandesFournisseur = z.infer<typeof schemaFiltresCommandesFournisseur>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /commandes-fournisseur` — `Idempotency-Key` OBLIGATOIRE (création sensible, listée
 * explicitement par le brief). Statut initial toujours `brouillon` — `statut` n'est jamais entrant.
 */
export const schemaLigneCreationCommandeFournisseur = z.object({
  articleId: schemaIdentifiant,
  quantiteCommandeeMillieme: schemaQuantiteMillieme,
  prixAchatAttenduCentimes: schemaCentimesPositif.nullish(),
  ligneOrOrigineId: schemaIdentifiant.nullish(),
});

export const schemaCreationCommandeFournisseur = z.object({
  fournisseurId: schemaIdentifiant,
  siteId: schemaIdentifiant,
  dateCommande: schemaDateJour.optional(),
  reference: z.string().trim().max(80).nullish(),
  origine: z.enum(ORIGINES_COMMANDE_FOURNISSEUR).default('manuelle'),
  lignes: z.array(schemaLigneCreationCommandeFournisseur).min(1).max(200),
});
export type EntreeCreationCommandeFournisseur = z.infer<typeof schemaCreationCommandeFournisseur>;

/** `POST /commandes-fournisseur/{id}/envoyer` — `brouillon → envoyee` (§6.2). Aucun corps requis ;
 *  pas d'`Idempotency-Key` (transition gardée par l'état de départ, même patron que
 *  `reservation.ts::schemaSatisfactionReservation`). */

/**
 * `POST /commandes-fournisseur/{id}/reception` — `Idempotency-Key` OBLIGATOIRE (génère un ou
 * plusieurs mouvements `entree_livraison`, création sensible). Le magasinier saisit ce qui est
 * EFFECTIVEMENT livré (§7.4), pas ce qui était commandé : `quantiteRecueMillieme` peut dépasser le
 * reliquat restant (avertissement `RECEPTION_EXCEDENT_RELIQUAT`, jamais un blocage — RP-27 ne
 * prévoit aucune limite haute) ou être inférieure (reliquat qui reste ouvert).
 */
export const schemaLigneReceptionCommandeFournisseur = z.object({
  ligneId: schemaIdentifiant,
  quantiteRecueMillieme: schemaQuantiteMillieme,
  /** Prix réellement payé, peut différer du prix attendu (`RP-29`) — enregistré sur le MOUVEMENT,
   *  jamais réécrit sur `prixAchatAttenduCentimes` de la ligne d'origine. */
  prixAchatReelCentimes: schemaCentimesPositif.nullish(),
  /**
   * Renseigné UNIQUEMENT quand la référence livrée diffère de celle commandée (`§7.4`, « le
   * fournisseur a substitué une équivalente sans prévenir »). Accepté par le serveur SEULEMENT si
   * `articleRecuId` est une référence `equivalente` (`RP-02`) connue de `article`
   * (`schemaLigneCreationCommandeFournisseur.articleId`) — sinon `409
   * RECEPTION_REFERENCE_NON_EQUIVALENTE`, pour ne jamais forcer une correspondance fausse
   * (§7.4 : « le magasinier crée l'écart en anomalie de réception plutôt que de forcer une
   * correspondance fausse »).
   */
  articleRecuId: schemaIdentifiant.nullish(),
  motif: schemaMotif.optional(),
});

export const schemaReceptionCommandeFournisseur = z.object({
  lignes: z.array(schemaLigneReceptionCommandeFournisseur).min(1).max(200),
});
export type EntreeReceptionCommandeFournisseur = z.infer<typeof schemaReceptionCommandeFournisseur>;

export interface ReponseReceptionCommandeFournisseur {
  /** Un mouvement `entree_livraison` par ligne reçue de cet appel (`mouvement.ts`). */
  readonly mouvementsCrees: readonly string[];
  readonly commandeFournisseur: ReponseCommandeFournisseur;
}

/**
 * `POST /commandes-fournisseur/{id}/lignes/{ligneId}/annuler-reliquat` — solde un reliquat SANS
 * livraison (`RP-28`). Pas d'`Idempotency-Key` : action gardée par l'état (reliquat non nul),
 * rejouer sur un reliquat déjà soldé produit `409 COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE` que le
 * reliquat ait été soldé par livraison OU par une annulation antérieure — le code ne distingue pas
 * la cause, `reliquatAnnuleLe`/`quantiteRecueCumuleeMillieme` de la ligne le font.
 */
export const schemaAnnulationReliquat = z.object({
  motif: schemaMotif,
});
export type EntreeAnnulationReliquat = z.infer<typeof schemaAnnulationReliquat>;

/** `POST /commandes-fournisseur/{id}/annuler` — UNIQUEMENT depuis `brouillon` ou `envoyee`, AVANT
 *  toute réception (§6.2 : après réception partielle, seul le reliquat s'annule ligne par ligne,
 *  jamais la commande entière — `409 COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE` sinon). */
export const schemaAnnulationCommandeFournisseur = z.object({
  motif: schemaMotif,
});
export type EntreeAnnulationCommandeFournisseur = z.infer<
  typeof schemaAnnulationCommandeFournisseur
>;
