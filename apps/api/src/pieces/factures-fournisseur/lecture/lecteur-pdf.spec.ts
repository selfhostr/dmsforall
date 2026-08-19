import { describe, expect, it } from 'vitest';

import { extraireImagesPdf, extraireTextePdf } from './lecteur-pdf';
import { construirePdfPourTest, construirePdfVidePourTest } from './test-fixtures';

describe('extraireTextePdf', () => {
  it('extrait le texte déjà présent dans le PDF, ligne par ligne, dans l’ordre visuel', async () => {
    const pdf = await construirePdfPourTest({
      lignesTexte: ['Facture fournisseur N° 2026-4471', 'ABC-123 Filtre à huile 4 12.50 50.00'],
    });
    const texte = await extraireTextePdf(pdf);
    expect(texte).toBe('Facture fournisseur N° 2026-4471\nABC-123 Filtre à huile 4 12.50 50.00');
  });

  it('rend null pour un PDF sans aucun texte (page blanche — cas du PDF scanné)', async () => {
    const pdf = await construirePdfVidePourTest();
    expect(await extraireTextePdf(pdf)).toBeNull();
  });
});

describe('extraireImagesPdf', () => {
  it('extrait une image embarquée en RGBA exploitable, sans rendu de page complet', async () => {
    // Encode un payload QUELCONQUE en QR juste pour avoir une vraie image PNG embarquée — le
    // décodage QR lui-même est testé dans decodeur-qr-facture.spec.ts, pas ici : ce test prouve
    // seulement que l'EXTRACTION d'image (indépendante de tout contenu QR) fonctionne.
    const pdf = await construirePdfPourTest({ payloadQr: 'contenu quelconque' });
    const images = await extraireImagesPdf(pdf);

    expect(images).toHaveLength(1);
    expect(images[0]?.largeur).toBeGreaterThan(0);
    expect(images[0]?.hauteur).toBeGreaterThan(0);
    expect(images[0]?.rgba.length).toBe((images[0]?.largeur ?? 0) * (images[0]?.hauteur ?? 0) * 4);
  });

  it('rend un tableau vide pour un PDF sans image', async () => {
    const pdf = await construirePdfPourTest({ lignesTexte: ['Rien que du texte.'] });
    expect(await extraireImagesPdf(pdf)).toEqual([]);
  });
});
