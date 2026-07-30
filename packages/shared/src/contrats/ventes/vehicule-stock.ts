import { z } from 'zod';

import type { VehiculeResume } from '../atelier/vehicule';
import {
  schemaCentimesPositif,
  schemaDateJour,
  schemaIdentifiant,
  schemaTexteLong,
} from '../atelier/primitives';
import { schemaConfirmations } from '../atelier/avertissement';
import {
  ACTIONS_VEHICULE_STOCK,
  PROVENANCES_VEHICULE_STOCK,
  STATUTS_COMMERCIAUX_VEHICULE,
  TYPES_VEHICULE_VENTE,
  type ActionVehiculeStock,
  type ProvenanceVehiculeStock,
  type StatutCommercialVehicule,
  type TypeVehiculeVente,
} from './enums';

/**
 * Véhicule en stock (`RV-01` → `RV-14`) — EXTENSION de `vehicule` (étape 1), **pas une nouvelle
 * table racine** (`RV-01`, littéral). `id` ci-dessous EST `vehicule.id` : il n'existe pas de
 * second identifiant. Exposé sous `/vehicules/{vehiculeId}/stock` (0 ou 1 par véhicule) plutôt que
 * embarqué directement dans `ReponseVehicule` (`contrats/atelier/vehicule.ts`, hors périmètre de
 * ce fichier) pour ne pas alourdir la lecture d'un véhicule-client ordinaire qui n'a jamais été,
 * et ne sera jamais, en stock — un `GET /vehicules/{id}` reste la ressource légère de l'étape 1,
 * `GET /vehicules/{id}/stock` est l'extension propre à ce module (404 si le véhicule n'a jamais
 * été mis en stock).
 *
 * COORDINATION SIGNALÉE (hors périmètre d'écriture de ce fichier — `apps/api/src/auth/`,
 * `contrats/atelier/vehicule.ts`) : `ReponseVehicule` gagnerait à porter un champ
 * `readonly enStock: boolean` (ou `stockId: string | null`) pour qu'un client sache, depuis la
 * fiche véhicule ordinaire, qu'une extension stock existe sans avoir à sonder ce second endpoint
 * à vide à chaque fois — décision qui appartient au propriétaire de `contrats/atelier/vehicule.ts`.
 */

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

