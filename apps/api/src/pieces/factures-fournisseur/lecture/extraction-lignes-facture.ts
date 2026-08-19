/**
 * Étape 2 (repli) : extraction des LIGNES d'une facture depuis le texte déjà reconstitué en
 * lignes visuelles (`lecteur-pdf.ts#extraireTextePdf`, ou le texte rendu par l'OCR).
 *
 * ⚠️ HEURISTIQUE, DÉLIBÉRÉMENT — pas de norme pour la mise en page d'un tableau de lignes de
 * facture (contrairement au Swiss QR Code, qui EST une norme). Chaque logiciel de facturation
 * fournisseur (Bosch, Febi, un distributeur local sur son propre ERP…) imprime son tableau à sa
 * façon. @laupernoe fournira de vraies factures plus tard (§« Échantillons » de la tâche) — CE fichier
 * est l'outillage à calibrer contre elles, pas un parseur fini. Documenté explicitement pour ne
 * jamais être confondu avec la lecture QR (certaine) — `origine: 'texte_pdf'`/`'ocr'` reste
 * TOUJOURS moins fiable ligne par ligne que `'qr'`, voir `contrats/pieces/enums.ts`.
 *
 * RÈGLE DE PRUDENCE, non négociable : une ligne qui ne présente pas EXACTEMENT le motif attendu
 * (référence optionnelle, désignation, PUIS trois nombres en fin de ligne — quantité, prix
 * unitaire, total) est IGNORÉE plutôt qu'extraite à moitié. Une ligne inventée à partir d'un
 * motif incertain serait pire qu'une ligne manquante : elle entrerait dans le calcul d'écart
 * comme si elle avait été lue avec confiance.
 */
import type { LigneFactureExtraite } from './types';
import type { OrigineDonneeFacture } from '@dfa/shared';

/**
 * `"1'234.50"`, `"1234.50"`, `"1234,50"`, `"50"` -> centimes entiers. Arithmétique ENTIÈRE (même
 * discipline que `payload-qr-facture.ts#centimesDepuisMontantQr`) — jamais `parseFloat(x) * 100`.
 * `null` si le jeton n'a pas la forme d'un montant.
 */
export function centimesDepuisTexteLibre(jeton: string): number | null {
  const nettoye = jeton
    .trim()
    .replace(/['’\s]/g, '')
    .replace(',', '.');
  const correspondance = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(nettoye);
  if (!correspondance) return null;
  const francs = Number(correspondance[1]);
  if (!Number.isSafeInteger(francs)) return null;
  const partieDecimale = (correspondance[2] ?? '').padEnd(2, '0');
  return francs * 100 + Number(partieDecimale);
}

/** `"4"` -> `4000`, `"1.5"` -> `1500`, `"0.25"` -> `250` — millièmes entiers (`schemaQuantiteMillieme`). */
export function milliemeDepuisTexteLibre(jeton: string): number | null {
  const nettoye = jeton
    .trim()
    .replace(/['’\s]/g, '')
    .replace(',', '.');
  const correspondance = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(nettoye);
  if (!correspondance) return null;
  const unites = Number(correspondance[1]);
  if (!Number.isSafeInteger(unites)) return null;
  const partieDecimale = (correspondance[2] ?? '').padEnd(3, '0');
  return unites * 1000 + Number(partieDecimale);
}

/** Un jeton est-il ENTIÈREMENT numérique (chiffres, séparateur milliers apostrophe optionnel,
 *  décimales optionnelles) ? ANCRÉ (`^...$`) — un jeton comme `ABC-123` contient des chiffres
 *  mais n'est PAS un nombre, il ne doit jamais être confondu avec une quantité/un prix/un total. */
const REGEX_JETON_NUMERIQUE = /^\d[\d'’]*(?:[.,]\d{1,3})?$/;

/** Une référence d'article plausible : au moins un chiffre, alphanumérique + tirets/points,
 *  jamais un jeton PUREMENT numérique (qui serait confondu avec un des trois nombres finaux). */
function ressembleAUneReference(jeton: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(jeton) && /\d/.test(jeton) && /[A-Za-z-]/.test(jeton)
  );
}

/**
 * Tente d'extraire une ligne depuis UNE ligne de texte. `null` si le motif « [référence]
 * désignation quantité prixUnitaire total » n'est pas reconnu avec confiance suffisante.
 */
export function extraireLigneDepuisTexte(
  ligneTexte: string,
  origine: OrigineDonneeFacture,
): LigneFactureExtraite | null {
  const jetons = ligneTexte
    .trim()
    .split(/\s+/)
    .filter((j) => j.length > 0);
  if (jetons.length < 4) return null; // au minimum : désignation + 3 nombres

  // Les TROIS DERNIERS jetons numériques valides, dans l'ordre où ils apparaissent.
  const positionsNumeriques: number[] = [];
  for (let i = 0; i < jetons.length; i++) {
    const jeton = jetons[i];
    if (jeton !== undefined && REGEX_JETON_NUMERIQUE.test(jeton)) positionsNumeriques.push(i);
  }
  if (positionsNumeriques.length < 3) return null;
  const positionsFinales = positionsNumeriques.slice(-3);
  const [posQuantite, posPrix, posTotal] = positionsFinales as [number, number, number];
  // Les trois nombres retenus DOIVENT être les trois DERNIERS jetons de la ligne — sinon un nombre
  // apparaît dans la désignation (« filtre M18x1.5 ») et serait confondu avec une quantité.
  if (posTotal !== jetons.length - 1 || posPrix !== posTotal - 1 || posQuantite !== posPrix - 1) {
    return null;
  }

  const jetonQuantite = jetons[posQuantite] ?? '';
  const jetonPrix = jetons[posPrix] ?? '';
  const jetonTotal = jetons[posTotal] ?? '';

  const quantiteMillieme = milliemeDepuisTexteLibre(jetonQuantite);
  const prixUnitaireCentimes = centimesDepuisTexteLibre(jetonPrix);
  const totalLigneCentimes = centimesDepuisTexteLibre(jetonTotal);
  if (quantiteMillieme === null || quantiteMillieme <= 0) return null;
  if (prixUnitaireCentimes === null || totalLigneCentimes === null) return null;

  const jetonsRestants = jetons.slice(0, posQuantite);
  if (jetonsRestants.length === 0) return null; // aucune désignation : ligne non exploitable

  const premierJeton = jetonsRestants[0];
  const aUneReference = premierJeton !== undefined && ressembleAUneReference(premierJeton);
  const referenceArticle = aUneReference ? (premierJeton ?? null) : null;
  const designationJetons = aUneReference ? jetonsRestants.slice(1) : jetonsRestants;
  const designation = designationJetons.length > 0 ? designationJetons.join(' ') : null;

  return {
    referenceArticle,
    designation,
    quantiteMillieme,
    prixUnitaireCentimes,
    totalLigneCentimes,
    origine,
  };
}

/** Applique `extraireLigneDepuisTexte` ligne à ligne — ignore silencieusement les lignes qui ne
 *  correspondent pas au motif (en-têtes de tableau, mentions légales, total général…). */
export function extraireLignesFacture(
  texte: string,
  origine: OrigineDonneeFacture,
): readonly LigneFactureExtraite[] {
  return texte
    .split('\n')
    .map((ligne) => extraireLigneDepuisTexte(ligne, origine))
    .filter((ligne): ligne is LigneFactureExtraite => ligne !== null);
}
