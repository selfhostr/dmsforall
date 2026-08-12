/**
 * Génère la FEUILLE D'ATELIER d'un ordre de réparation : le document que le mécanicien accroche
 * au rétroviseur pour travailler sur le véhicule — PAS un document comptable (voir
 * `docs/etat-du-depot.md`, chantier « impression OR »).
 *
 * Pure MISE EN PAGE : toute la logique d'affichage (traduction des enums, masquage des montants,
 * absence de donnée) est déjà résolue par `donnees-impression-or.ts` — ce module ne fait plus
 * aucun choix, il dessine ce qu'on lui donne. Voir `donnees-impression-or.spec.ts` pour les tests
 * de CONTENU (masquage des montants par rôle, phrases d'absence) ; ce fichier n'a que le smoke
 * test « ça produit un PDF valide » (`generation-pdf-or.spec.ts`).
 *
 * Différence de doctrine DÉLIBÉRÉE avec `facturation/impression/generation-pdf-facture.ts` : une
 * facture émise est immuable, son PDF se met en cache une fois pour toutes. Un OR est VIVANT
 * (lignes ajoutées, statut, restitution qui évoluent) — cette fonction est donc appelée à CHAQUE
 * requête (voir `service-impression-or.ts`), sans aucune mise en cache.
 */

import PDFDocument from 'pdfkit';
import type { ReponseOrdreReparation } from '@dfa/shared';

import { construireDonneesImpressionOr, type DonneesImpressionOr } from './donnees-impression-or';

const MARGE_PT = 40;
const LARGEUR_PAGE_PT = 555;

function dessinerEnTete(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  const l = d.libelles;
  doc.fontSize(18).fillColor('#000000').text(l.ordreReparationNumero(d.numero), MARGE_PT, MARGE_PT);
  doc.moveDown(0.3);

  doc.fontSize(10).fillColor('#333333');
  doc.text(`${l.dateOuverture} : ${d.dateOuverture}`);
  if (d.site) doc.text(`${l.site} : ${d.site}`);
  doc.text(`${l.type} : ${d.type}`);
  doc.text(`${l.statut} : ${d.statut}`);
  doc.text(`${l.restitutionPromise} : ${d.restitutionPromise}`);
  doc.moveDown(1);
}

function dessinerFicheVehiculeClient(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  const l = d.libelles;

  doc.fontSize(11).fillColor('#000000').text(l.vehicule, MARGE_PT);
  doc.fontSize(10).fillColor('#333333');
  doc.text(d.vehiculeDesignation);
  doc.text(`${l.immatriculation} : ${d.immatriculation}`);
  doc.text(`${l.vin} : ${d.vin}`);
  doc.text(`${l.kilometrageEntree} : ${d.kilometrageEntree}`);
  if (d.kilometrageSortie) doc.text(`${l.kilometrageSortie} : ${d.kilometrageSortie}`);
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#000000').text(l.client, MARGE_PT);
  doc.fontSize(10).fillColor('#333333');
  doc.text(d.clientNom);
  doc.text(`${l.telephone} : ${d.telephone}`);
  doc.moveDown(1);
}

function dessinerDemandes(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  const l = d.libelles;
  doc.fontSize(11).fillColor('#000000').text(l.demandesTitre, MARGE_PT);
  doc.fontSize(10).fillColor('#333333');
  if (d.demandes.length === 0) {
    doc.text(l.aucuneDemande);
  } else {
    for (const verbatim of d.demandes) {
      doc.text(`• ${verbatim}`, { width: LARGEUR_PAGE_PT - MARGE_PT });
    }
  }
  doc.moveDown(1);
}

function dessinerLignes(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  const l = d.libelles;
  doc.fontSize(11).fillColor('#000000').text(l.lignesTitre, MARGE_PT);
  doc.moveDown(0.3);

  if (d.lignes.length === 0) {
    doc.fontSize(10).fillColor('#333333').text(l.aucuneLigne);
    doc.moveDown(1);
    return;
  }

  const colX = d.voitMontants
    ? { designation: MARGE_PT, quantite: 330, prixUnitaire: 380, montant: 470 }
    : { designation: MARGE_PT, quantite: 480, prixUnitaire: 0, montant: 0 };

  doc.fontSize(9).fillColor('#000000');
  const yEntete = doc.y;
  doc.text(l.colonneDesignation, colX.designation, yEntete, {
    width: colX.quantite - colX.designation,
  });
  doc.text(l.colonneQuantite, colX.quantite, yEntete, {
    width: (d.voitMontants ? colX.prixUnitaire : LARGEUR_PAGE_PT) - colX.quantite,
  });
  if (d.voitMontants) {
    doc.text(l.colonnePrixUnitaire, colX.prixUnitaire, yEntete, {
      width: colX.montant - colX.prixUnitaire,
    });
    doc.text(l.colonneMontant, colX.montant, yEntete);
  }
  doc.moveDown(0.3);
  doc.moveTo(MARGE_PT, doc.y).lineTo(LARGEUR_PAGE_PT, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  for (const ligne of d.lignes) {
    const y = doc.y;
    doc.fillColor('#000000');
    doc.text(ligne.designation, colX.designation, y, { width: colX.quantite - colX.designation });
    doc.text(ligne.quantite, colX.quantite, y, {
      width: (d.voitMontants ? colX.prixUnitaire : LARGEUR_PAGE_PT) - colX.quantite,
    });
    if (d.voitMontants) {
      doc.text(ligne.prixUnitaire ?? '', colX.prixUnitaire, y, {
        width: colX.montant - colX.prixUnitaire,
      });
      doc.text(ligne.montant ?? '', colX.montant, y);
    }
    doc.moveDown(0.4);
  }
  doc.moveDown(0.6);
}

function dessinerSignature(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  // Un OR peut être imprimé avant même l'ouverture du dossier (peu de contenu au-dessus) : on
  // place le bloc signature en position ABSOLUE en bas de la PREMIÈRE page plutôt qu'en suite du
  // flux — sans quoi il remonterait juste sous les demandes sur un OR sans lignes.
  const y = doc.page.height - doc.page.margins.bottom - 60;
  doc
    .moveTo(MARGE_PT, y)
    .lineTo(MARGE_PT + 220, y)
    .strokeColor('#333333')
    .stroke();
  doc
    .fontSize(9)
    .fillColor('#333333')
    .text(d.libelles.signatureClient, MARGE_PT, y + 4);
}

export async function genererPdfOr(
  document: ReponseOrdreReparation,
  nomSite: string,
): Promise<Buffer> {
  const donnees = construireDonneesImpressionOr(document, nomSite);

  const pdf = new PDFDocument({
    size: 'A4',
    autoFirstPage: true,
    margin: MARGE_PT,
    // Non compressé, à la différence de `generation-pdf-facture.ts` : cette feuille est un
    // document interne imprimé une fois puis jeté, jamais archivé ni transmis — le poids n'a
    // aucune conséquence, et un flux non compressé reste inspectable tel quel en support.
    compress: false,
  });

  return new Promise<Buffer>((resolve, reject) => {
    const morceaux: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => morceaux.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(morceaux)));
    pdf.on('error', reject);

    dessinerEnTete(pdf, donnees);
    dessinerFicheVehiculeClient(pdf, donnees);
    dessinerDemandes(pdf, donnees);
    dessinerLignes(pdf, donnees);
    dessinerSignature(pdf, donnees);

    pdf.end();
  });
}