export interface ReponseVehiculeStock {
  /** = `vehicule.id` (`RV-01`). */
  readonly id: string;
  readonly siteId: string;
  readonly vehicule: VehiculeResume;
  readonly provenance: ProvenanceVehiculeStock;
  readonly dateEntreeStock: string;
  /** Centimes, obligatoire dès l'entrée en stock (`RV-03`) — sans lui, aucune marge n'a de sens.
   *  Sur une reprise (`provenance = 'reprise'`), c'est la VALEUR NÉGOCIÉE de la reprise qui est
   *  recopiée ici à l'entrée en stock, jamais la valeur estimée (`RV-24`, littéral) — voir
   *  `reprise.ts::ReponseReprise.valeurNegocieeCentimes`, la source. */
  readonly prixAchatCentimes: number;
  /** Dérivé, somme des OR de type `interne` liés à ce véhicule (`RV-04`). **[À VALIDER, `QV-02`]**
   *  — l'accroche exacte (comment un OR interne se lie à un véhicule EN STOCK plutôt qu'à un
   *  véhicule-client) n'est pas tranchée ; ce champ est LECTURE SEULE en attendant, jamais saisi
   *  directement, pour ne pas ouvrir une seconde source de vérité le jour où `QV-02` est validé. */
  readonly fraisRemiseEtatCumulesCentimes: number;
  /** `null` tant qu'aucun prix n'est fixé (VN pas encore chiffré, `RV-05`). */
  readonly prixVenteAfficheCentimes: number | null;
  readonly statutCommercial: StatutCommercialVehicule;
  /** Dérivé, jamais saisi (§8.2 — voir la note d'inférence sur `TypeVehiculeVente`, `enums.ts`). */
  readonly typeVehicule: TypeVehiculeVente;
  /** `RV-60` : `null` sauf `provenance` ∈ {`reprise`, `achat_particulier`} — donnée fournie à la
   *  facturation pour l'impôt préalable fictif (LTVA art. 28a), calcul hors périmètre de ce
   *  contrat (`QF-07`, non tranché). */
  readonly vendeurPrecedentAssujetti: boolean | null;
  /** Traçabilité : `null` sauf `provenance = 'reprise'` — pointe le dossier de vente dont la
   *  reprise a produit ce véhicule en stock (`reprise.ts`). */
  readonly origineRepriseDossierVenteId: string | null;
  /** Jours écoulés depuis `dateEntreeStock` jusqu'à `venduLe` (ou aujourd'hui si toujours en
   *  stock) — indicateur de pilotage (`RV-07`), n'apparaît sur AUCUN document client. Calculé à
   *  la lecture, jamais stocké. */
  readonly joursStock: number;
  readonly receptionneLe: string | null;
  readonly reserveLe: string | null;
  readonly venduLe: string | null;
  readonly livreLe: string | null;
  /** Actions possibles MAINTENANT — même principe que `ActionOrdreReparation` (`atelier/enums.ts`) :
   *  approximation utile au client, jamais la seule garde. */
  readonly actionsDisponibles: readonly ActionVehiculeStock[];
  readonly version: number;
  readonly creeLe: string;
  readonly modifieLe: string;
  readonly modifiePar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/** Projection minimale, embarquée dans `dossier-vente.ts` et les listes de véhicules en stock. */
export interface VehiculeStockResume {
  readonly id: string;
  readonly vehicule: VehiculeResume;
  readonly provenance: ProvenanceVehiculeStock;
  readonly typeVehicule: TypeVehiculeVente;
  readonly statutCommercial: StatutCommercialVehicule;
  readonly prixVenteAfficheCentimes: number | null;
  readonly joursStock: number;
}

/* ------------------------------------------------------------------ */
/* Filtres, tris                                                       */
/* ------------------------------------------------------------------ */

export const TRIS_VEHICULES_STOCK = [
  'dateEntreeStock:desc',
  'dateEntreeStock:asc',
  'joursStock:desc',
  'prixVenteAfficheCentimes:asc',
  'prixVenteAfficheCentimes:desc',
] as const;
export const TRI_DEFAUT_VEHICULES_STOCK = 'dateEntreeStock:desc';

export const schemaFiltresVehiculesStock = z.object({
  siteId: schemaIdentifiant.optional(),
  provenance: z.array(z.string()).optional(),
  statutCommercial: z.array(z.enum(STATUTS_COMMERCIAUX_VEHICULE)).optional(),
  typeVehicule: z.enum(TYPES_VEHICULE_VENTE).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  tri: z.enum(TRIS_VEHICULES_STOCK).default(TRI_DEFAUT_VEHICULES_STOCK),
});
export type FiltresVehiculesStock = z.infer<typeof schemaFiltresVehiculesStock>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /vehicules/{vehiculeId}/stock` — met un véhicule EXISTANT (`RV-01`, créé au préalable via
 * `POST /vehicules` de l'étape 1, y compris avec VIN vide pour un VN en commande, `RV-12`) en
 * stock. `Idempotency-Key` OBLIGATOIRE : un double-clic comptoir ne doit jamais produire deux
 * fiches de coût pour le même véhicule (`409 VENTE_VEHICULE_STOCK_DEJA_EXISTANT` sinon).
 *
 * `statutCommercial` initial est DÉRIVÉ, jamais saisi (§2.3 du patron OR, repris ici) :
 * `en_commande` si `provenance = 'neuf_constructeur'` et que le véhicule n'a pas encore de VIN
 * connu, `disponible` sinon.
 */
export const schemaMiseEnStock = z.object({
  siteId: schemaIdentifiant,
  provenance: z.string().trim().min(1).max(60),
  dateEntreeStock: schemaDateJour,
  prixAchatCentimes: schemaCentimesPositif,
  prixVenteAfficheCentimes: schemaCentimesPositif.nullish(),
  vendeurPrecedentAssujetti: z.boolean().nullish(),
});
export type EntreeMiseEnStock = z.infer<typeof schemaMiseEnStock>;

/** `PATCH /vehicules/{vehiculeId}/stock` — `prixAchatCentimes` reste modifiable jusqu'à
 *  `statutCommercial = 'vendu'` inclus exclu (contrôlé serveur, pas ici) : une correction après
 *  vente fausserait la marge d'une affaire déjà conclue — elle passe alors par une note interne,
 *  pas par ce endpoint. */
export const schemaModificationVehiculeStock = z.object({
  dateEntreeStock: schemaDateJour.optional(),
  prixAchatCentimes: schemaCentimesPositif.optional(),
  prixVenteAfficheCentimes: schemaCentimesPositif.nullish(),
  vendeurPrecedentAssujetti: z.boolean().nullish(),
});
export type EntreeModificationVehiculeStock = z.infer<typeof schemaModificationVehiculeStock>;

/** `POST /vehicules/{vehiculeId}/stock/receptionner` — réception physique d'un VN commandé
 *  (`en_commande → disponible`, `RV-09`). Le VIN et les caractéristiques réelles se saisissent par
 *  `PATCH /vehicules/{id}` (étape 1, hors périmètre) — cette action ne fait QUE la transition de
 *  statut commercial, elle ne duplique pas la fiche technique. */
export const schemaReceptionnerVehiculeStock = z.object({}).extend(schemaConfirmations.shape);
export type EntreeReceptionnerVehiculeStock = z.infer<typeof schemaReceptionnerVehiculeStock>;

/**
 * `POST /vehicules/{vehiculeId}/stock/remettre-disponible` — retour manuel à `disponible` depuis
 * `reserve`. **Normalement un EFFET DE BORD** de `POST /dossiers-vente/{id}/annuler` ou
 * `/abandonner` (`RV-10`, `CV-01`) — cette action directe n'existe que pour la correction
 * exceptionnelle (dossier orphelin, incohérence constatée), motif obligatoire pour la même raison
 * que `POST /ordres-reparation/{id}/rouvrir`.
 */
export const schemaRemettreDisponibleVehiculeStock = z.object({ motif: schemaTexteLong });
export type EntreeRemettreDisponibleVehiculeStock = z.infer<
  typeof schemaRemettreDisponibleVehiculeStock
>;
