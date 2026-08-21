import { beforeAll, describe, expect, it, vi } from 'vitest';

import { encoderChargeUtileQr, type DonneesQrFacture } from '../../../facturation/qr';

import { ServiceOrchestrateurLectureFacture } from './orchestrateur-lecture';
import { ErreurOcrTexteFacture, type PortOcrTexteFacture } from './port-ocr-texte';
import { construirePdfPourTest, construirePdfVidePourTest } from './test-fixtures';

const DONNEES_QR: DonneesQrFacture = {
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
  messageNonStructure: null,
};

function ocrJamaisAppele(): PortOcrTexteFacture {
  return { reconnaitre: vi.fn().mockRejectedValue(new Error('ne doit jamais être appelé')) };
}

// PRÉCHAUFFAGE (à la collecte du fichier, PAS chronométré par `testTimeout`) : `service.lire()`
// enchaîne le décodage QR (`pdfjs-dist` + `jsQR`, chargement ESM synchrone via `require(esm)` +
// première init interne) PUIS l'extraction de texte (`pdfjs-dist` à nouveau, chemin différent) —
// le premier appel du process à cette chaîne paie un coût fixe d'environ 1 à 2 s, mesuré en
// isolant chaque étape (voir rapport de livraison). Un deuxième appel, PDF différent, retombe à
// ~150-250ms : ce n'est pas du travail redondant dans le test lui-même, c'est un coût de démarrage
// de bibliothèque payé une fois par process, qui atterrissait par hasard sur le premier `it()`
// chronométré et pouvait, sous charge CI, dépasser les 5000ms sans rapport avec ce que ce test
// vérifie. On rejoue ici la MÊME chaîne réelle (QR + texte) que le premier test qui suit pour que
// le JIT et les caches de modules soient déjà chauds au moment où le test chronométré démarre.
// `try/catch` uniquement pour rendre l'échec lisible : un top-level await qui rejette fait tomber
// TOUTE la collecte du fichier (les 4 `it()` ci-dessous, jamais exécutés) avec un message Vitest
// générique de collecte. En cas de régression réelle dans la chaîne, ce message pointe
// explicitement vers le préchauffage plutôt que de laisser croire qu'un des tests a échoué.
describe('ServiceOrchestrateurLectureFacture', () => {
  beforeAll(async () => {
    try {
      await new ServiceOrchestrateurLectureFacture(ocrJamaisAppele()).lire(
        await construirePdfPourTest({
          lignesTexte: ['PRECHAUFFAGE_HORS_TEST_NE_PAS_ASSERTER'],
          payloadQr: encoderChargeUtileQr(DONNEES_QR).payload,
        }),
      );
    } catch (cause) {
      throw new Error(
        'Préchauffage de ServiceOrchestrateurLectureFacture.lire (hors test, dans beforeAll) ' +
          "en échec — aucun des `it()` de ce fichier n'a encore tourné, voir la cause enchaînée.",
        { cause },
      );
    }
  }, 60_000);
  // Le préchauffage ci-dessus (hors chronomètre) ramène ce test à ~600ms au repos, mais sous
  // forte contention CI (mesuré ailleurs sur ce dépôt : un fichier de test à 84s au lieu de
  // quelques secondes, ressources partagées avec d'autres processus) une chaîne « chaude » peut
  // quand même dépasser les 5000ms par défaut sans qu'aucune régression réelle ne soit en cause
  // — délai généreux pour ce test précis uniquement, pas un affaiblissement de ce qu'il vérifie.
  it('texte présent : QR + lignes extraites du texte, OCR jamais sollicité', async () => {
    const { payload } = encoderChargeUtileQr(DONNEES_QR);
    const pdf = await construirePdfPourTest({
      lignesTexte: ['ABC-123 Filtre à huile 4 12.50 50.00'],
      payloadQr: payload,
    });
    const ocr = ocrJamaisAppele();
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);

    expect(resultat.enTete.ibanCreancier?.origine).toBe('qr');
    expect(resultat.lignes).toHaveLength(1);
    expect(resultat.lignes[0]?.origine).toBe('texte_pdf');
    expect(ocr.reconnaitre).not.toHaveBeenCalled();
  }, 30_000);

  it('aucun texte : repli OCR sollicité, ses lignes portent origine "ocr"', async () => {
    const pdf = await construirePdfVidePourTest();
    const ocr: PortOcrTexteFacture = {
      reconnaitre: vi.fn().mockResolvedValue({
        texte: 'XYZ-9 Joint de culasse 1 30.00 30.00',
        confiance: 72,
        dureeMs: 500,
      }),
    };
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);

    expect(ocr.reconnaitre).toHaveBeenCalledOnce();
    expect(resultat.lignes).toHaveLength(1);
    expect(resultat.lignes[0]?.origine).toBe('ocr');
  });

  it('OCR non configuré (dernier recours indisponible) : diagnostic, jamais une exception qui casse le dépôt', async () => {
    const pdf = await construirePdfVidePourTest();
    const ocr: PortOcrTexteFacture = {
      reconnaitre: vi
        .fn()
        .mockRejectedValue(new ErreurOcrTexteFacture('MOTEUR_NON_CONFIGURE', 'non configuré')),
    };
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);

    expect(resultat.lignes).toEqual([]);
    expect(resultat.diagnostics.some((d) => d.includes('MOTEUR_NON_CONFIGURE'))).toBe(true);
  });

  it("le QR (certain) n'est jamais écrasé par une valeur ultérieure moins certaine", async () => {
    const { payload } = encoderChargeUtileQr(DONNEES_QR);
    const pdf = await construirePdfPourTest({
      lignesTexte: ['Rien qui ressemble à une ligne de facture.'],
      payloadQr: payload,
    });
    const ocr = ocrJamaisAppele();
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);
    expect(resultat.enTete.montantTotalCentimes).toEqual({ valeur: 15000, origine: 'qr' });
  });
});
