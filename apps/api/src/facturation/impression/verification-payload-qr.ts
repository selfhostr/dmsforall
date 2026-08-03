/**
 * Invariant `DI-3`/`MD-77`, vérifié À L'EXÉCUTION plutôt qu'affirmé : le payload que `swissqrbill`
 * encode réellement dans le symbole QR, à partir des champs figés qu'on lui passe
 * (`donnees-swissqrbill.ts`), doit être STRICTEMENT ÉQUIVALENT — après la seule normalisation
 * autorisée — au `qr_payload` figé en base à l'émission (`qr-emission.ts`, `facturation/qr/`).
 *
 * Pourquoi une vérification d'exécution et pas seulement un test : `swissqrbill` ne recompose
 * jamais le payload à partir d'une chaîne déjà construite — il le reconstruit TOUJOURS depuis les
 * champs structurés (`Data`), et n'expose AUCUNE fonction publique acceptant un payload tout fait
 * (voir le rapport d'évaluation, `.../scratchpad/qrbill-eval/`). La coïncidence de mapping
 * vérifiée une fois par cet agent (facture 2026-00002) n'est PAS une garantie structurelle pour
 * toutes les combinaisons futures (débiteur absent/présent, QRR/SCOR/sans référence, CHF/EUR) —
 * ce module transforme cette coïncidence en invariant, document par document, à chaque génération.
 *
 * MÉTHODE — décodage réel, pas relecture des internes :
 *   1. `swissqrbill/svg` expose PUBLIQUEMENT `SwissQRCode` (`swissqrbill/lib/cjs/svg/swissqrcode.*`,
 *      listé dans `exports."./svg"` du package — contrairement à `generateQRData`/`renderQRCode`,
 *      internes et NON exportés : un deep-import vers `swissqrbill/lib/cjs/shared/qr-code.cjs` a
 *      été essayé et échoue avec `ERR_PACKAGE_PATH_NOT_EXPORTED` — vérifié en exécution, pas
 *      supposé). `SwissQRCode` appelle EN INTERNE le même `renderQRCode`/`generateQRData` que la
 *      classe PDF (`SwissQRBill`) pour le rendu du symbole — même chemin de code, donc même
 *      payload encodé, que ce soit via le SVG (utilisé ici pour la vérification) ou le PDF
 *      (produit pour de vrai par `generation-pdf-facture.ts`).
 *   2. Son SVG contient un `<rect>` par module QR sombre (coordonnées en mm, ÉMISES PAR LA
 *      BIBLIOTHÈQUE — on ne les invente pas, on les relit). Les rects sont rastérisés en RGBA pur
 *      JavaScript (aucun canvas, aucune dépendance native — arithmétique de remplissage de
 *      rectangles connus, pas un moteur de rendu).
 *   3. `jsQR` (pur JS, zéro dépendance, `npm` `jsqr`) décode le buffer RGBA — décodage
 *      INDÉPENDANT de `swissqrbill` : c'est un tiers qui lit des pixels, exactement ce que ferait
 *      un scanner ou une application bancaire.
 *   4. Comparaison au payload figé après normalisation.
 *
 * Preuve empirique de la démarche : `.../scratchpad/qrbill-eval/verif_pipeline.cjs` — payload
 * identique après normalisation, sur le cas RF-59 (débiteur absent) de la facture 2026-00002.
 */

import jsQR from 'jsqr';
import { SwissQRCode } from 'swissqrbill/svg';
import type { Data } from 'swissqrbill/types';

import { ErreurMetier } from '../../common/erreurs/erreur-metier';

export interface RectSvg {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill: string;
}

/**
 * Extrait les `<rect x="..mm" y="..mm" width="..mm" height="..mm" fill="..">` du SVG produit par
 * `SwissQRCode.toString()`. Volontairement permissif sur l'ordre des attributs (regex par attribut
 * nommé, pas par position) — le format exact émis par `svg-engine` (dépendance de `swissqrbill`,
 * pas la nôtre) n'est pas un contrat qu'on maîtrise, seule la PRÉSENCE des quatre attributs de
 * géométrie + `fill` compte.
 */
export function extraireRectsSvg(svg: string): readonly RectSvg[] {
  const rects: RectSvg[] = [];
  const reBalise = /<rect\b([^>]*?)\/?>(?:<\/rect>)?/g;
  let m: RegExpExecArray | null;
  while ((m = reBalise.exec(svg))) {
    // Le groupe capturant existe toujours structurellement (un seul `(...)` dans `reBalise`),
    // mais `noUncheckedIndexedAccess` ne le sait pas statiquement — absence traitée explicitement
    // (chaîne vide : aucun attribut à y trouver, `lire()` renverra `null` pour tous les attributs
    // sur cette itération) plutôt qu'écartée par une assertion.
    const attrs = m[1] ?? '';
    const lire = (nom: string): string | null => {
      const re = new RegExp(`\\b${nom}="([^"]*)"`);
      const mm = re.exec(attrs);
      return mm ? (mm[1] ?? null) : null;
    };
    const xBrut = lire('x');
    const yBrut = lire('y');
    const wBrut = lire('width');
    const hBrut = lire('height');
    if (xBrut == null || yBrut == null || wBrut == null || hBrut == null) continue;
    rects.push({
      x: parseFloat(xBrut),
      y: parseFloat(yBrut),
      w: parseFloat(wBrut),
      h: parseFloat(hBrut),
      fill: lire('fill') ?? 'black',
    });
  }
  return rects;
}

