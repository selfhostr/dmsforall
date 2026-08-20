import {
  AIRE_MAX_FRAC,
  reduireSourcePourAnalyse,
  trouverPlusGrandComposantParContraste,
  type TamponPixels,
} from './detecterBordsDocument';

/**
 * DEUX DÉFAUTS DE PHOTO QUE L'OCR NE PEUT PAS RATTRAPER APRÈS COUP — diagnostiqués image par image
 * sur le corpus de calibration OCR (17 photos réelles de permis de circulation suisses fournies par
 * @laupernoe le 18-20.08.2026 — 13 dans `cg/`, 4 natives dans `cg-natif/`, jamais copiées dans ce dépôt) :
 * les deux échecs de lecture restants sur ce corpus n'étaient PAS des défauts d'algorithme mais des
 * défauts de PRISE DE VUE, chacun structurellement irrattrapable une fois la photo prise — une
 * tentative de normalisation géométrique côté serveur a été mesurée : gain exactement nul (12/17
 * avant comme après), et a été écartée. La correction utile est à la prise de vue, pas après : ce
 * module REFUSE ces deux cas à la capture ET à l'import (les deux passent par
 * `analyserQualitePhoto`, voir `EcranScan.tsx`), avec un message dans les mots du garagiste
 * (`scan:refus.motifs.*`) et un contournement TOUJOURS atteignable — même patron que les trois
 * motifs de refus déjà existants (`PanneauRefusPhoto.tsx`, bouton « Envoyer quand même »), jamais un
 * mur.
 *
 *  1. MARGE INSUFFISANTE (`margeInsuffisante`) — le permis remplit le cadre jusqu'aux bords, sans
 *     aucune marge. Cas extrême observé sur le corpus (`photo_2026-08-18_13-10-53`, vérifié à l'œil
 *     à pleine résolution : le document touche le bord droit ET le bord haut ET le bord bas) :
 *     aucune information de position n'est plus exploitable, aucun réglage ne rattrape ça après
 *     coup.
 *  2. PAGE NON POSÉE À PLAT (`pageNonAPlat`) — la seconde page du permis est repliée derrière au
 *     lieu d'être ouverte à plat (`photo_2026-08-18_13-09-56` du corpus : une seule page visible,
 *     l'ombre du pli et la couverture repliée occupent le reste du cadre). Les zones de lecture
 *     supposent une double page à plat ; sur une capture non planaire, la valeur lue tombe sur la
 *     mauvaise colonne du tableau.
 *
 * MÊME SIGNAL BRUT QUE LE CADRAGE, LU À L'ENVERS — `trouverPlusGrandComposantParContraste`
 * (`detecterBordsDocument.ts`) cherche le plus grand composant connexe par contraste avec le fond,
 * puis n'accorde sa confiance de CADRAGE que dans une fenêtre étroite (`AIRE_MIN_FRAC`..`AIRE_MAX_FRAC`
 * pour l'aire, `REMPLISSAGE_MIN` pour le remplissage) ; hors de cette fenêtre, il renvoie
 * honnêtement `null` plutôt qu'un cadrage inventé — comportement inchangé, voir sa doc de tête. CE
 * module s'intéresse à l'inverse : PAS à cadrer, mais à repérer POURQUOI la confiance a échoué côté
 * « aire trop grande » (`aireFrac > AIRE_MAX_FRAC`, la MÊME constante, délibérément réutilisée) —
 * signe que le fond ne s'est plus assez distingué du document pour qu'un arrière-plan existe encore
 * dans le cadre. Le REMPLISSAGE de la boîte détectée (même métrique que `REMPLISSAGE_MIN`, des
 * seuils différents) distingue ensuite les deux sous-cas :
 *  - remplissage BAS (`SEUIL_REMPLISSAGE_PAGE_PLIEE`) -> la « boîte » est fragmentée/trouée (ombre
 *    du pli, contenu qui ne suit pas un même plan) -> `pageNonAPlat` ;
 *  - remplissage HAUT (`SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE`) -> la boîte est un bloc plein qui
 *    occupe presque tout le cadre -> `margeInsuffisante`.
 *
 * CALIBRATION ÉTROITE POUR LA MARGE, ASSUMÉE — sur les 17 photos du corpus, AUCUNE combinaison de
 * mesures disponibles ici (aire, remplissage, marge mesurée côté par côté, ratio largeur/hauteur de
 * la boîte, variance de couleur ou de laplacien dans une bande de bord — cinq approches testées, une
 * seule retenue) ne sépare proprement `photo_2026-08-18_13-10-53` (marge réellement insuffisante,
 * remplissage 0.650) du pire faux positif observé, `IMG_2503` (remplissage 0.616 — une photo au
 * fond de tableau de bord très texturé/chargé qui fait dériver `aireFrac` à 0.979 SANS aucun
 * problème réel de marge, confirmé à l'œil, à pleine résolution, sur les quatre bords). L'écart entre
 * les deux n'est que de 3 points de remplissage : `SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE` est choisi
 * au milieu. FIABLE sur ce corpus précis, PAS garanti au-delà — à recalibrer dès qu'un faux refus ou
 * un faux passage est constaté en usage réel, même réserve que `REMPLISSAGE_MIN`/`AIRE_MAX_FRAC`
 * dans `detecterBordsDocument.ts`. Le seuil « page pliée » (`SEUIL_REMPLISSAGE_PAGE_PLIEE`), lui,
 * dispose d'une marge confortable (l'unique cas plié du corpus a un remplissage de 0.332, contre
 * 0.616 pour le plus bas des cas sains à aire comparable) — bien moins fragile.
 *
 * ZONE GRISE ASSUMÉE — entre les deux seuils de remplissage (aucune photo du corpus n'y tombe),
 * `detecterAnomalieCadrageDepuisPixels` ne classe RIEN plutôt que de deviner : même doctrine
 * « confiance, pas certitude » que `detecterBordsDocument.ts`.
 */

