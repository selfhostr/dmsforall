/**
 * Étape 1 de la chaîne : le QR-facture. `jsqr` (déjà une dépendance du dépôt — voir
 * `facturation/impression/verification-payload-qr.ts`, qui décode un QR reconstruit pour un tout
 * autre besoin — décodage réel, tiers indépendant de tout ce que ce dépôt génère lui-même) essaie
 * CHAQUE image extraite du PDF (`lecteur-pdf.ts`) : un PDF peut contenir un logo, une signature
 * scannée, etc. en plus du symbole de paiement — on ne sait pas laquelle est LA bonne avant
 * d'essayer, et jsQR rend `null` sur tout ce qui n'est pas un symbole QR déchiffrable.
 */
import jsQR from 'jsqr';

import { extraireImagesPdf } from './lecteur-pdf';
import { decoderPayloadQrFacture } from './payload-qr-facture';
import type { EnTeteFactureExtrait } from './types';

export interface ResultatDecodageQr {
  readonly enTete: EnTeteFactureExtrait | null;
  readonly diagnostics: readonly string[];
}

export async function decoderQrFacturePdf(pdf: Buffer): Promise<ResultatDecodageQr> {
  const images = await extraireImagesPdf(pdf);
  if (images.length === 0) {
    return { enTete: null, diagnostics: ['qr: aucune image embarquée dans le PDF.'] };
  }

  for (const image of images) {
    // jsQR détecte le symbole ET son orientation lui-même (pas de prétraitement requis) — un QR
    // suisse imprimé est toujours net et bien cadré dans son image source, contrairement à une
    // photo de comptoir (cas hors périmètre, §1 de la tâche : dépôt fichier uniquement).
    const resultat = jsQR(image.rgba, image.largeur, image.hauteur);
    if (!resultat) continue;

    const enTete = decoderPayloadQrFacture(resultat.data);
    if (enTete) return { enTete, diagnostics: [] };
    // Un symbole QR a été décodé mais ce n'est pas un Swiss QR Code (logo/QR de tracking…) —
    // on continue avec les images suivantes plutôt que d'abandonner.
  }

  return {
    enTete: null,
    diagnostics: [
      `qr: ${images.length} image(s) embarquée(s), aucune ne contient de Swiss QR Code exploitable.`,
    ],
  };
}
