/**
 * Extraction texte + images d'un PDF via `pdfjs-dist` (build `legacy`, sans dépendance native) —
 * SANS le paquet `canvas` : la rasterisation PLEINE PAGE (rendu vectoriel complet) l'exigerait,
 * mais l'extraction du TEXTE (`getTextContent`) et des images XObject déjà encodées dans le PDF
 * (`getOperatorList` + `page.objs.get`) n'en a jamais besoin — pdf.js décode JPEG/PNG en JS pur en
 * interne. **Prouvé en exécution**, pas supposé : voir le rapport de livraison, un PDF généré par
 * `pdfkit` avec un vrai symbole QR-facture encodé en PNG, extrait puis décodé par `jsQR` en bout de
 * chaîne — round-trip complet sans aucun binaire natif.
 *
 * `pdfjs-dist` ≥ 4 est ESM-only (`.mjs`, aucun point d'entrée CommonJS) alors qu'`apps/api`
 * compile en CommonJS (`tsconfig.json`, `module: "CommonJS"`) — un `import` statique serait
 * downlevelé par `tsc` en `require(...)` (piège classique, voir CONTRIBUTING.md « compile + tests
 * verts, mais ne marche pas »). RÉSOLU par le support NATIF de Node ≥ 22.12 pour `require(esm)`
 * (stable, sans flag) : `createRequire(__filename)(...)` charge un module ESM de façon
 * SYNCHRONE — **prouvé en exécution** (pas supposé) dans les deux environnements où ce fichier
 * tourne : le build réel (`tsc --module CommonJS`) ET Vitest (`lecteur-pdf.spec.ts`) — deux
 * essais antérieurs (`import()` dynamique déguisé via `new Function`, puis via `eval`) réussissaient
 * dans le premier environnement mais échouaient dans le second (`TypeError: A dynamic import
 * callback was not specified.` — le runtime SSR de Vitest/Vite exécute chaque fichier dans un
 * contexte `node:vm` qui ne fournit le callback `importModuleDynamically` qu'aux `import()`
 * SYNTAXIQUES qu'il a lui-même réécrits, jamais à un `import()` atteint indirectement au runtime).
 * `require(esm)`, lui, ne dépend d'aucun callback de ce genre.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Surface MINIMALE de `pdfjs-dist` réellement utilisée — déclarée ici plutôt que d'importer les
 *  types du paquet (eux-mêmes ESM, source de friction supplémentaire pour `tsc --noEmit` en
 *  CommonJS) : si `pdfjs-dist` change cette forme, l'échec apparaît à l'exécution (testé,
 *  `lecteur-pdf.spec.ts`), pas dans un désaccord de types découplé du comportement réel. */
interface TexteItemPdfjs {
  readonly str?: string;
  /** Matrice de position `[a, b, c, d, x, y]` (convention PDF, origine en bas à gauche) — `x`/`y`
   *  servent à RECONSTITUER les lignes visuelles : `getTextContent()` rend les fragments dans
   *  l'ordre du flux du PDF, PAS nécessairement ligne par ligne (vérifié en exécution, voir
   *  `lecteur-pdf.spec.ts`). Sans ce regroupement, une facture en tableau (référence | quantité |
   *  prix | total, colonnes) se retrouverait aplatie en une seule ligne de mots dans le désordre
   *  des colonnes — inexploitable par `extraction-lignes-facture.ts`. */
  readonly transform?: readonly number[];
}
interface ObjetImagePdfjs {
  readonly width: number;
  readonly height: number;
  /** `ImageKind` de pdf.js : 1 = niveaux de gris 1bpp empaqueté, 2 = RGB 24bpp, 3 = RGBA 32bpp. */
  readonly kind: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}
interface ObjetsPagePdfjs {
  get(nom: string, resoudre: (valeur: ObjetImagePdfjs) => void): void;
}
interface PagePdfjs {
  getTextContent(): Promise<{ readonly items: readonly TexteItemPdfjs[] }>;
  getOperatorList(): Promise<{
    readonly fnArray: readonly number[];
    readonly argsArray: readonly (readonly unknown[])[];
  }>;
  readonly objs: ObjetsPagePdfjs;
}
interface DocumentPdfjs {
  readonly numPages: number;
  getPage(numero: number): Promise<PagePdfjs>;
  destroy(): Promise<void>;
}
interface ModulePdfjs {
  getDocument(options: Record<string, unknown>): { readonly promise: Promise<DocumentPdfjs> };
  readonly OPS: { readonly paintImageXObject: number };
}

