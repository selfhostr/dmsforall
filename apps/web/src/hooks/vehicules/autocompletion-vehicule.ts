/**
 * Logique pure de l'autocomplétion marque/modèle (RD "référentiel véhicules suisse / TARGA"),
 * isolée du JSX pour rester testable sans monter de composant — `ChampAutocompletionVehicule.tsx`
 * (composants/vehicules/) ne fait que CONSOMMER `estValeurDansReferentiel`, jamais réimplémenter
 * la comparaison.
 *
 * Aucune dépendance à `@dfa/shared` ici volontairement : `OptionAutocompletionVehicule` est une
 * forme GÉNÉRIQUE (un nom + un complément d'affichage optionnel déjà formaté par l'appelant), pas
 * le contrat serveur — elle sert aussi bien une marque (`{nom, nombreModeles}`) qu'un modèle
 * (`{nom, codeTypeCh}`). Le mapping depuis les types réels du contrat (générés/gelés côté
 * `packages/shared`, hors périmètre d'écriture ici) se fait dans la couche transport qui appelle
 * ce composant, jamais ici.
 */

export interface OptionAutocompletionVehicule {
  readonly valeur: string;
  /** Info secondaire déjà traduite/formatée par l'appelant (ex. « 12 modèles », un code type CH). */
  readonly complement?: string | null;
}

/**
 * Normalise pour une comparaison tolérante à la casse et aux accents — un garagiste qui tape
 * "mercedes" ou "citroen" (sans cédille) doit reconnaître sa propre saisie comme connue. Sert
 * UNIQUEMENT à la détection client d'une correspondance exacte (repli visible « hors référentiel »
 * ci-dessous) : le tri/filtre des résultats eux-mêmes reste une décision serveur (recherche par
 * préfixe, contrat gelé `GET /referentiels/vehicules/marques|modeles`).
 */
export function normaliserPourComparaison(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * Une saisie vide n'est jamais "hors référentiel" — c'est simplement l'absence de saisie, un état
 * différent (RM CONTRIBUTING.md : « absence de donnée ≠ valeur »). Sinon, vrai si `valeur` correspond
 * EXACTEMENT (au sens de `normaliserPourComparaison`) au nom d'une des `options` fournies.
 *
 * Appelant : ne considérer ce résultat comme fiable qu'une fois la recherche pour `valeur`
 * RÉELLEMENT résolue (pas `enChargement`) — sinon une saisie en cours de frappe, dont les options
 * affichées correspondent encore à l'ancienne requête, se ferait injustement étiqueter "hors
 * référentiel" avant même que la vraie réponse soit arrivée.
 */
export function estValeurDansReferentiel(
  valeur: string,
  options: readonly OptionAutocompletionVehicule[],
): boolean {
  if (valeur.trim() === '') return true;
  const cible = normaliserPourComparaison(valeur);
  return options.some((option) => normaliserPourComparaison(option.valeur) === cible);
}
