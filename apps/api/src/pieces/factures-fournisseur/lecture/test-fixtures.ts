/**
 * Fabrique de PDF de test — UNIQUEMENT consommée par `*.spec.ts` de ce répertoire (jamais par du
 * code de production). Construit de vrais PDF avec `pdfkit` (déjà une dépendance du dépôt,
 * `facturation/impression/generation-pdf-facture.ts`) et un vrai symbole QR (`qrcode`,
 * devDependency ajoutée pour ce lot — jamais utilisée en production : la chaîne ne fait que
 * DÉCODER un QR, jamais en émettre un pour ce domaine) — pas de fixture inventée à la main qui
 * pourrait diverger de ce qu'un vrai fichier déposé contient réellement.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface OptionsPdfTest {
  readonly lignesTexte?: readonly string[];
  /** Charge utile à encoder en symbole QR, dessiné en bas de page. `undefined` = pas de QR. */
  readonly payloadQr?: string;
}

export async function construirePdfPourTest(options: OptionsPdfTest = {}): Promise<Buffer> {
  const imageQr = options.payloadQr
    ? await QRCode.toBuffer(options.payloadQr, { type: 'png', margin: 2, width: 240 })
    : null;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  return new Promise<Buffer>((resolve, reject) => {
    const morceaux: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => morceaux.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);

    let y = 50;
    for (const ligne of options.lignesTexte ?? []) {
      doc.fontSize(11).text(ligne, 50, y);
      y += 20;
    }

    if (imageQr) {
      doc.image(imageQr, 400, 650, { width: 130 });
    }

    doc.end();
  });
}

/** Un PDF syntaxiquement valide mais délibérément SANS aucun contenu texte ni image — simule le
 *  résultat d'un scanner qui n'a produit qu'une page blanche (cas limite de la chaîne complète). */
export async function construirePdfVidePourTest(): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  return new Promise<Buffer>((resolve, reject) => {
    const morceaux: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => morceaux.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);
    doc.end();
  });
}
