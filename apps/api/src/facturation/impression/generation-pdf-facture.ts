/**
 * Génère le PDF complet d'une facture ÉMISE : corps de facture (en-tête créancier, client, lignes,
 * récapitulatif TVA, totaux) + bulletin QR-facture (`swissqrbill/pdf`, mise en page déléguée à la
 * bibliothèque — voir `docs/design-impression-facture-qr.md`).
 *
 * NE VÉRIFIE PAS l'éligibilité du document (type, statut, présence du bloc QR) — c'est la
 * responsabilité de l'appelant (`service-impression-facture.ts`), qui a déjà résolu
 * `ReponseDocumentVente` avec les droits du principal. Ce module suppose `document.qr !== null` et
 * lève `ErreurMetier('ERREUR_INTERNE', …)` si ce n'est pas le cas — défense en profondeur, ne
 * devrait jamais se produire en pratique.
 *
 * `verifierEquivalencePayload` (DI-3/MD-77) est appelée AVANT tout rendu PDFKit : un document dont
 * le bulletin QR ne peut pas être prouvé fidèle au payload figé n'obtient AUCUN PDF, pas même un
 * PDF partiel.
 */

import PDFDocument from 'pdfkit';
import { SwissQRBill } from 'swissqrbill/pdf';
import type {
  DeviseFacturation,
  ReponseDocumentVente,
  ReponseLigneDocumentVente,
} from '@dfa/shared';

import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import {
  construireDonneesSwissQrBill,
  langueSwissQrBill,
  validerLangueFigee,
} from './donnees-swissqrbill';
import { ajouterJoursIso, formaterDateSuisse, formaterMontantAvecDevise } from './formatage-suisse';
import { libellesImpression, type LibellesFacture } from './libelles-impression';
import { verifierEquivalencePayload } from './verification-payload-qr';

const MARGE_PT = 40;