const PX_PAR_MM = 12; // ~300 dpi (300 / 25.4 ≈ 11.8) — résolution d'un scan de qualité courante.
/** Marge de zone tranquille ajoutée autour du symbole — la norme QR (ISO 18004) exige une zone
 *  tranquille pour la détection des motifs de repérage ; 8 mm est large par rapport au minimum
 *  (4 modules), volontairement généreux pour ne jamais faire échouer le décodage sur ce facteur. */
const MARGE_MM = 8;

/** Rastérise les rects (coordonnées mm) en RGBA pur JS, fond blanc, sans canvas ni dépendance
 *  native — simple remplissage de rectangles connus dans un buffer. */
export function rasteriserRects(
  rects: readonly RectSvg[],
  tailleSymboleMm: number,
): { readonly pixels: Uint8ClampedArray; readonly largeur: number; readonly hauteur: number } {
  const cote = Math.round((tailleSymboleMm + 2 * MARGE_MM) * PX_PAR_MM);
  const pixels = new Uint8ClampedArray(cote * cote * 4);
  pixels.fill(255); // fond blanc, alpha compris (255 partout, y compris le canal A)

  const peindre = (r: RectSvg): void => {
    const val = r.fill === 'white' ? 255 : 0;
    const x0 = Math.max(0, Math.round((r.x + MARGE_MM) * PX_PAR_MM));
    const y0 = Math.max(0, Math.round((r.y + MARGE_MM) * PX_PAR_MM));
    const x1 = Math.min(cote, Math.round((r.x + r.w + MARGE_MM) * PX_PAR_MM));
    const y1 = Math.min(cote, Math.round((r.y + r.h + MARGE_MM) * PX_PAR_MM));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const idx = (py * cote + px) * 4;
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }
  };

  // Ordre d'apparition du SVG = ordre de dessin (les rects de la croix suisse arrivent après les
  // modules QR et les recouvrent — exactement ce qu'un scanner verrait sur le bulletin réel).
  for (const r of rects) peindre(r);

  return { pixels, largeur: cote, hauteur: cote };
}

/**
 * Construit le QR seul (`swissqrbill/svg`, export public) depuis `data`, le rastérise et le
 * décode avec `jsQR` (tiers indépendant). Retourne `null` si `jsQR` ne parvient pas à détecter/
 * décoder de symbole — l'appelant doit traiter ce cas comme un échec de vérification, jamais
 * comme une absence bénigne de QR.
 */
export function payloadReelementEncode(data: Data, tailleSymboleMm = 46): string | null {
  const svg = new SwissQRCode(data, tailleSymboleMm).toString();
  const rects = extraireRectsSvg(svg);
  const { pixels, largeur, hauteur } = rasteriserRects(rects, tailleSymboleMm);
  const resultat = jsQR(pixels, largeur, hauteur);
  return resultat ? resultat.data : null;
}

/**
 * Normalisation AUTORISÉE, et rien de plus (consigne explicite du coordinateur) :
 *   - `\r\n` → `\n` (le payload figé en base est joint par `\r\n`, `generateQRData` interne de
 *     `swissqrbill` joint par `\n` seul — vérifié en exécution, `.../verif_pipeline.cjs`) ;
 *   - retrait d'UNE SEULE ligne vide finale surnuméraire (32ᵉ élément `additionalInformation`,
 *     poussé par `swissqrbill` même `undefined`, absent du payload figé quand rien ne suit le
 *     trailer `EPD`).
 * PAS d'espaces retirés, PAS de casse changée — une divergence sur autre chose que ces deux points
 * doit faire échouer la comparaison, pas être absorbée.
 */
export function normaliserPayloadPourComparaison(payload: string): string {
  const sansCrlf = payload.replace(/\r\n/g, '\n');
  return sansCrlf.endsWith('\n') ? sansCrlf.slice(0, -1) : sansCrlf;
}

/**
 * Vérifie l'équivalence et REFUSE (`ErreurMetier`) plutôt que de laisser passer un bulletin dont
 * le QR encoderait autre chose que le payload figé à l'émission — c'est le garde-fou central de
 * ce module (consigne du coordinateur : « un bulletin joli dont le QR dit autre chose est un échec
 * silencieux, et c'est le pire mode de défaillance possible ici »).
 *
 * @throws ErreurMetier `ERREUR_INTERNE` (500) si le décodage échoue OU si les payloads normalisés
 *         diffèrent. Un `500` est le bon statut ici : cette divergence ne devrait JAMAIS se
 *         produire en fonctionnement normal (le mapping est vérifié par la suite de non-régression
 *         `verification-payload-qr.spec.ts`) — si elle survient en production, c'est un signal
 *         d'alerte (dérive de version de `swissqrbill`, régression de mapping), pas une erreur
 *         utilisateur à corriger.
 */
export function verifierEquivalencePayload(
  data: Data,
  payloadFige: string,
  documentId: string,
): void {
  const payloadReel = payloadReelementEncode(data);

  if (payloadReel == null) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Bulletin QR du document ${documentId} : impossible de décoder le symbole reconstruit pour ` +
        "vérification (jsQR n'a détecté aucun code) — génération du PDF refusée par sécurité (DI-3).",
    );
  }

  const attendu = normaliserPayloadPourComparaison(payloadFige);
  const obtenu = normaliserPayloadPourComparaison(payloadReel);

  if (attendu !== obtenu) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Bulletin QR du document ${documentId} : le payload que swissqrbill encoderait diverge du ` +
        "qr_payload figé à l'émission après normalisation autorisée (CRLF→LF, ligne finale vide) — " +
        'génération du PDF refusée plutôt que de produire un bulletin dont le QR dirait autre chose ' +
        'que ce qui a été émis (DI-3/MD-77).',
      { detail: `attendu=${JSON.stringify(attendu)};obtenu=${JSON.stringify(obtenu)}` },
    );
  }
}