/** Nombre de pages effectivement inspectées — une facture fournisseur tient sur 1 à quelques
 *  pages ; borne haute pour ne jamais itérer un PDF de plusieurs centaines de pages déposé par
 *  erreur (la taille du fichier est déjà bornée en amont par le contrôleur). */
const PAGES_MAX_INSPECTEES = 10;

const requireLocal = createRequire(__filename);

let modulePdfjsCache: ModulePdfjs | null = null;

function cheminPolicesStandard(): string {
  // Résout l'emplacement RÉEL du paquet installé, dev comme prod
  // (`node_modules/pdfjs-dist/standard_fonts/`) — jamais un chemin en dur.
  const cheminPackageJson = requireLocal.resolve('pdfjs-dist/package.json');
  const racinePaquet = path.dirname(cheminPackageJson);
  return `${pathToFileURL(path.join(racinePaquet, 'standard_fonts')).toString()}/`;
}

function chargerModulePdfjs(): ModulePdfjs {
  // `require(esm)` (Node ≥ 22.12, stable) — voir l'en-tête de fichier pour pourquoi ni un
  // `import` statique ni un `import()` dynamique (déguisé ou non) ne conviennent ici.
  modulePdfjsCache ??= requireLocal('pdfjs-dist/legacy/build/pdf.mjs') as ModulePdfjs;
  return modulePdfjsCache;
}

async function ouvrirDocument(pdf: Buffer): Promise<{
  readonly module: ModulePdfjs;
  readonly document: DocumentPdfjs;
}> {
  const module = chargerModulePdfjs();
  const document = await module.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: cheminPolicesStandard(),
    // `0` = erreurs uniquement. Sans ce réglage, pdf.js émet un avertissement `console.error`
    // BÉNIN à chaque document (« Unable to load font data » — pdf.js tente de charger la police
    // standard via `fetch()` sur une URL `file://`, non supporté par `fetch` en Node ; la police
    // ne sert qu'au RENDU visuel des glyphes, jamais à `getTextContent()`/`getOperatorList()`,
    // les deux seules API utilisées ici — vérifié en exécution : le texte et les images extraits
    // restent corrects malgré cet avertissement, voir `lecteur-pdf.spec.ts`). Silencieux plutôt
    // que de polluer les journaux — CONTRIBUTING.md : ne jamais journaliser le contenu extrait, et un
    // avertissement récurrent et sans effet n'a rien à faire dans une sortie de test ou de prod.
    verbosity: 0,
  }).promise;
  return { module, document };
}

/**
 * Texte déjà présent dans le PDF (cas MAJORITAIRE — §2 de la tâche : « un PDF émis par un
 * logiciel contient déjà son texte, extractible sans aucune reconnaissance »). `null` si le PDF
 * ne porte aucun texte exploitable (page(s) entièrement scannée(s) — repli OCR, voir
 * `orchestrateur-lecture.ts`).
 */
/** Tolérance de regroupement en Y (unités PDF, ~points) : deux fragments de la même ligne visuelle
 *  ne tombent quasiment jamais exactement sur le même `y` (arrondis internes du moteur de mise en
 *  page) — quelques dixièmes d'écart, largement sous la hauteur d'une ligne de texte courante
 *  (≥ 8-9 points même en petits caractères). */
const TOLERANCE_MEME_LIGNE_PDF = 2;

/** Regroupe les fragments de texte par ligne visuelle (position `y`), chaque ligne triée par `x`
 *  croissant — reconstitue l'ordre de lecture gauche-à-droite, haut-en-bas d'une page. */
