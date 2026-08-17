import { describe, expect, it, vi } from 'vitest';

import type { StatistiquesImportSource } from '../../db/seed/import-referentiel-vehicules-ch';

import {
  executerVerificationReferentielVehiculesCh,
  type CollaborateursJobReferentielVehiculesCh,
} from './job-mise-a-jour-referentiel-vehicules-ch';

const MAINTENANT = new Date('2026-08-17T04:17:00.000Z');
const URL_MIGRATION = 'postgres://migrateur/dfa';

function statistiques(upsertees: number): readonly StatistiquesImportSource[] {
  return [{ fichier: 'TAS_Automobil.csv', lues: upsertees, ignorees: 0, upsertees }];
}

function collaborateurs(
  overrides: Partial<CollaborateursJobReferentielVehiculesCh> = {},
): CollaborateursJobReferentielVehiculesCh {
  return {
    urlMigration: URL_MIGRATION,
    fetchImpl: vi.fn() as never,
    detecterSignature: vi.fn(async () => 'sig-actuelle'),
    chargerEtat: vi.fn(async () => ({ signatureSource: 'sig-actuelle' })),
    importer: vi.fn(async () => statistiques(100)),
    enregistrerEtat: vi.fn(async () => undefined),
    maintenant: () => MAINTENANT,
    journaliser: vi.fn(),
    ...overrides,
  };
}

describe('executerVerificationReferentielVehiculesCh — décision changé/inchangé/échec', () => {
  it('signature identique à l’état persisté -> inchange, AUCUN appel à importer (le point du chantier)', async () => {
    const importer = vi.fn(async () => statistiques(999));
    const enregistrerEtat = vi.fn(async () => undefined);
    const c = collaborateurs({
      detecterSignature: vi.fn(async () => 'meme-signature'),
      chargerEtat: vi.fn(async () => ({ signatureSource: 'meme-signature' })),
      importer,
      enregistrerEtat,
    });

    const resultat = await executerVerificationReferentielVehiculesCh(c);

    expect(resultat).toEqual({ issue: 'inchange', signatureSource: 'meme-signature' });
    expect(importer).not.toHaveBeenCalled();
    expect(enregistrerEtat).toHaveBeenCalledWith(
      URL_MIGRATION,
      { issue: 'inchange', signatureSource: 'meme-signature' },
      MAINTENANT,
    );
  });

  it('signature différente -> import complet déclenché, issue succes, nombre de lignes = somme des sources', async () => {
    const importer = vi.fn(async () => [
      { fichier: 'TAS_Automobil.csv', lues: 210, ignorees: 1, upsertees: 200 },
      { fichier: 'TAS_Motorrad.csv', lues: 11, ignorees: 0, upsertees: 11 },
    ]);
    const enregistrerEtat = vi.fn(async () => undefined);
    const c = collaborateurs({
      detecterSignature: vi.fn(async () => 'nouvelle-signature'),
      chargerEtat: vi.fn(async () => ({ signatureSource: 'ancienne-signature' })),
      importer,
      enregistrerEtat,
    });

    const resultat = await executerVerificationReferentielVehiculesCh(c);

    expect(resultat).toEqual({
      issue: 'succes',
      signatureSource: 'nouvelle-signature',
      nombreLignes: 211,
    });
    expect(importer).toHaveBeenCalledWith({ urlMigration: URL_MIGRATION });
    expect(enregistrerEtat).toHaveBeenCalledWith(
      URL_MIGRATION,
      { issue: 'succes', signatureSource: 'nouvelle-signature', nombreLignes: 211 },
      MAINTENANT,
    );
  });

  it('aucun import jamais réussi (signature persistée null) -> import complet déclenché', async () => {
    const importer = vi.fn(async () => statistiques(50));
    const c = collaborateurs({
      detecterSignature: vi.fn(async () => 'premiere-signature'),
      chargerEtat: vi.fn(async () => ({ signatureSource: null })),
      importer,
    });

    const resultat = await executerVerificationReferentielVehiculesCh(c);

    expect(resultat.issue).toBe('succes');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('contrôle de la source en échec (réseau/HTTP) -> echec, importer JAMAIS appelé, motif propagé', async () => {
    const importer = vi.fn(async () => statistiques(1));
    const enregistrerEtat = vi.fn(async () => undefined);
    const c = collaborateurs({
      detecterSignature: vi.fn(async () => {
        throw new Error('HTTP 503');
      }),
      importer,
      enregistrerEtat,
    });

    const resultat = await executerVerificationReferentielVehiculesCh(c);

    expect(resultat).toEqual({ issue: 'echec', motif: 'HTTP 503' });
    expect(importer).not.toHaveBeenCalled();
    expect(enregistrerEtat).toHaveBeenCalledWith(
      URL_MIGRATION,
      { issue: 'echec', motif: 'HTTP 503' },
      MAINTENANT,
    );
  });

  it('import en échec APRÈS un contrôle réussi -> echec, signature JAMAIS avancée (piège évité explicitement)', async () => {
    const enregistrerEtat = vi.fn(async () => undefined);
    const c = collaborateurs({
      detecterSignature: vi.fn(async () => 'nouvelle-signature'),
      chargerEtat: vi.fn(async () => ({ signatureSource: 'ancienne-signature' })),
      importer: vi.fn(async () => {
        throw new Error('CSV tronqué : colonne manquante');
      }),
      enregistrerEtat,
    });

    const resultat = await executerVerificationReferentielVehiculesCh(c);

    expect(resultat).toEqual({ issue: 'echec', motif: 'CSV tronqué : colonne manquante' });
    // Jamais 'succes', et surtout jamais la nouvelle signature enregistrée comme si l'import
    // avait réellement été appliqué — sinon le prochain passage conclurait `inchange` à tort.
    expect(enregistrerEtat).toHaveBeenCalledWith(
      URL_MIGRATION,
      { issue: 'echec', motif: 'CSV tronqué : colonne manquante' },
      MAINTENANT,
    );
  });

  it('erreur non-Error (ex. valeur rejetée brute) -> motif construit sans planter', async () => {
    const c = collaborateurs({
      detecterSignature: vi.fn(async () => {
        // `throw` d'une chaîne brute (pas une `Error`) délibéré — voir `motifErreur()` dans le
        // fichier testé, qui doit rester robuste à un rejet non standard, pas seulement à une
        // vraie `Error`. Aucune règle de lint de ce dépôt n'interdit `throw` non-`Error` (vérifié
        // dans `eslint.config.mjs` avant d'écrire ce commentaire : ni `no-throw-literal` ni
        // `@typescript-eslint/only-throw-error` n'y figurent) — donc aucune directive à poser.
        throw 'chaîne brute';
      }),
    });

    const resultat = await executerVerificationReferentielVehiculesCh(c);
    expect(resultat).toEqual({ issue: 'echec', motif: 'chaîne brute' });
  });

  it('ne lève JAMAIS pour une erreur de contrôle/import — toujours un résultat, jamais une exception qui remonte', async () => {
    const c = collaborateurs({
      detecterSignature: vi.fn(async () => {
        throw new Error('panne réseau');
      }),
    });
    await expect(executerVerificationReferentielVehiculesCh(c)).resolves.toMatchObject({
      issue: 'echec',
    });
  });
});
