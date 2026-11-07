import type { EntreeCreationRapideOrdreReparation } from '@dfa/shared';

/**
 * Types du parcours « ouvrir un OR depuis une plaque » : le serveur crée (client) + (véhicule) + OR
 * dans UNE transaction (`POST /ordres-reparation/creation-rapide`), il n'y a donc plus de reprise
 * à orchestrer côté écran.
 */

type CorpsClient = EntreeCreationRapideOrdreReparation['client'];
type CorpsVehicule = EntreeCreationRapideOrdreReparation['vehicule'];

export type EntreeClientRapide = Extract<CorpsClient, { nouveau: unknown }>['nouveau'];
export type EntreeVehiculeRapide = Extract<CorpsVehicule, { nouveau: unknown }>['nouveau'];

export type PlanClient =
  | { readonly mode: 'existant'; readonly id: string }
  | { readonly mode: 'nouveau'; readonly entree: EntreeClientRapide };

export type PlanVehicule =
  | { readonly mode: 'existant'; readonly id: string }
  | { readonly mode: 'nouveau'; readonly entree: EntreeVehiculeRapide };

/** Téléphone suisse saisi au comptoir : au moins 4 caractères (contrat `telephone`). */
export function telephoneValide(saisie: string): boolean {
  return saisie.trim().length >= 4;
}
