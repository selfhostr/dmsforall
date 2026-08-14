/**
 * Génère la FEUILLE D'ATELIER d'un ordre de réparation : le document que le mécanicien accroche
 * au rétroviseur pour travailler sur le véhicule — PAS un document comptable (voir
 * `docs/etat-du-depot.md`, chantier « impression OR »).
 *
 * Contenu volontairement MINIMAL (issue #114) : ce document reste visible depuis l'extérieur
 * d'un véhicule garé dehors — plaque, marque/modèle, n° d'OR, travaux à cocher, technicien.
 * JAMAIS le nom du client, son téléphone, un prix, un total ou une signature — voir la tête de
 * fichier de `donnees-impression-or.ts` pour la doctrine complète (distincte du masquage des
 * montants par rôle, qui reste actif ailleurs et n'est pas altéré par ce module).
 *
 * Pure MISE EN PAGE : toute la logique d'affichage (traduction des enums, absence de donnée) est
 * déjà résolue par `donnees-impression-or.ts` — ce module ne fait plus aucun choix de CONTENU, il
 * dessine ce qu'on lui donne. Voir `donnees-impression-or.spec.ts` pour les tests de CONTENU ;
 * ce fichier n'a que le smoke test « ça produit un PDF valide » (`generation-pdf-or.spec.ts`).
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
/** Case à cocher dessinée en trait (pas le glyphe Unicode `☐`, absent de l'encodage WinAnsi des
 *  14 polices standard de `pdfkit` — un rectangle vectoriel reste fiable quel que soit le PDF. */
const TAILLE_CASE_PT = 9;

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

function dessinerFicheVehicule(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  const l = d.libelles;

  doc.fontSize(11).fillColor('#000000').text(l.vehicule, MARGE_PT);
  doc.fontSize(10).fillColor('#333333');
  doc.text(d.vehiculeDesignation);
  doc.text(`${l.immatriculation} : ${d.immatriculation}`);
  doc.text(`${l.vin} : ${d.vin}`);
  doc.text(`${l.kilometrageEntree} : ${d.kilometrageEntree}`);
  if (d.kilometrageSortie) doc.text(`${l.kilometrageSortie} : ${d.kilometrageSortie}`);
  doc.moveDown(1);
}

/** Ligne « Technicien » omise si aucun pointage n'est encore rattaché à l'OR (`d.technicien ===
 *  null`) — jamais un champ vide affiché, même doctrine que le kilométrage de sortie. */
function dessinerTechnicien(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  if (!d.technicien) return;
  const l = d.libelles;
  doc.fontSize(10).fillColor('#333333').text(`${l.technicien} : ${d.technicien}`, MARGE_PT);
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

/** Travaux à effectuer, en liste à cocher (case dessinée + désignation + quantité) — JAMAIS de
 *  colonne prix/montant, pour aucun rôle (voir la tête de fichier). */
function dessinerLignes(doc: PDFKit.PDFDocument, d: DonneesImpressionOr): void {
  const l = d.libelles;
  doc.fontSize(11).fillColor('#000000').text(l.lignesTitre, MARGE_PT);
  doc.moveDown(0.3);

  if (d.lignes.length === 0) {
    doc.fontSize(10).fillColor('#333333').text(l.aucuneLigne);
    doc.moveDown(1);
    return;
  }

  const colCase = MARGE_PT;
  const colDesignation = MARGE_PT + TAILLE_CASE_PT + 8;
  const colQuantite = 480;

  doc.fontSize(9).fillColor('#000000');
  const yEntete = doc.y;
  doc.text(l.colonneDesignation, colDesignation, yEntete, { width: colQuantite - colDesignation });
  doc.text(l.colonneQuantite, colQuantite, yEntete, { width: LARGEUR_PAGE_PT - colQuantite });
  doc.moveDown(0.3);
  doc.moveTo(MARGE_PT, doc.y).lineTo(LARGEUR_PAGE_PT, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  for (const ligne of d.lignes) {
    const y = doc.y;
    doc
      .rect(colCase, y + 1, TAILLE_CASE_PT, TAILLE_CASE_PT)
      .strokeColor('#000000')
      .lineWidth(0.75)
      .stroke();
    doc.fillColor('#000000');
    doc.text(ligne.designation, colDesignation, y, { width: colQuantite - colDesignation });
    doc.text(ligne.quantite, colQuantite, y, { width: LARGEUR_PAGE_PT - colQuantite });
    doc.moveDown(0.5);
  }
  doc.moveDown(0.6);
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
    dessinerFicheVehicule(pdf, donnees);
    dessinerTechnicien(pdf, donnees);
    dessinerDemandes(pdf, donnees);
    dessinerLignes(pdf, donnees);

    pdf.end();
  });
}
