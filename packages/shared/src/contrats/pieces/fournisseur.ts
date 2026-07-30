import { z } from 'zod';

import { STATUTS_FOURNISSEUR, type StatutFournisseur } from './enums';
import { schemaDelaiJours } from './primitives';
import { schemaEmail, schemaTelephoneE164, schemaTexteCourt } from '../atelier/primitives';
import { schemaParametresPage } from '../pagination';

/**
 * Le fournisseur — minimal pour l'étape 3 (§1, `RP-26`) : nom, coordonnées, délai habituel. La
 * fiche complète (conditions cadre, contrats de référencement, portails EDI constructeur) est
 * explicitement HORS PÉRIMÈTRE (feuille de route §5, connecteurs) — ce contrat n'anticipe rien
 * au-delà de ce que `RP-26`/`RP-29`/`RP-35` consomment réellement.
 */

export interface ReponseFournisseur {
  readonly id: string;
  readonly nom: string;
  readonly email: string | null;
  readonly telephone: string | null;
  /** Délai habituel de livraison, en jours (`RP-26`) — indicatif, jamais contractuel. */
  readonly delaiHabituelJours: number | null;
  readonly statut: StatutFournisseur;
  readonly creeLe: string;
  readonly modifieLe: string;
}

export const TRIS_FOURNISSEURS = ['nom:asc', 'nom:desc', 'creeLe:desc'] as const;
export const TRI_DEFAUT_FOURNISSEURS = 'nom:asc';

export const schemaFiltresFournisseurs = schemaParametresPage.extend({
  statut: z.array(z.enum(STATUTS_FOURNISSEUR)).optional(),
  tri: z.enum(TRIS_FOURNISSEURS).default(TRI_DEFAUT_FOURNISSEURS),
});
export type FiltresFournisseurs = z.infer<typeof schemaFiltresFournisseurs>;

/** `POST /fournisseurs` — pas d'`Idempotency-Key` : aucune ressource rare générée par le serveur
 *  (pas de numérotation, contrairement à `article`/`client`/OR) ; un doublon de nom n'est pas une
 *  collision technique, juste une fiche à fusionner plus tard (hors périmètre étape 3). */
export const schemaCreationFournisseur = z.object({
  nom: schemaTexteCourt,
  email: schemaEmail.nullish(),
  telephone: schemaTelephoneE164.nullish(),
  delaiHabituelJours: schemaDelaiJours.nullish(),
});
export type EntreeCreationFournisseur = z.infer<typeof schemaCreationFournisseur>;

export const schemaModificationFournisseur = schemaCreationFournisseur.partial();
export type EntreeModificationFournisseur = z.infer<typeof schemaModificationFournisseur>;

/** `POST /fournisseurs/{id}/desactiver` / `/reactiver` — pas de suppression, même doctrine que
 *  `article`/`client`/`vehicule` (RP-07, RM-12, RM-31). */
