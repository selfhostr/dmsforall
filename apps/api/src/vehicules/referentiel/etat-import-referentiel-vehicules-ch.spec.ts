import { describe, expect, it } from 'vitest';

import { construireMiseAJourEtatImport } from './etat-import-referentiel-vehicules-ch';

const MAINTENANT = new Date('2026-08-17T04:17:00.000Z');

describe('construireMiseAJourEtatImport — cohérence avec migration 0057', () => {
  it('succes : avance signature/nombre de lignes/date d’import, motif à null', () => {
    expect(
      construireMiseAJourEtatImport(
        { issue: 'succes', signatureSource: 'sig-1', nombreLignes: 227_414 },
        MAINTENANT,
      ),
    ).toEqual({
      derniereVerificationLe: MAINTENANT,
      derniereIssue: 'succes',
      dernierMotifEchec: null,
      dernierImportReussiLe: MAINTENANT,
      dernierNombreLignes: 227_414,
      signatureSource: 'sig-1',
    });
  });

  it('inchange : avance SEULEMENT la date de vérification, ne touche PAS à dernierImportReussiLe/dernierNombreLignes/signatureSource', () => {
    const resultat = construireMiseAJourEtatImport(
      { issue: 'inchange', signatureSource: 'sig-1' },
      MAINTENANT,
    );
    expect(resultat).toEqual({
      derniereVerificationLe: MAINTENANT,
      derniereIssue: 'inchange',
      dernierMotifEchec: null,
    });
    expect(resultat).not.toHaveProperty('dernierImportReussiLe');
    expect(resultat).not.toHaveProperty('dernierNombreLignes');
    expect(resultat).not.toHaveProperty('signatureSource');
  });

  it("echec : avance SEULEMENT la date de vérification + le motif, ne touche à RIEN d'autre (piège évité : signature qui avancerait sur un import jamais appliqué)", () => {
    const resultat = construireMiseAJourEtatImport(
      { issue: 'echec', motif: 'HTTP 503' },
      MAINTENANT,
    );
    expect(resultat).toEqual({
      derniereVerificationLe: MAINTENANT,
      derniereIssue: 'echec',
      dernierMotifEchec: 'HTTP 503',
    });
    expect(resultat).not.toHaveProperty('signatureSource');
    expect(resultat).not.toHaveProperty('dernierImportReussiLe');
  });

  it('echec : dernierMotifEchec toujours non-null, jamais vide (contrainte 0057 : cohérence issue/motif)', () => {
    const resultat = construireMiseAJourEtatImport({ issue: 'echec', motif: 'x' }, MAINTENANT);
    expect(resultat.dernierMotifEchec).not.toBeNull();
  });

  it('succes/inchange : dernierMotifEchec toujours null (contrainte 0057 : cohérence issue/motif)', () => {
    expect(
      construireMiseAJourEtatImport(
        { issue: 'succes', signatureSource: 's', nombreLignes: 1 },
        MAINTENANT,
      ).dernierMotifEchec,
    ).toBeNull();
    expect(
      construireMiseAJourEtatImport({ issue: 'inchange', signatureSource: 's' }, MAINTENANT)
        .dernierMotifEchec,
    ).toBeNull();
  });
});
