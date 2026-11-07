/**
 * Génère le PDF d'un DEVIS COMPLÉMENTAIRE : le document à montrer ou transmettre au client quand
 * les travaux découverts dépassent le plafond de l'OR (RM-79 → RM-86) — scénario quotidien « le
 * client refuse le devis complémentaire à mi-travaux » (`docs/specification-etape-1-atelier-
 * clients.md` §6.1).
 *
 * Calqué sur `generation-pdf-or.ts` pour la structure du module (pure MISE EN PAGE, toute la
 * logique de contenu déjà résolue par `donnees-impression-devis.ts`) et sur `facturation/
 * impression/generation-pdf-facture.ts` pour la mise en page ELLE-MÊME (tableau de lignes,
 * récapitulatif TVA par taux) — même bibliothèque `pdfkit`, mêmes largeurs de colonnes, même
 * vocabulaire visuel, pour que les trois documents imprimables du garage (OR, devis, facture) se
 * lisent comme UNE famille cohérente, pas trois logiciels différents.
 *
 * DIFFÉRENCES DÉLIBÉRÉES avec la facture :
 *  - PAS de bulletin QR-facture : un devis n'engage pas comptablement le garage et ne consomme
 *    jamais la séquence des factures (voir la tête de fichier de `service-impression-devis.ts`).
 *  - PAS de mise en cache : comme l'OR, régénéré à CHAQUE appel (un devis peut recevoir une
 *    réponse entre deux impressions — `statutDevis` doit refléter l'état courant).
 *  - Un espace de SIGNATURE client, absent de la facture : au comptoir, le garage peut faire
 *    signer le devis sur place en complément de l'enregistrement électronique de la réponse
 *    (`ServiceDevis.repondre`, RM-81) — trait vectoriel PUR, jamais une signature capturée (ce
 *    n'est pas le mécanisme `POST /ordres-reparation/{id}/signatures`, RM-109, qui reste hors de
 *    ce document).
 */

import PDFDocument from 'pdfkit';
import type { ReponseDevisComplementaire, ReponseOrdreReparation } from '@dfa/shared';

import {
  construireDonneesImpressionDevis,
  type DonneesImpressionDevis,
  type IdentiteGarage,
} from './donnees-impression-devis';

const MARGE_PT = 40;
const MARGE_DROITE_PT = 555;

function dessinerEnTete(doc: PDFKit.PDFDocument, d: DonneesImpressionDevis): void {
  const l = d.libelles;

  for (const [i, ligne] of [
    d.garageRaisonSociale,
    d.garageSiteNom,
    d.garageAdresseLigne1,
    d.garageAdresseLigne2,
    d.garageNumeroTva,
  ]
    .filter((x): x is string => !!x)
    .entries()) {
    if (i === 0) doc.fontSize(9).fillColor('#333333').text(ligne, MARGE_PT, MARGE_PT);
    else doc.text(ligne);
  }

  doc
    .fillColor('#000000')
    .fontSize(16)
    .text(d.titre, MARGE_PT, MARGE_PT + 70);
  doc.fontSize(10).fillColor('#333333');
  doc.text(`${l.dateEnvoi} : ${d.dateEnvoi}`);
  doc.text(`${l.canal} : ${d.canal}`);
  doc.text(d.statutDevis);
  if (d.dateReponse) doc.text(`${l.dateReponse} : ${d.dateReponse}`);
  if (d.interlocuteurNom) doc.text(`${l.interlocuteur} : ${d.interlocuteurNom}`);
  doc.moveDown(1);
}

function dessinerClientEtVehicule(doc: PDFKit.PDFDocument, d: DonneesImpressionDevis): void {
  const l = d.libelles;

  doc.fontSize(9).fillColor('#000000').text(l.client, MARGE_PT);
  doc.fontSize(10).fillColor('#333333').text(d.clientDesignation);
  if (d.clientLocalite) doc.text(d.clientLocalite);
  doc.moveDown(0.6);

  doc.fontSize(9).fillColor('#000000').text(l.vehicule, MARGE_PT);
  doc.fontSize(10).fillColor('#333333');
  doc.text(d.vehiculeDesignation);
  doc.text(`${l.immatriculation} : ${d.immatriculation}`);
  doc.text(`${l.vin} : ${d.vin}`);
  doc.moveDown(1);
}

/** Même patron de colonnes que `generation-pdf-facture.ts::dessinerLignes` (largeurs revues au
 *  correctif #126 bis : « MWST »/« CHF 1'234'567.89 » comme pire cas des deux dimensions). */