function reconstituerLignes(items: readonly TexteItemPdfjs[]): readonly string[] {
  type Fragment = { readonly x: number; readonly y: number; readonly texte: string };
  const fragments: Fragment[] = [];
  for (const item of items) {
    const texte = item.str ?? '';
    if (texte.trim().length === 0) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    fragments.push({ x, y, texte });
  }

  const lignes: Fragment[][] = [];
  for (const fragment of fragments) {
    const ligne = lignes.find((candidate) => {
      const reference = candidate[0];
      return (
        reference !== undefined && Math.abs(reference.y - fragment.y) <= TOLERANCE_MEME_LIGNE_PDF
      );
    });
    if (ligne) ligne.push(fragment);
    else lignes.push([fragment]);
  }

  return lignes
    .sort((a, b) => (b[0]?.y ?? 0) - (a[0]?.y ?? 0)) // haut de page d'abord (y PDF croît vers le haut)
    .map((ligne) =>
      ligne
        .sort((a, b) => a.x - b.x)
        .map((fragment) => fragment.texte)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((ligne) => ligne.length > 0);
}

export async function extraireTextePdf(pdf: Buffer): Promise<string | null> {
  const { document } = await ouvrirDocument(pdf);
  try {
    const nombrePages = Math.min(document.numPages, PAGES_MAX_INSPECTEES);
    const toutesLesLignes: string[] = [];
    for (let numero = 1; numero <= nombrePages; numero++) {
      const page = await document.getPage(numero);
      const contenu = await page.getTextContent();
      toutesLesLignes.push(...reconstituerLignes(contenu.items));
    }
    const texteComplet = toutesLesLignes.join('\n').trim();
    return texteComplet.length > 0 ? texteComplet : null;
  } finally {
    await document.destroy();
  }
}

/** RGB 24bpp / gris 1bpp empaqueté -> RGBA 32bpp — `jsQR` (comme tout décodeur de pixels) exige
 *  quatre canaux. Kind 3 (déjà RGBA) passe à travers sans copie inutile au-delà du typage. */
function versRgba(image: ObjetImagePdfjs): Uint8ClampedArray {
  const { width, height, kind, data } = image;
  if (kind === 3) return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);

  if (kind === 2) {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i + 2 < data.length; i += 3, j += 4) {
      out[j] = data[i] as number;
      out[j + 1] = data[i + 1] as number;
      out[j + 2] = data[i + 2] as number;
      out[j + 3] = 255;
    }
    return out;
  }

  if (kind === 1) {
    const out = new Uint8ClampedArray(width * height * 4);
    const octetsParLigne = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const octet = data[y * octetsParLigne + (x >> 3)] ?? 0;
        const bit = (octet >> (7 - (x & 7))) & 1;
        const valeur = bit ? 255 : 0;
        const j = (y * width + x) * 4;
        out[j] = valeur;
        out[j + 1] = valeur;
        out[j + 2] = valeur;
        out[j + 3] = 255;
      }
    }
    return out;
  }

  throw new Error(`lecteur-pdf: ImageKind pdf.js non supporté (${kind}).`);
}

export interface ImagePdfExtraite {
  readonly largeur: number;
  readonly hauteur: number;
  readonly rgba: Uint8ClampedArray;
}

/**
 * Images XObject embarquées dans le PDF (JPEG/PNG déjà décodées par pdf.js en RGB/RGBA), SANS
 * rendu de page complet. Sert deux usages : (1) le symbole QR-facture, très souvent embarqué
 * comme une image plutôt que dessiné en vecteur par les logiciels de facturation ; (2) une
 * facture SCANNÉE est très souvent, techniquement, UNE SEULE image pleine page par page — ce cas
 * est donc couvert par cette même extraction, réutilisée comme entrée de l'OCR de repli (voir
 * `orchestrateur-lecture.ts`), sans avoir besoin d'un rendu vectoriel complet.
 */
export async function extraireImagesPdf(pdf: Buffer): Promise<readonly ImagePdfExtraite[]> {
  const { module, document } = await ouvrirDocument(pdf);
  try {
    const nombrePages = Math.min(document.numPages, PAGES_MAX_INSPECTEES);
    const images: ImagePdfExtraite[] = [];
    for (let numero = 1; numero <= nombrePages; numero++) {
      const page = await document.getPage(numero);
      const listeOperations = await page.getOperatorList();
      const noms: string[] = [];
      for (let i = 0; i < listeOperations.fnArray.length; i++) {
        if (listeOperations.fnArray[i] === module.OPS.paintImageXObject) {
          const nom = listeOperations.argsArray[i]?.[0];
          if (typeof nom === 'string') noms.push(nom);
        }
      }
      for (const nom of noms) {
        const image = await new Promise<ObjetImagePdfjs>((resoudre) =>
          page.objs.get(nom, resoudre),
        );
        images.push({ largeur: image.width, hauteur: image.height, rgba: versRgba(image) });
      }
    }
    return images;
  } finally {
    await document.destroy();
  }
}
