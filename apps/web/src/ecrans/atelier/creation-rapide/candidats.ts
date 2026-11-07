import type { ResultatRecherche, VehiculeResume } from '@dfa/shared';

import { objetResume, texteResume } from '@/composants/recherche/resume';
import { formaterPlaque } from '@/lib/plaque';

/** Véhicule proposé à la réception : issu de la recherche par plaque ou des véhicules du client. */
export interface CandidatVehicule {
  readonly id: string;
  readonly designation: string;
  /** Plaque déjà composée pour l'affichage (« VD 123456 »), `null` si le véhicule n'en porte pas. */
  readonly plaque: string | null;
  readonly detenteurNom: string | null;
  /** Un OR est déjà ouvert sur ce véhicule : à dire AVANT d'en ouvrir un second. */
  readonly orOuvert: boolean;
  /** La plaque tapée est une ancienne plaque de ce véhicule : jamais choisi automatiquement. */
  readonly plaqueHistorique: boolean;
}

export function candidatDepuisRecherche(resultat: ResultatRecherche): CandidatVehicule {
  const plaque = texteResume(resultat.resume.plaque);
  return {
    id: resultat.id,
    designation: texteResume(resultat.resume.designation) ?? '',
    plaque: plaque ? formaterPlaque(plaque) : null,
    detenteurNom: texteResume(resultat.resume.detenteurNom),
    orOuvert: objetResume(resultat.resume.ordreReparationOuvert) !== null,
    plaqueHistorique: resultat.correspondance.historique,
  };
}

export function candidatDepuisVehicule(vehicule: VehiculeResume): CandidatVehicule {
  const plaque = vehicule.plaque
    ? formaterPlaque(`${vehicule.canton ?? ''}${vehicule.plaque}`)
    : null;
  return {
    id: vehicule.id,
    designation: vehicule.designation,
    plaque,
    detenteurNom: null,
    orOuvert: false,
    plaqueHistorique: false,
  };
}

/**
 * Le véhicule se choisit tout seul seulement quand il n'y a aucun doute : un seul résultat, plaque
 * COURANTE (pas historique), plaque non interchangeable (RM-18 : le serveur ne choisit jamais à la
 * place de l'utilisateur quand deux véhicules se disputent une plaque).
 */
export function candidatEvident(
  candidats: readonly CandidatVehicule[],
  plaqueInterchangeable: boolean,
): CandidatVehicule | null {
  if (plaqueInterchangeable || candidats.length !== 1) return null;
  const unique = candidats[0];
  return unique !== undefined && !unique.plaqueHistorique ? unique : null;
}
