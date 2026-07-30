/**
 * Encodage Windows-1252 / ISO-8859-1 du fichier WinBIZ (`EF-12`).
 *
 * **Le piège identifié explicitement pour cet adaptateur** : le défaut naturel d'un backend Node
 * est UTF-8. Un nom de client accentué (« Genève », « Müller & Cie », « François ») encodé en
 * UTF-8 et relu par WinBIZ en Windows-1252 produit un fichier lisible par un éditeur de texte
 * mais faux au premier `é` — c'est le défaut qui se découvre chez le comptable, pas en test, si
 * le test ne regarde que la CHAÎNE JavaScript et jamais les OCTETS produits.
 *
 * Windows-1252 et ISO-8859-1 (Latin-1) sont identiques sur les points de code `0x00-0x7F`
 * (ASCII) et `0xA0-0xFF` (Latin-1 étendu — c'est là que vivent `é, è, à, ù, ç, ü, ö, ä, ñ, ß, î,
 * ô`… tout l'alphabet FR/DE/IT accentué). Ils divergent UNIQUEMENT sur `0x80-0x9F`, où Latin-1
 * réserve des caractères de contrôle C1 inutilisés et Windows-1252 y place des caractères
 * imprimables (`€`, guillemets typographiques, `…`, `–`, `—`…). Cette table couvre exactement
 * cette plage — le reste est une correspondance point-à-point directe (`code point == octet`).
 *
 * Aucune dépendance externe (`iconv-lite` n'est qu'une dépendance transitive du dépôt, pas une
 * dépendance directe de `@dfa/api`) : la plage à couvrir est petite et entièrement tabulée
 * ci-dessous, ce qui rend ce module testable octet par octet sans confiance aveugle dans une
 * librairie tierce.
 */

/**
 * `0x80-0x9F` : point de code Unicode → octet Windows-1252. Les cinq positions absentes de cette
 * table (`0x81, 0x8D, 0x8F, 0x90, 0x9D`) sont NON DÉFINIES par Windows-1252 lui-même — un
 * caractère qui s'y résoudrait (aucun caractère Unicode usuel ne le fait) serait de toute façon
 * non encodable, voir `encoderCaractereWindows1252`.
 */
const TABLE_C1_VERS_WINDOWS1252: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // '
  [0x2019, 0x92], // '
  [0x201c, 0x93], // "
  [0x201d, 0x94], // "
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

/** Octet de repli pour un point de code non représentable en Windows-1252 — `?` (`0x3F`), et le
 *  caractère est signalé dans `caracteresNonEncodables` plutôt que silencieusement avalé. */
const OCTET_REPLI = 0x3f;

/** Encode un unique point de code Unicode en son octet Windows-1252, ou `null` s'il n'est pas
 *  représentable dans ce jeu de caractères. */
function encoderCaractereWindows1252(pointDeCode: number): number | null {
  if (pointDeCode <= 0x7f) {
    return pointDeCode; // ASCII, identique dans les trois jeux.
  }
  if (pointDeCode >= 0xa0 && pointDeCode <= 0xff) {
    return pointDeCode; // Latin-1 étendu == Windows-1252 sur cette plage.
  }
  return TABLE_C1_VERS_WINDOWS1252.get(pointDeCode) ?? null;
}

export interface ResultatEncodageWindows1252 {
  readonly octets: Buffer;
  /** Caractères de la chaîne source qui n'ont pas de représentation Windows-1252 et ont été
   *  remplacés par `?` — vide dans l'immense majorité des cas (noms FR/DE/IT). */
  readonly caracteresNonEncodables: readonly string[];
}

/**
 * Encode une chaîne UTF-16 (le type `string` de JavaScript) en octets Windows-1252.
 *
 * Itère par POINT DE CODE Unicode (`for...of` sur une chaîne, pas par unité UTF-16 — un émoji ou
 * un caractère hors plan de base ne casserait pas un couple de substituts en deux octets
 * indépendants). Chaque caractère produit EXACTEMENT un octet en sortie : c'est la propriété qui
 * rend les longueurs déclarées par `EF-13` (`Pièce` 10, `Libellé` 100…) directement comparables à
 * `chaine.length` côté appelant, AVANT cet encodage.
 */
export function encoderWindows1252(texte: string): ResultatEncodageWindows1252 {
  const octets: number[] = [];
  const caracteresNonEncodables: string[] = [];

  for (const caractere of texte) {
    const pointDeCode = caractere.codePointAt(0);
    /* c8 ignore next 3 -- `codePointAt(0)` sur le premier caractère d'un itérateur de chaîne ne
       renvoie jamais `undefined` ; garde-fou TypeScript pur (`noUncheckedIndexedAccess`). */
    if (pointDeCode === undefined) {
      continue;
    }

    const octet = encoderCaractereWindows1252(pointDeCode);
    if (octet === null) {
      caracteresNonEncodables.push(caractere);
      octets.push(OCTET_REPLI);
    } else {
      octets.push(octet);
    }
  }

  return { octets: Buffer.from(octets), caracteresNonEncodables };
}
