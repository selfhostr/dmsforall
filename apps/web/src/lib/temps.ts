/**
 * Temps atelier. Le temps est stocké en **centièmes d'heure** (integer, ex. 120 = 1.20 h),
 * jamais en flottant — même logique que les montants en centimes. L'unité *affichée* dépend en
 * revanche du paramètre atelier P-03 (« heures décimales » ou « unités de temps constructeur ») :
 * elle n'est donc jamais codée en dur ici, elle est toujours reçue en paramètre par l'appelant
 * (le hook `parametres.atelier()` posé en F1-00-suivant fournira la valeur réelle — ce module ne
 * fait qu'accepter et afficher l'unité, il ne la connaît pas par défaut).
 */

import { corrigerApostropheMilliers } from './formats';

/** Unité de temps atelier (P-03). Alignée sur `unite_temps` côté backend dès que le module
 *  paramétrage (DEP-03) expose sa valeur — ici, seul le nom compte pour l'affichage. */
export type UniteTemps = 'heuresDecimales' | 'unitesConstructeur';

const SUFFIXES_UNITE_TEMPS: Record<UniteTemps, string> = {
  heuresDecimales: 'h',
  unitesConstructeur: 'UT',
};

const FORMATEUR_HEURES = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const FORMATEUR_ECART_HEURES = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'always',
});

/** Centièmes d'heure (integer) -> heures décimales (float). Affichage uniquement : ne jamais
 *  réutiliser ce résultat dans un calcul ultérieur, repartir des centièmes d'heure stockés. */
export function centiemesVersHeures(centiemes: number): number {
  if (!Number.isInteger(centiemes)) {
    throw new TypeError(`centiemesVersHeures attend un entier, reçu : ${centiemes}`);
  }
  return centiemes / 100;
}

/** Centièmes d'heure (integer) + unité (P-03) -> temps affichable (ex. `120, 'heuresDecimales'`
 *  -> `'1.2 h'`). L'unité pilote uniquement le suffixe : la valeur stockée reste toujours en
 *  centièmes d'heure quel que soit le paramètre atelier. */
export function formaterTempsCentiemes(valeurCentiemes: number, unite: UniteTemps): string {
  const heures = centiemesVersHeures(valeurCentiemes);
  const corps = corrigerApostropheMilliers(FORMATEUR_HEURES.format(heures));
  return `${corps} ${SUFFIXES_UNITE_TEMPS[unite]}`;
}

/** Écart de temps signé (ex. pointé vs. barème) -> `'+1.2 h'` / `'-0.5 h'` / `'+0.0 h'`. */
export function formaterEcartTemps(valeurCentiemes: number, unite: UniteTemps): string {
  const heures = centiemesVersHeures(valeurCentiemes);
  const corps = corrigerApostropheMilliers(FORMATEUR_ECART_HEURES.format(heures));
  return `${corps} ${SUFFIXES_UNITE_TEMPS[unite]}`;
}
