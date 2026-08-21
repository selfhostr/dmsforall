import { beforeAll, describe, expect, it } from 'vitest';

import { extraireImagesPdf, extraireTextePdf } from './lecteur-pdf';
import { construirePdfPourTest, construirePdfVidePourTest } from './test-fixtures';

// PRÉCHAUFFAGE (à la collecte du fichier, PAS chronométré par `testTimeout`) : le premier appel du
// process à `extraireTextePdf`/`extraireImagesPdf` paie un coût fixe d'environ 1 à 2 s (chargement
// du module ESM `pdfjs-dist` via `require(esm)`, première init interne de son moteur de
// documents) — mesuré en isolant chaque étape (voir rapport de livraison sur
// `decodeur-qr-facture.spec.ts`, même cause). Ce n'est pas du travail redondant dans le test
// lui-même (un deuxième appel, PDF différent, retombe à quelques dizaines de ms) : c'est un coût
// de démarrage de bibliothèque payé une fois par process, qui atterrissait par hasard sur le
// premier `it()` chronométré de ce fichier et pouvait, sous charge CI (observé à 2899ms aux côtés
// des autres specs de ce répertoire, contre ~1200ms isolé), dépasser les 5000ms sans rapport avec
// ce que ce test vérifie.
// `try/catch` uniquement pour rendre l'échec lisible : un top-level await qui rejette fait tomber
// TOUTE la collecte du fichier (les 4 `it()` ci-dessous, jamais exécutés) avec un message Vitest
// générique de collecte. En cas de régression réelle dans la chaîne, ce message pointe
// explicitement vers le préchauffage plutôt que de laisser croire qu'un des tests a échoué.
describe('extraireTextePdf', () => {
  beforeAll(async () => {
    try {
      await extraireTextePdf(await construirePdfPourTest({ lignesTexte: ['PRECHAUFFAGE'] }));
    } catch (cause) {
      throw new Error(
        'Préchauffage de extraireTextePdf (hors test, dans beforeAll) en échec — aucun ' +
          "des `it()` de ce fichier n'a encore tourné, voir la cause enchaînée.",
        { cause },
      );
    }
  }, 60_000);
  // Le préchauffage ci-dessus (hors chronomètre) ramène ce test à ~100ms au repos, mais sous
  // forte contention CI (mesuré ailleurs sur ce dépôt : un fichier de test à 84s au lieu de
  // quelques secondes, ressources partagées avec d'autres processus) une chaîne « chaude » peut
  // quand même dépasser les 5000ms par défaut sans qu'aucune régression réelle ne soit en cause
  // — délai généreux pour ce test précis uniquement, pas un affaiblissement de ce qu'il vérifie.
  it("extrait le texte déjà présent dans le PDF, ligne par ligne, dans l'ordre visuel", async () => {
    const pdf = await construirePdfPourTest({
      lignesTexte: ['Facture fournisseur N° 2026-4471', 'ABC-123 Filtre à huile 4 12.50 50.00'],
    });
    const texte = await extraireTextePdf(pdf);
    expect(texte).toBe('Facture fournisseur N° 2026-4471\nABC-123 Filtre à huile 4 12.50 50.00');
  }, 30_000);

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