/** En dessous de ce remplissage (et au-dessus d'`AIRE_MAX_FRAC` d'aire), la boîte détectée est
 *  fragmentée/trouée plutôt qu'un bloc plein — signature d'une page repliée derrière (ombre du pli,
 *  contenu qui ne suit pas un même plan). Large marge de sécurité sur le corpus de calibration, voir
 *  la doc de tête. */
export const SEUIL_REMPLISSAGE_PAGE_PLIEE = 0.5;

/** Au-dessus de ce remplissage (et au-dessus d'`AIRE_MAX_FRAC` d'aire), la boîte détectée est un
 *  bloc plein qui occupe presque tout le cadre — signature d'un document photographié sans marge.
 *  Fenêtre de calibration ÉTROITE (3 points d'écart sur le corpus de référence) — voir la doc de
 *  tête, à recalibrer dès qu'un faux résultat est constaté en usage réel. */
export const SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE = 0.63;

export type AnomalieCadrage = 'margeInsuffisante' | 'pageNonAPlat';

export interface ResultatAnomalieCadrage {
  readonly anomalie: AnomalieCadrage;
  /** Exposés pour le diagnostic/tests — même statut que `DetectionBords.aireFrac`/`.remplissage`,
   *  pas utilisés par les appelants normaux. */
  readonly aireFrac: number;
  readonly remplissage: number;
}

/**
 * Classification PURE à partir des DEUX mesures déjà calculées par
 * `trouverPlusGrandComposantParContraste` — voir la doc de tête pour la logique complète. Séparée de
 * `detecterAnomalieCadrageDepuisPixels` ci-dessous précisément pour être testée avec des NOMBRES
 * (`detecterAnomaliesCadrage.spec.ts` rejoue directement les mesures relevées sur le corpus de
 * calibration, sans reconstruire des tampons de pixels de toutes pièces) : construire un tampon de
 * pixels synthétique qui retombe exactement sur un couple (aire, remplissage) donné est fragile
 * (`trouverPlusGrandComposantParContraste` a un comportement à SEUIL — l'estimation du fond bascule
 * brutalement selon qu'elle est dominée ou non par le document dans la bande d'échantillonnage, voir
 * le rapport de livraison), alors que les valeurs elles-mêmes, mesurées sur de vraies photos, sont
 * stables et traçables. `null` = aucune anomalie (aire sous `AIRE_MAX_FRAC`, ou remplissage dans la
 * zone grise entre les deux seuils — voir la doc de tête, jamais une anomalie fabriquée).
 */
export function classifierAnomalieCadrage(
  aireFrac: number,
  remplissage: number,
): AnomalieCadrage | null {
  if (aireFrac <= AIRE_MAX_FRAC) return null;
  if (remplissage < SEUIL_REMPLISSAGE_PAGE_PLIEE) return 'pageNonAPlat';
  if (remplissage >= SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE) return 'margeInsuffisante';
  return null; // zone grise, voir la doc de tête
}

/**
 * Fonction PURE — enchaîne `trouverPlusGrandComposantParContraste` (le signal brut) et
 * `classifierAnomalieCadrage` (la décision). `null` = aucune anomalie détectée, soit parce
 * qu'aucun composant n'a pu être trouvé du tout (photo uniforme, tampon invalide — mêmes cas que
 * `trouverPlusGrandComposantParContraste`), soit parce que la classification ne conclut à rien —
 * jamais une anomalie fabriquée.
 */
export function detecterAnomalieCadrageDepuisPixels(
  tampon: TamponPixels,
): ResultatAnomalieCadrage | null {
  const trouve = trouverPlusGrandComposantParContraste(tampon);
  if (!trouve) return null;
  const { aireFrac, remplissage } = trouve;

  const anomalie = classifierAnomalieCadrage(aireFrac, remplissage);
  if (!anomalie) return null;
  return { anomalie, aireFrac, remplissage };
}

/** Enveloppe DOM PARTAGÉE avec `detecterBordsDocument.ts` (`reduireSourcePourAnalyse`, MÊME
 *  réduction, MÊME calibration) — voir sa doc pour pourquoi la photo fixe et la prise de vue en
 *  direct doivent lire le même algorithme. `null` si la réduction échoue (pas de canevas 2D, mêmes
 *  conditions que `detecterBordsDepuisSource`). */
export function detecterAnomalieCadrageDepuisSource(
  source: CanvasImageSource,
  largeurNaturelle: number,
  hauteurNaturelle: number,
): ResultatAnomalieCadrage | null {
  const tampon = reduireSourcePourAnalyse(source, largeurNaturelle, hauteurNaturelle);
  if (!tampon) return null;
  return detecterAnomalieCadrageDepuisPixels(tampon);
}

/** Cas d'usage « photo fixe » de `detecterAnomalieCadrageDepuisSource` — même patron que
 *  `detecterBordsDocument` dans `detecterBordsDocument.ts`. */
export function detecterAnomalieCadrage(image: HTMLImageElement): ResultatAnomalieCadrage | null {
  return detecterAnomalieCadrageDepuisSource(image, image.naturalWidth, image.naturalHeight);
}
