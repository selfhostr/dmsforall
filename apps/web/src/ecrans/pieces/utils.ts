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

/** Résultat de la saisie d'un SEUIL de réapprovisionnement — distinct de
 *  `saisieVersQuantiteMillieme` (qui confond volontairement `''` et `'0'`, tous deux ramenés à
 *  `null` : correct pour une quantité de mouvement, où zéro n'a pas de sens, mais FAUX ici. Un
 *  champ vide retire le suivi (`stockMinimumMillieme = null`, RP-12 : « pas de suivi »), alors
 *  qu'un zéro EXPLICITE voudrait dire « suivi, mais qu'on ne réapprovisionne jamais » — deux
 *  états métier différents que le contrat serveur ne distingue PAS aujourd'hui
 *  (`schemaQuantiteMillieme = z.number().int().min(1)`, `@dfa/shared/contrats/atelier/primitives`,
 *  hors périmètre de ce module) : `PATCH /articles/{id}/stock/{siteId}` rejette `0` avec
 *  `400 VALIDATION_ECHOUEE` (vérifié en conditions réelles). Faute de pouvoir représenter ce
 *  troisième état, ce parseur refuse `0` comme un `'invalide'` plutôt que de le laisser passer
 *  pour échouer côté serveur avec un message générique, ou de le confondre silencieusement avec
 *  `'absence'` — l'aide affichée à l'écran doit expliquer ce choix. */
export type ResultatSaisieSeuil =
  | { readonly genre: 'absence' }
  | { readonly genre: 'valeur'; readonly millieme: number }
  | { readonly genre: 'invalide' };

export function saisieVersSeuilMillieme(saisie: string): ResultatSaisieSeuil {
  const normalisee = saisie.trim().replace(',', '.');
  if (normalisee === '') return { genre: 'absence' };
  if (!/^\d+(\.\d{1,3})?$/.test(normalisee)) return { genre: 'invalide' };
  const valeur = Number.parseFloat(normalisee);
  if (!Number.isFinite(valeur)) return { genre: 'invalide' };
  const millieme = Math.round(valeur * 1000);
  if (millieme < 1) return { genre: 'invalide' };
  return { genre: 'valeur', millieme };
}
