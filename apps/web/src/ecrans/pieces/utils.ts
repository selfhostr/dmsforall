/**
 * Utilitaires locaux au module pièces — `lib/**` est hors périmètre de cet agent, même règle que
 * `ecrans/clients/utils.ts` (fonctions propres à un domaine, pas assez génériques pour `lib/`).
 *
 * QUANTITÉS EN MILLIÈMES — `quantiteMillieme` (@dfa/shared, `contrats/pieces/primitives.ts`) :
 * `1000` = 1 unité (pièce, litre, mètre selon l'article). Jamais un flottant intermédiaire côté
 * données ; l'affichage divise seulement au moment du rendu, même doctrine que `formaterMontant`
 * pour les centimes.
 */

const FORMATEUR_QUANTITE = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });

// Même correctif que `lib/formats.ts#corrigerApostropheMilliers` : Intl.NumberFormat('de-CH')
// rend l'apostrophe typographique (U+2019) comme séparateur de milliers, le rendu suisse standard
// utilise l'apostrophe droite (U+0027). Dupliqué ici (pas dans `lib/`, hors périmètre) plutôt que
// réimporté d'un fichier qu'un autre agent peut modifier en parallèle.
const APOSTROPHE_TYPOGRAPHIQUE = /’/g;

/** Millièmes d'unité (integer) -> quantité affichable (ex. `2500` -> `"2.5"`, `1000` -> `"1"`). */
export function formaterQuantiteMillieme(millieme: number): string {
  if (!Number.isInteger(millieme)) {
    throw new TypeError(
      `formaterQuantiteMillieme attend un entier (millièmes), reçu : ${millieme}`,
    );
  }
  return FORMATEUR_QUANTITE.format(millieme / 1000).replace(APOSTROPHE_TYPOGRAPHIQUE, "'");
}

/** Quantité saisie par l'utilisateur (unités, virgule ou point) -> millièmes entiers, ou `null`
 *  si la saisie n'est pas interprétable — jamais de flottant transmis au serveur. */
export function saisieVersQuantiteMillieme(saisie: string): number | null {
  const normalisee = saisie.trim().replace(',', '.');
  if (normalisee === '' || !/^\d+(\.\d{1,3})?$/.test(normalisee)) return null;
  const valeur = Number.parseFloat(normalisee);
  if (!Number.isFinite(valeur)) return null;
  const millieme = Math.round(valeur * 1000);
  return millieme > 0 ? millieme : null;
}

/** Affichage neutre d'une valeur absente — même convention que `ecrans/clients/utils.ts`. */
export function texteOuVide(valeur: string | number | null | undefined): string {
  return valeur === null || valeur === undefined || valeur === '' ? '—' : String(valeur);
}

/** Millièmes -> valeur ÉDITABLE pré-remplie dans un champ de saisie (ex. `2500` -> `"2.5"`) —
 *  distinct de `formaterQuantiteMillieme` (affichage suisse, apostrophe des milliers) : un champ
 *  de saisie ne doit jamais recevoir de séparateur de milliers, seulement le point décimal que
 *  `saisieVersQuantiteMillieme` sait reparser sans ambiguïté. Utilisé pour pré-remplir la
 *  quantité reçue d'une ligne de réception avec son reliquat (`DialogueReceptionCommande`). */
export function quantiteMilliemeVersSaisie(millieme: number): string {
  if (!Number.isInteger(millieme)) {
    throw new TypeError(
      `quantiteMilliemeVersSaisie attend un entier (millièmes), reçu : ${millieme}`,
    );
  }
  return String(millieme / 1000);
}
