/** Bornes du Swiss QR Code (champs de l'adresse du créancier). */
export const LONGUEURS_ADRESSE = { rue: 70, numero: 16, npa: 16, localite: 35 } as const;

export interface SaisieAdresse {
  readonly rue: string;
  readonly numero: string;
  readonly npa: string;
  readonly localite: string;
}

export type ChampAdresse = 'rue' | 'npa' | 'localite';

/**
 * Rue, NPA et localité sont requis pour que le garage compte comme « configuré » (étape
 * « coordonnées »). Le numéro reste facultatif (case postale, lieu-dit).
 */
export function champsAdresseManquants(a: SaisieAdresse): readonly ChampAdresse[] {
  const manquants: ChampAdresse[] = [];
  if (a.rue.trim() === '') manquants.push('rue');
  if (a.npa.trim() === '') manquants.push('npa');
  if (a.localite.trim() === '') manquants.push('localite');
  return manquants;
}
