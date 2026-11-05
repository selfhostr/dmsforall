import type { StatutOrdreReparation } from '@dfa/shared';

/**
 * Statuts non-terminaux d'un OR au sens de « véhicule restitué » — un OR dans un de ces statuts
 * bloque encore l'archivage du véhicule (RM-31) et compte pour la confirmation
 * `VEHICULE_DEUX_OR_OUVERTS` (P-29). Local à ce module : la machine à états elle-même (L1-12,
 * `atelier/**`) est hors de mon périmètre, mais §7.4/§8.1 exigent de savoir « quels OR sont
 * ouverts » côté véhicule sans y importer de logique de transition.
 */
export const STATUTS_OR_OUVERTS: readonly StatutOrdreReparation[] = [
  'planifie',
  'ouvert',
  'en_cours',
  'controle',
  'termine',
  'facture',
];
