import { GRILLE_VIDE, type CapacitesPersonne } from '@dfa/shared';

/** Capacités d'une personne de test : grille inerte, ni préréglage ni personnalisation. */
export const CAPACITES_TEST: CapacitesPersonne = {
  ...GRILLE_VIDE,
  prereglage: null,
  personnalisee: false,
};
