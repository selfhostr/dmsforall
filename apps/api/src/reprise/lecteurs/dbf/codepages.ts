/**
 * Décodage des chaînes DBF/VFP historiques, sans dépendance externe (`iconv-lite` n'est
 * disponible que transitivement dans ce dépôt — pas question d'en dépendre implicitement).
 *
 * Seule la moitié haute (0x80-0xFF) diffère d'ASCII ; la moitié basse est commune à tous les
 * encodages ciblés ici. Tables générées depuis les codecs Python de référence `cp850`/`cp1252`
 * (encodages publics standardisés, aucune donnée de garage impliquée).
 */

/** cp850 (DOS Multilingual, Europe de l'Ouest) — octets 0x80-0xFF -> point de code Unicode. */
const CP850_HAUT: readonly number[] = [
  199, 252, 233, 226, 228, 224, 229, 231, 234, 235, 232, 239, 238, 236, 196, 197, 201, 230, 198,
  244, 246, 242, 251, 249, 255, 214, 220, 248, 163, 216, 215, 402, 225, 237, 243, 250, 241, 209,
  170, 186, 191, 174, 172, 189, 188, 161, 171, 187, 9617, 9618, 9619, 9474, 9508, 193, 194, 192,
  169, 9571, 9553, 9559, 9565, 162, 165, 9488, 9492, 9524, 9516, 9500, 9472, 9532, 227, 195, 9562,
  9556, 9577, 9574, 9568, 9552, 9580, 164, 240, 208, 202, 203, 200, 305, 205, 206, 207, 9496, 9484,
  9608, 9604, 166, 204, 9600, 211, 223, 212, 210, 245, 213, 181, 254, 222, 218, 219, 217, 253, 221,
  175, 180, 173, 177, 8215, 190, 182, 167, 247, 184, 176, 168, 183, 185, 179, 178, 9632, 160,
];

/** cp1252 (Windows ANSI, Europe de l'Ouest) — octets 0x80-0xFF -> point de code Unicode. */
const CP1252_HAUT: readonly number[] = [
  8364, 65533, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 65533, 381, 65533,
  65533, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 65533, 382, 376, 160,
  161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179,
  180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198,
  199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217,
  218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236,
  237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255,
];

export type EncodageDbf = 'cp850' | 'cp1252' | 'latin1' | 'ascii';

const TABLES: Record<Exclude<EncodageDbf, 'latin1' | 'ascii'>, readonly number[]> = {
  cp850: CP850_HAUT,
  cp1252: CP1252_HAUT,
};

/**
 * Décode une chaîne DBF brute (octets bruts d'un champ C, avant retrait des espaces de
 * remplissage) selon l'encodage donné. `latin1`/`ascii` n'ont pas besoin de table : latin1 est
 * l'identité octet -> point de code, ascii remplace tout octet >= 0x80 par U+FFFD.
 */
export function decoderChaineDbf(brut: Buffer, encodage: string): string {
  if (encodage === 'latin1') {
    return brut.toString('latin1');
  }
  if (encodage === 'ascii') {
    let resultat = '';
    for (const octet of brut) {
      resultat += octet < 0x80 ? String.fromCharCode(octet) : '�';
    }
    return resultat;
  }
  const table = TABLES[encodage as 'cp850' | 'cp1252'] ?? CP850_HAUT;
  let resultat = '';
  for (const octet of brut) {
    resultat +=
      octet < 0x80
        ? String.fromCharCode(octet)
        : String.fromCodePoint(table[octet - 0x80] ?? 0xfffd);
  }
  return resultat;
}

const TABLES_INVERSES = new Map<string, Map<number, number>>();

function tableInverse(encodage: 'cp850' | 'cp1252'): Map<number, number> {
  let inverse = TABLES_INVERSES.get(encodage);
  if (!inverse) {
    inverse = new Map();
    TABLES[encodage].forEach((pointCode, index) => inverse!.set(pointCode, 0x80 + index));
    TABLES_INVERSES.set(encodage, inverse);
  }
  return inverse;
}

/**
 * Encode une chaîne vers les octets bruts d'un encodage DBF. Réservée aux tests (construction de
 * fixtures `.dbf` synthétiques) : la bibliothèque de lecture ne réécrit jamais de DBF en
 * production, seulement le sens inverse (`decoderChaineDbf`).
 */
export function encoderChaineDbf(texte: string, encodage: string): Buffer {
  const octets: number[] = [];
  if (encodage === 'latin1') {
    for (const car of texte) {
      const cp = car.codePointAt(0) ?? 0x3f;
      octets.push(cp <= 0xff ? cp : 0x3f);
    }
    return Buffer.from(octets);
  }
  if (encodage === 'ascii') {
    for (const car of texte) {
      const cp = car.codePointAt(0) ?? 0x3f;
      octets.push(cp < 0x80 ? cp : 0x3f);
    }
    return Buffer.from(octets);
  }
  const cible: 'cp850' | 'cp1252' = encodage === 'cp1252' ? 'cp1252' : 'cp850';
  const inverse = tableInverse(cible);
  for (const car of texte) {
    const cp = car.codePointAt(0) ?? 0x3f;
    if (cp < 0x80) {
      octets.push(cp);
    } else {
      octets.push(inverse.get(cp) ?? 0x3f);
    }
  }
  return Buffer.from(octets);
}

/**
 * Correspondance octet "page de code" (offset 29 de l'en-tête DBF) -> encodage supporté.
 * Repli sur cp850 (comportement DOS historique le plus fréquent en Suisse) quand l'octet est
 * inconnu ou non déclaré (0x00), à l'image du lecteur de référence Stieger.
 */
export function encodageDepuisOctetPageDeCode(octet: number): EncodageDbf {
  switch (octet) {
    case 0x03:
    case 0x57:
    case 0x58:
    case 0x59:
      return 'cp1252';
    case 0x01:
    case 0x02:
    case 0x08:
    case 0x09:
    case 0x0a:
    case 0x0b:
    case 0x0d:
    case 0x10:
    case 0x11:
    case 0x14:
    case 0x1a:
    case 0x1b:
    case 0x37:
      return 'cp850';
    default:
      return 'cp850';
  }
}
