import type { CodeErreur } from '@dfa/shared';

/**
 * Interprétation des violations de contrainte Postgres du module véhicules — SANS analyser le
 * texte du message, seulement `code` (SQLSTATE) et `constraint` (nom de la contrainte), à
 * l'identique de la doctrine de `common/avertissements/traducteur-erreur-transition-sql.ts`.
 *
 * Deux SQLSTATE concernés :
 *  - `23505` (unique_violation) — `vehicule_vin_actif_uk` (RM-15, index partiel `statut = 'actif'`).
 *  - `23P01` (exclusion_violation) — `vehicule_plaque_collision_excl` (RM-18) et
 *    `vehicule_detention_unicite_excl` (RM-20, CT-47).
 */

const SQLSTATE_UNICITE = '23505';
const SQLSTATE_EXCLUSION = '23P01';

interface ErreurPgBrute {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

/**
 * Contrat §7.4 : `vehicule_detention_unicite_excl` produit `VALIDATION_ECHOUEE` (« deux
 * détenteurs courants ») sur les deux endpoints atomiques (`POST /detentions`,
 * `POST /changer-detenteur`) — pas un `CONFLIT` générique, littéralement ce que dit la table du
 * contrat d'API pour `GET|POST /vehicules/{vehiculeId}/detentions`.
 */
const CONTRAINTES_VEHICULE: Readonly<Record<string, CodeErreur>> = {
  vehicule_vin_actif_uk: 'VEHICULE_VIN_EXISTANT',
  vehicule_plaque_collision_excl: 'VEHICULE_PLAQUE_COLLISION',
  vehicule_detention_unicite_excl: 'VALIDATION_ECHOUEE',
};

export interface ContrainteVehiculeViolee {
  readonly code: CodeErreur;
  readonly contrainte: string;
}

/**
 * Rend `null` si l'exception n'est pas une violation de contrainte reconnue de ce module —
 * l'appelant retombe alors sur son traitement générique, jamais sur une supposition.
 */
export function interpreterContrainteVehicule(erreur: unknown): ContrainteVehiculeViolee | null {
  if (typeof erreur !== 'object' || erreur === null) {
    return null;
  }
  const brute = erreur as ErreurPgBrute;

  if (brute.code !== SQLSTATE_UNICITE && brute.code !== SQLSTATE_EXCLUSION) {
    return null;
  }
  if (typeof brute.constraint !== 'string') {
    return null;
  }
  const code = CONTRAINTES_VEHICULE[brute.constraint];
  if (!code) {
    return null;
  }
  return { code, contrainte: brute.constraint };
}