function dessinerLignes(doc: PDFKit.PDFDocument, d: DonneesImpressionDevis): void {
  const l = d.libelles;
  const colX = { designation: MARGE_PT, quantite: 260, prixUnitaire: 295, tva: 395, total: 440 };

  doc.fontSize(11).fillColor('#000000').text(l.lignesTitre, MARGE_PT);
  doc.moveDown(0.3);

  if (d.lignes.length === 0) {
    doc.fontSize(10).fillColor('#333333').text(l.aucuneLigne);
    doc.moveDown(1);
    return;
  }

  doc.fontSize(9).fillColor('#000000');
  const yEntete = doc.y;
  doc.text(l.colonneDesignation, colX.designation, yEntete, {
    width: colX.quantite - colX.designation,
  });
  doc.text(l.colonneQuantite, colX.quantite, yEntete, { width: colX.prixUnitaire - colX.quantite });
  doc.text(l.colonnePrixUnitaire, colX.prixUnitaire, yEntete, {
    width: colX.tva - colX.prixUnitaire,
  });
  doc.text(l.colonneTva, colX.tva, yEntete, { width: colX.total - colX.tva });
  doc.text(l.colonneTotal, colX.total, yEntete, { width: MARGE_DROITE_PT - colX.total });
  doc.moveDown(0.3);
  doc.moveTo(MARGE_PT, doc.y).lineTo(MARGE_DROITE_PT, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  doc.fillColor('#000000');
  for (const ligne of d.lignes) {
    const y = doc.y;
    doc.text(ligne.designation, colX.designation, y, { width: colX.quantite - colX.designation });
    doc.text(ligne.quantite, colX.quantite, y, { width: colX.prixUnitaire - colX.quantite });
    doc.text(ligne.prixUnitaire, colX.prixUnitaire, y, { width: colX.tva - colX.prixUnitaire });
    doc.text(ligne.tauxTva, colX.tva, y, { width: colX.total - colX.tva });
    doc.text(ligne.montantTtc, colX.total, y, { width: MARGE_DROITE_PT - colX.total });
    doc.moveDown(0.4);
  }
}

function dessinerRecapitulatifTva(doc: PDFKit.PDFDocument, d: DonneesImpressionDevis): void {
  const l = d.libelles;
  doc.moveDown(1);
  doc.fontSize(10).fillColor('#000000').text(l.recapitulatifTva, MARGE_PT);
  doc.moveDown(0.3);

  const colX = { taux: MARGE_PT, base: 170, tva: 340 };
  doc.fontSize(9);
  for (const v of d.ventilationTva) {
    const y = doc.y;
    doc.text(`${l.tauxTvaLabel} ${v.taux}`, colX.taux, y, { width: colX.base - colX.taux });
    doc.text(`${l.baseHt} ${v.baseHt}`, colX.base, y, { width: colX.tva - colX.base });
    doc.text(`${l.montantTva} ${v.montantTva}`, colX.tva, y);
    doc.moveDown(0.35);
  }

  doc.moveDown(0.5);
  doc.fontSize(9).text(`${l.totalHt} : ${d.totalHt}`, { align: 'right' });
  doc.text(`${l.totalTva} : ${d.totalTva}`, { align: 'right' });
  doc.fontSize(11).text(`${l.totalTtc} : ${d.totalTtc}`, { align: 'right' });
  doc.fontSize(8).fillColor('#666666').text(l.mentionTvaComprise, { align: 'right' });
  doc.fillColor('#000000');
}

function dessinerConditions(doc: PDFKit.PDFDocument, d: DonneesImpressionDevis): void {
  const l = d.libelles;
  doc.moveDown(1);
  doc.fontSize(9).fillColor('#333333');
  if (d.nouveauPlafond) doc.text(`${l.nouveauPlafond} : ${d.nouveauPlafond}`, MARGE_PT);
  if (d.impactRestitution) doc.text(`${l.impactRestitution} : ${d.impactRestitution}`, MARGE_PT);
  doc.moveDown(0.5);
  doc
    .fontSize(8)
    .fillColor('#666666')
    .text(l.mentionEngagement, MARGE_PT, undefined, {
      width: MARGE_DROITE_PT - MARGE_PT,
    });
  doc.fillColor('#000000');
}

/** Espace de signature PUREMENT VISUEL (deux traits vectoriels + libellés) — voir la tête de
 *  fichier : aucune donnée liée, pas le mécanisme `signatures` de l'OR (RM-109). */
function dessinerSignature(doc: PDFKit.PDFDocument, d: DonneesImpressionDevis): void {
  const l = d.libelles;
  doc.moveDown(2);
  const y = doc.y;

  doc
    .moveTo(MARGE_PT, y + 30)
    .lineTo(260, y + 30)
    .strokeColor('#000000')
    .lineWidth(0.75)
    .stroke();
  doc
    .fontSize(9)
    .fillColor('#333333')
    .text(l.signatureClient, MARGE_PT, y + 34);

  doc
    .moveTo(320, y + 30)
    .lineTo(460, y + 30)
    .strokeColor('#000000')
    .lineWidth(0.75)
    .stroke();
  doc
    .fontSize(9)
    .fillColor('#333333')
    .text(l.signatureDate, 320, y + 34);
  doc.fillColor('#000000');
}

export async function genererPdfDevis(
  document: ReponseOrdreReparation,
  devis: ReponseDevisComplementaire,
  identite: IdentiteGarage,
): Promise<Buffer> {
  const donnees = construireDonneesImpressionDevis(document, devis, identite);

  const pdf = new PDFDocument({
    size: 'A4',
    autoFirstPage: true,
    margin: MARGE_PT,
    compress: true,
  });

  return new Promise<Buffer>((resolve, reject) => {
    const morceaux: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => morceaux.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(morceaux)));
    pdf.on('error', reject);

    dessinerEnTete(pdf, donnees);
    dessinerClientEtVehicule(pdf, donnees);
    dessinerLignes(pdf, donnees);
    dessinerRecapitulatifTva(pdf, donnees);
    dessinerConditions(pdf, donnees);
    dessinerSignature(pdf, donnees);

    pdf.end();
  });
}
