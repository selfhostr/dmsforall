import { ErreurApi } from './erreurs';

/** Nombre maximal de réessais sur une panne passagère (réseau, 5xx). */
const REESSAIS_MAX = 2;

/**
 * Politique de réessai par défaut du `QueryClient` : une réponse 4xx est une décision du serveur
 * (droit refusé, ressource absente, saisie invalide, session expirée) que rejouer ne changera
 * jamais ; seules les pannes passagères (réseau d'atelier, 5xx, 429 mis à part) méritent un
 * nouvel essai.
 */
export function doitReessayerParDefaut(nombreEchecs: number, erreur: unknown): boolean {
  if (
    erreur instanceof ErreurApi &&
    erreur.probleme.status >= 400 &&
    erreur.probleme.status < 500
  ) {
    return false;
  }
  return nombreEchecs < REESSAIS_MAX;
}

/** Fraîcheur par défaut des lectures : pas de rechargement si la donnée a moins de 30 s. */
export const FRAICHEUR_PAR_DEFAUT_MS = 30_000;

/** Fraîcheur des référentiels quasi statiques (sites, motifs, taux horaires, paramètres…). */
export const FRAICHEUR_REFERENTIEL_MS = 5 * 60 * 1000;