function exigerMontantsVisibles(document: ReponseDocumentVente): {
  readonly totalHtCentimes: number;
  readonly totalTvaCentimes: number;
  readonly totalTtcCentimes: number;
  readonly ventilationTva: readonly {
    readonly regimeTva: string;
    readonly tauxTvaPourmille: number;
    readonly baseCentimes: number;
    readonly tvaCentimes: number;
  }[];
} {
  if (
    document.totalHtCentimes === undefined ||
    document.totalTvaCentimes === undefined ||
    document.totalTtcCentimes === undefined ||
    document.ventilationTva === undefined
  ) {
    // Ne devrait jamais se produire : l'endpoint d'impression exige un droit qui implique la
    // visibilité des montants (RF-116) — voir `service-impression-facture.ts`. Si ça se produit
    // quand même, refuser plutôt que d'imprimer une facture sans le moindre montant.
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Document ${document.id} : montants absents de la réponse au moment de générer le PDF — ` +
        "le principal utilisé pour résoudre le document n'a probablement pas les droits attendus.",
    );
  }
  return {
    totalHtCentimes: document.totalHtCentimes,
    totalTvaCentimes: document.totalTvaCentimes,
    totalTtcCentimes: document.totalTtcCentimes,
    ventilationTva: document.ventilationTva,
  };
}

/** En-tête d'expéditeur imprimé : nom + adresse postale (la facture le tire du bloc QR figé, le
 *  devis du paramétrage du garage — voir `service-impression-facture.ts`). */
export interface ExpediteurImpression {
  readonly nom: string;
  readonly rue: string | null;
  readonly numero: string | null;
  readonly npa: string | null;
  readonly localite: string | null;
}

function dessinerEnTete(
  doc: PDFKit.PDFDocument,
  document: ReponseDocumentVente,
  expediteur: ExpediteurImpression,
  titre: string,
  l: LibellesFacture,
  lignesSousTitre: readonly string[] = [],
): void {
  doc.fontSize(9).fillColor('#333333');
  doc.text(expediteur.nom, MARGE_PT, MARGE_PT);
  if (expediteur.rue) {
    doc.text(`${expediteur.rue}${expediteur.numero ? ' ' + expediteur.numero : ''}`);
  }
  if (expediteur.npa || expediteur.localite) {
    doc.text(`${expediteur.npa ?? ''} ${expediteur.localite ?? ''}`.trim());
  }

  doc
    .fillColor('#000000')
    .fontSize(18)
    .text(titre, MARGE_PT, MARGE_PT + 70);
  doc.fontSize(10).text(`${l.dateDocument} : ${formaterDateSuisse(document.dateDocument)}`);
  for (const ligne of lignesSousTitre) doc.text(ligne);
  doc.moveDown(1.5);

  doc.fontSize(9).text(l.client, MARGE_PT);
  doc.fontSize(10).text(document.figees.clientDesignation);
  if (document.figees.adresseFacturation) {
    const a = document.figees.adresseFacturation;
    doc.text(`${a.rue}${a.numero ? ' ' + a.numero : ''}`);
    doc.text(`${a.npa} ${a.localite}`);
  }
  doc.moveDown(1);
}

function dessinerLignes(
  doc: PDFKit.PDFDocument,
  lignes: readonly ReponseLigneDocumentVente[],
  l: LibellesFacture,
  devise: DeviseFacturation,
): void {
  // Largeurs revues (régression #126 bis, trouvée par la contre-vérification indépendante) :
  // le premier passage avait élargi `prixUnitaire`/`total` pour le préfixe devise mais RÉTRÉCI
  // `tva` à 25pt (430→455) — assez pour "TVA"/"IVA" (3 caractères) mais pas pour l'allemand
  // "MWST" (4 caractères, `libelles-impression.ts` DE), qui se scindait en "MWS"/"T" sur deux
  // lignes. Toutes les colonnes redimensionnées ensemble pour le pire cas des DEUX dimensions à
  // la fois : le plus long en-tête de colonne (`"MWST"`, 4 car.) ET le plus long montant
  // plausible (devise + 7 chiffres, `"CHF 1'234'567.89"`, 17 car.) — jamais testés isolément.
  //   - `tva` (430→45pt de large, était 25pt) : "MWST" measuré à l'aide d'un PDF réel généré en
  //     allemand tient désormais sur une seule ligne (voir le rapport de livraison).
  //   - `prixUnitaire` (100pt de large) et `total` (115pt, jusqu'à la marge droite 555) : chacun
  //     absorbe `"CHF 1'234'567.89"` sans déborder sur son voisin.
  //   - `designation`/`quantite` légèrement resserrées en contrepartie (220pt/35pt) — une
  //     désignation encore plus longue s'enroule sur plusieurs lignes (comportement `pdfkit`
  //     déjà en place avant ce correctif), jamais tronquée silencieusement.
  const colX = { designation: MARGE_PT, quantite: 260, prixUnitaire: 295, tva: 395, total: 440 };
  const MARGE_DROITE_PT = 555;

  doc.fontSize(9).fillColor('#000000');
  const yEntete = doc.y;
  doc.text(l.designation, colX.designation, yEntete, { width: colX.quantite - colX.designation });
  doc.text(l.quantite, colX.quantite, yEntete, { width: colX.prixUnitaire - colX.quantite });
  doc.text(l.prixUnitaire, colX.prixUnitaire, yEntete, { width: colX.tva - colX.prixUnitaire });
  doc.text(l.tva, colX.tva, yEntete, { width: colX.total - colX.tva });
  doc.text(l.total, colX.total, yEntete, { width: MARGE_DROITE_PT - colX.total });
  doc.moveDown(0.3);
  doc.moveTo(MARGE_PT, doc.y).lineTo(MARGE_DROITE_PT, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  for (const ligne of lignes) {
    const y = doc.y;
    const quantite = ligne.quantiteMillieme / 1000;
    doc.text(ligne.designation, colX.designation, y, { width: colX.quantite - colX.designation });
    doc.text(String(quantite), colX.quantite, y, { width: colX.prixUnitaire - colX.quantite });
    doc.text(
      ligne.prixUnitaireTtcCentimes != null
        ? formaterMontantAvecDevise(ligne.prixUnitaireTtcCentimes, devise)
        : '',
      colX.prixUnitaire,
      y,
      {
        width: colX.tva - colX.prixUnitaire,
      },
    );
    doc.text(`${(ligne.tauxTvaPourmille / 10).toFixed(1)}%`, colX.tva, y, {
      width: colX.total - colX.tva,
    });
    doc.text(
      ligne.montants ? formaterMontantAvecDevise(ligne.montants.montantTtcCentimes, devise) : '',
      colX.total,
      y,
      { width: MARGE_DROITE_PT - colX.total },
    );
    doc.moveDown(0.4);
  }
}

function dessinerRecapitulatifTva(
  doc: PDFKit.PDFDocument,
  totaux: ReturnType<typeof exigerMontantsVisibles>,
  l: LibellesFacture,
  devise: DeviseFacturation,
): void {
  doc.moveDown(1);
  doc.fontSize(10).text(l.recapitulatifTva, MARGE_PT);
  doc.moveDown(0.3);

  // `base`/`tva` élargies (150→170, 300→340) : même défaut que `dessinerLignes` ci-dessus — les
  // libellés composés ici sont plus longs en allemand (`"Basis Netto"`/`"MWST-Betrag"`, contre
  // `"Base HT"`/`"Montant TVA"` en français) ET portent désormais un montant préfixé de la devise
  // (`"CHF 1'234'567.89"`, pire cas) depuis ce même correctif #126 — les deux se cumulent sur la
  // colonne `base` en particulier (`"Basis Netto CHF 1'234'567.89"`, ~29 caractères).
  const colX = { taux: MARGE_PT, base: 170, tva: 340 };
  doc.fontSize(9);
  for (const v of totaux.ventilationTva) {
    const y = doc.y;
    doc.text(`${l.tauxTvaLabel} ${(v.tauxTvaPourmille / 10).toFixed(1)}%`, colX.taux, y, {
      width: colX.base - colX.taux,
    });
    doc.text(`${l.baseHt} ${formaterMontantAvecDevise(v.baseCentimes, devise)}`, colX.base, y, {
      width: colX.tva - colX.base,
    });
    doc.text(`${l.montantTva} ${formaterMontantAvecDevise(v.tvaCentimes, devise)}`, colX.tva, y);
    doc.moveDown(0.35);
  }

  doc.moveDown(0.5);
  doc
    .fontSize(9)
    .text(`${l.totalHt} : ${formaterMontantAvecDevise(totaux.totalHtCentimes, devise)}`, {
      align: 'right',
    });
  doc.text(`${l.totalTva} : ${formaterMontantAvecDevise(totaux.totalTvaCentimes, devise)}`, {
    align: 'right',
  });
  doc
    .fontSize(11)
    .text(`${l.totalTtc} : ${formaterMontantAvecDevise(totaux.totalTtcCentimes, devise)}`, {
      align: 'right',
    });
  doc.fontSize(8).fillColor('#666666').text(l.mentionTvaComprise, { align: 'right' });
  doc.fillColor('#000000');
}

/**
 * @param expediteur nom + adresse du garage, OBLIGATOIRE quand `document.qr` est `null` (facture
 *        émise sans bloc créancier complet, ou devise hors CHF/EUR) : le PDF est alors rendu SANS
 *        bulletin QR, avec la mention « coordonnées de paiement non renseignées ».
 * @throws ErreurMetier `ERREUR_INTERNE` — document qui n'est pas une facture, QR absent sans
 *         expéditeur, montants absents, ou divergence de payload (DI-3/MD-77).
 */
export async function genererPdfFacture(
  document: ReponseDocumentVente,
  expediteur?: ExpediteurImpression,
): Promise<Buffer> {
  if (document.typeDocument !== 'facture' || (document.qr == null && !expediteur)) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `genererPdfFacture appelé sur le document ${document.id} sans bloc QR ni expéditeur — ` +
        "l'appelant doit filtrer en amont (typeDocument = facture, statut émis).",
    );
  }

  const qr = document.qr;
  const numero = document.numero ?? '';
  const donneesSwissQrBill = qr ? construireDonneesSwissQrBill(qr, numero) : null;

  // DI-3/MD-77 : refuse AVANT tout rendu si le payload que swissqrbill encoderait diverge du
  // payload figé à l'émission.
  if (qr && donneesSwissQrBill)
    verifierEquivalencePayload(donneesSwissQrBill, qr.qrPayload, document.id);

  const langueClient = qr ? qr.qrLangue : document.figees.clientLangue;
  const libelles = libellesImpression(
    qr
      ? validerLangueFigee(langueClient)
      : langueClient === 'de' || langueClient === 'it'
        ? langueClient
        : 'fr',
  );
  const totaux = exigerMontantsVisibles(document);
  const expediteurFacture: ExpediteurImpression =
    expediteur ??
    (qr
      ? { nom: qr.creancier.nom, ...qr.creancier.adresse }
      : { nom: '', rue: null, numero: null, npa: null, localite: null });

  const pdf = new PDFDocument({
    size: 'A4',
    autoFirstPage: true,
    margin: MARGE_PT,
    // Déterministe (`document.emisLe`, figé et immuable) plutôt que `now()` : deux générations du
    // même document produisent alors des octets identiques — élimine la fenêtre de course entre
    // deux premières requêtes concurrentes évoquée dans `stockage-pdf.ts`.
    info: document.emisLe
      ? { CreationDate: new Date(document.emisLe), ModDate: new Date(document.emisLe) }
      : undefined,
  });

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const morceaux: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => morceaux.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(morceaux)));
    pdf.on('error', reject);

    dessinerEnTete(
      pdf,
      document,
      expediteurFacture,
      libelles.factureNumero(document.numero ?? ''),
      libelles,
    );
    dessinerLignes(pdf, document.lignes, libelles, document.devise);
    dessinerRecapitulatifTva(pdf, totaux, libelles, document.devise);

    if (qr && donneesSwissQrBill) {
      const qrBill = new SwissQRBill(donneesSwissQrBill, {
        language: langueSwissQrBill(qr.qrLangue),
      });
      qrBill.attachTo(pdf);
    } else {
      pdf.moveDown(1.5);
      pdf.fontSize(9).fillColor('#000000').text(libelles.paiementNonRenseigne, MARGE_PT);
    }

    // `pdfkit` est un flux Node standard : les événements `data` sont émis de façon ASYNCHRONE
    // (vérifié en exécution, `.../scratchpad/qrbill-eval/` — 0 octet lu juste après `.end()`, le
    // contenu n'arrive qu'à l'événement `end`) — d'où la `Promise` ci-dessus plutôt qu'un retour
    // synchrone de `Buffer.concat`.
    pdf.end();
  });

  return buffer;
}

/** Validité commerciale d'un devis imprimé quand aucune date de validité n'est stockée (le modèle
 *  n'a pas de colonne dédiée) : 30 jours après `dateDocument`. */
export const VALIDITE_DEVIS_JOURS = 30;

export function dateValiditeDevis(dateDocument: string): string {
  return ajouterJoursIso(dateDocument, VALIDITE_DEVIS_JOURS);
}

/**
 * PDF d'un DEVIS (brouillon ou non) : même corps que la facture (lignes, récapitulatif TVA, totaux),
 * titre « Devis », date de validité, et AUCUN bulletin QR ni numéro de facture. L'appelant
 * (`service-impression-facture.ts`) vérifie le type et fournit l'expéditeur (paramétrage garage).
 * Non mis en cache : un devis brouillon change, et le rendu est peu coûteux.
 */
export async function genererPdfDevis(
  document: ReponseDocumentVente,
  expediteur: ExpediteurImpression,
): Promise<Buffer> {
  if (document.typeDocument !== 'devis') {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `genererPdfDevis appelé sur le document ${document.id} qui n'est pas un devis.`,
    );
  }

  // Un devis n'a pas de `qr_langue` figée : une langue client inconnue retombe sur le français
  // (source i18n) plutôt que de refuser d'imprimer un devis.
  const langueClient = document.figees.clientLangue;
  const libelles = libellesImpression(
    langueClient === 'de' || langueClient === 'it' ? langueClient : 'fr',
  );
  const totaux = exigerMontantsVisibles(document);
  const titre = document.numero ? libelles.devisNumero(document.numero) : libelles.devisBrouillon;
  const validite = `${libelles.valableJusqu} : ${formaterDateSuisse(dateValiditeDevis(document.dateDocument))}`;

  const pdf = new PDFDocument({
    size: 'A4',
    autoFirstPage: true,
    margin: MARGE_PT,
    info: { CreationDate: new Date(document.modifieLe), ModDate: new Date(document.modifieLe) },
  });

  return new Promise<Buffer>((resolve, reject) => {
    const morceaux: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => morceaux.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(morceaux)));
    pdf.on('error', reject);

    dessinerEnTete(pdf, document, expediteur, titre, libelles, [validite]);
    dessinerLignes(pdf, document.lignes, libelles, document.devise);
    dessinerRecapitulatifTva(pdf, totaux, libelles, document.devise);
    pdf.moveDown(1.5);
    pdf.fontSize(8).fillColor('#666666').text(libelles.devisMention, MARGE_PT);
    pdf.end();
  });
}
