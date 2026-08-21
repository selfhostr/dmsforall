import { beforeAll, describe, expect, it } from 'vitest';

import { encoderChargeUtileQr, type DonneesQrFacture } from '../../../facturation/qr';

import { decoderQrFacturePdf } from './decodeur-qr-facture';
import { construirePdfPourTest } from './test-fixtures';

const DONNEES: DonneesQrFacture = {
  ibanCreancier: 'CH93 0076 2011 6238 5295 7',
  creancier: {
    nom: 'Garage Martin Sàrl',
    rue: 'Rue de la Gare',
    numero: '12',
    npa: '1000',
    localite: 'Lausanne',
    pays: 'CH',
  },
  montantCentimes: 15000,
  devise: 'CHF',
  debiteur: null,
  reference: null,
  messageNonStructure: 'Facture 2026-00042',
};

// PRÉCHAUFFAGE (à la collecte du fichier, PAS chronométré par `testTimeout`) : le premier appel
// du process à `decoderQrFacturePdf` paie un coût fixe d'environ 1 à 2 s — chargement du module
// ESM `pdfjs-dist` via `require(esm)`, première init interne de son moteur de documents, premier
// appel à `jsQR` sur une vraie image, premier passage dans le décodage du payload SPC — mesuré en
// isolant chaque étape (voir rapport de livraison). Ce n'est PAS du travail redondant dans le
// test lui-même (un deuxième appel, PDF différent, tombe à ~150-250ms) : c'est un coût de
// démarrage de bibliothèque payé une fois par process, qui atterrissait par hasard sur le premier
// `it()` chronométré et pouvait, sous charge CI, dépasser les 5000ms sans rapport avec ce que ce
// test vérifie. On rejoue ici la MÊME chaîne réelle que le test qui suit (mêmes données, PDF
// distinct) pour que le JIT et les caches de modules soient déjà chauds au moment où le test
// chronométré démarre — le test qui suit mesure la chaîne déjà chaude, mêmes assertions.
// `try/catch` uniquement pour rendre l'échec lisible : un top-level await qui rejette fait tomber
// TOUTE la collecte du fichier (les 3 `it()` ci-dessous, jamais exécutés) avec un message Vitest
// générique de collecte. En cas de régression réelle dans la chaîne, ce message pointe
// explicitement vers le préchauffage plutôt que de laisser croire qu'un des tests a échoué.
describe('decoderQrFacturePdf — chaîne complète PDF -> image -> jsQR -> payload SPC', () => {
  beforeAll(async () => {
    try {
      await decoderQrFacturePdf(
        await construirePdfPourTest({ payloadQr: encoderChargeUtileQr(DONNEES).payload }),
      );
    } catch (cause) {
      throw new Error(
        'Préchauffage de decoderQrFacturePdf (hors test, dans beforeAll) en échec — ' +
          "aucun des `it()` de ce fichier n'a encore tourné, voir la cause enchaînée.",
        { cause },
      );
    }
  }, 60_000);
  // Le préchauffage ci-dessus (hors chronomètre) ramène ce test à ~600ms au repos, mais sous
  // forte contention CI (mesuré ailleurs sur ce dépôt : un fichier de test à 84s au lieu de
  // quelques secondes, ressources partagées avec d'autres processus) une chaîne « chaude » peut
  // quand même dépasser les 5000ms par défaut sans qu'aucune régression réelle ne soit en cause
  // — délai généreux pour ce test précis uniquement, pas un affaiblissement de ce qu'il vérifie.
  it('décode un vrai Swiss QR Code embarqué dans un vrai PDF (round-trip complet)', async () => {
    const { payload } = encoderChargeUtileQr(DONNEES);
    const pdf = await construirePdfPourTest({
      lignesTexte: ['Facture fournisseur.'],
      payloadQr: payload,
    });

    const resultat = await decoderQrFacturePdf(pdf);

    expect(resultat.enTete).not.toBeNull();
    expect(resultat.enTete?.ibanCreancier?.valeur).toBe('CH9300762011623852957');
    expect(resultat.enTete?.montantTotalCentimes?.valeur).toBe(15000);
    expect(resultat.diagnostics).toEqual([]);
  }, 30_000);

  it('PDF sans image -> null avec diagnostic, jamais une exception', async () => {
    const pdf = await construirePdfPourTest({ lignesTexte: ['Aucun QR ici.'] });
    const resultat = await decoderQrFacturePdf(pdf);
    expect(resultat.enTete).toBeNull();
    expect(resultat.diagnostics[0]).toContain('aucune image');
  });

  it('image présente mais pas un Swiss QR Code -> null, jamais une valeur devinée', async () => {
    const pdf = await construirePdfPourTest({ payloadQr: 'https://example.com/pas-une-facture' });
    const resultat = await decoderQrFacturePdf(pdf);
    expect(resultat.enTete).toBeNull();
  });
});
