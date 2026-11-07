/**
 * En-tête émetteur partagé par tous les PDF du garage (facture, devis de vente, devis
 * complémentaire, feuille d'OR) : raison sociale, adresse postale, n° TVA (mention obligatoire pour
 * un assujetti, art. 26 LTVA). Les lignes vides sont omises — jamais de libellé sans valeur.
 */

export interface IdentiteEmetteur {
  readonly nom: string;
  readonly nomSite?: string | null;
  readonly rue?: string | null;
  readonly numero?: string | null;
  readonly npa?: string | null;
  readonly localite?: string | null;
  /** N° TVA tel que saisi dans les réglages (ex. « CHE-114.873.733 TVA »). */
  readonly numeroTva?: string | null;
  /** Mention « Non assujetti à la TVA » (déjà traduite), imprimée À LA PLACE du n° TVA. */
  readonly mentionNonAssujetti?: string | null;
}

/** Lignes imprimables de l'en-tête, dans l'ordre : nom, site, rue, NPA localité, n° TVA. */
export function lignesEnTeteEmetteur(e: IdentiteEmetteur): string[] {
  const lignes: string[] = [];
  const nom = e.nom.trim();
  if (nom) lignes.push(nom);
  const site = e.nomSite?.trim();
  if (site) lignes.push(site);
  const rue = e.rue?.trim();
  if (rue) lignes.push(e.numero?.trim() ? `${rue} ${e.numero.trim()}` : rue);
  const ville = `${e.npa?.trim() ?? ''} ${e.localite?.trim() ?? ''}`.trim();
  if (ville) lignes.push(ville);
  const mention = e.mentionNonAssujetti?.trim();
  const tva = e.numeroTva?.trim();
  if (mention) lignes.push(mention);
  else if (tva) lignes.push(tva);
  return lignes;
}

/** Dessine l'en-tête en haut à gauche (police 9, gris foncé) ; `x`/`y` = coin supérieur gauche. */
export function dessinerEnTeteEmetteur(
  doc: PDFKit.PDFDocument,
  e: IdentiteEmetteur,
  x: number,
  y: number,
): void {
  const lignes = lignesEnTeteEmetteur(e);
  doc.fontSize(9).fillColor('#333333');
  lignes.forEach((ligne, i) => {
    if (i === 0) doc.text(ligne, x, y);
    else doc.text(ligne);
  });
}
