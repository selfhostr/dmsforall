// Géométrie partagée entre les deux chemins de localisation de zone (cadré et repli) :
// conversion fraction <-> pixel, et élargissement du rectangle découpé au-delà de sa bordure
// attendue.
//
// MOTIF (mesuré hier sur l'échantillon réel, voir extraction-permis.ts `candidatsCodeType`) :
// une découpe pile sur la bordure théorique du champ ampute parfois un caractère de bord (VIN,
// code type). Mieux vaut inclure un peu de blanc/texte voisin — l'extraction en aval
// (apps/api/src/vehicules/ocr/extraction-permis.ts) est déjà tolérante au bruit de bord (regex de
// motif, jamais un parsing position-exacte) — que perdre un caractère qui appartient au champ.

/** Marge horizontale plus généreuse que la verticale : le bord de coupe qui ampute un caractère
 *  est presque toujours latéral (le texte continue à droite/gauche hors du cadre), rarement en
 *  haut/bas (une ligne de texte ne se coupe pas horizontalement). Une marge verticale trop large
 *  risquerait en revanche de capter la ligne du champ voisin (mesuré hier, voir le commentaire de
 *  `GEOMETRIE_VALEUR` dans ancres.mjs — la fenêtre verticale a déjà été resserrée une fois pour
 *  cette raison). */
export const MARGE_LARGEUR_DEFAUT = 0.15;
export const MARGE_HAUTEUR_DEFAUT = 0.08;

/** Fractions -> pixels, sur les dimensions de la page cible (peut être une résolution différente
 *  de celle où la zone a été déterminée — voir la résolution de repérage réduite, repli). */
export function fractionVersPixels(boiteFraction, largeurPage, hauteurPage) {
  return {
    left: boiteFraction.left * largeurPage,
    top: boiteFraction.top * hauteurPage,
    width: boiteFraction.width * largeurPage,
    height: boiteFraction.height * hauteurPage,
  };
}

/** Élargit un rectangle PIXEL (marge proportionnelle à sa propre taille) puis le borne à la page.
 *  Toujours appliqué EN DERNIER, après toute autre conversion. */
export function elargirEtBornerBoite(
  boite,
  largeurPage,
  hauteurPage,
  { margeLargeur = MARGE_LARGEUR_DEFAUT, margeHauteur = MARGE_HAUTEUR_DEFAUT } = {},
) {
  const margeX = boite.width * margeLargeur;
  const margeY = boite.height * margeHauteur;

  const left = Math.max(0, boite.left - margeX);
  const top = Math.max(0, boite.top - margeY);
  const droite = Math.min(largeurPage, boite.left + boite.width + margeX);
  const bas = Math.min(hauteurPage, boite.top + boite.height + margeY);

  // Arrondir `left`/`top` D'ABORD, puis dériver largeur/hauteur du même arrondi : arrondir les
  // quatre bords indépendamment peut pousser `left + width` 1px au-delà de `largeurPage` (mesuré :
  // `sharp().extract()` rejette alors la zone entière — « bad extract area », zéro texte lu plutôt
  // qu'un pixel de trop). Un second clamp defensif après coup couvre l'arrondi de `droite`/`bas`.
  const leftArrondi = Math.round(left);
  const topArrondi = Math.round(top);
  const largeurPageEntiere = Math.round(largeurPage);
  const hauteurPageEntiere = Math.round(hauteurPage);

  return {
    left: leftArrondi,
    top: topArrondi,
    width: Math.max(
      1,
      Math.min(Math.round(droite) - leftArrondi, largeurPageEntiere - leftArrondi),
    ),
    height: Math.max(1, Math.min(Math.round(bas) - topArrondi, hauteurPageEntiere - topArrondi)),
  };
}
