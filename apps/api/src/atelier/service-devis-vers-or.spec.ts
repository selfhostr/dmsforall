import { describe, expect, it } from 'vitest';

import { convertirLigneDevisEnLigneOr, deriverCleIdempotenceOr } from './service-devis-vers-or';
import { phraseAccordClient } from './accord-client';
import { determinerPlafondDevis } from './service-devis';
import { phraseTransitionInterdite } from './traducteur-transition';

const base = {
  designation: 'Plaquettes avant',
  referenceTexte: null,
  quantiteMillieme: 2000,
  tauxTvaPourmille: 81,
  htCentimes: 18500,
  tvaCentimes: 1499,
  ttcCentimes: 19999,
};

describe('convertirLigneDevisEnLigneOr', () => {
  it('recopie HT/TVA/TTC à l’identique et dérive le net unitaire', () => {
    const l = convertirLigneDevisEnLigneOr({ ...base, typeLigne: 'piece' });
    expect(l).toMatchObject({
      type: 'piece',
      prixUnitaireCentimes: 9250,
      tempsBaremeCentiemes: null,
      tauxHoraireCentimes: null,
      montantHtCentimes: 18500,
      montantTvaCentimes: 1499,
      montantTtcCentimes: 19999,
    });
  });
  it('main-d’œuvre : temps en centièmes d’heure et taux horaire net', () => {
    const l = convertirLigneDevisEnLigneOr({
      ...base,
      typeLigne: 'main_oeuvre_bareme',
      quantiteMillieme: 1500,
      htCentimes: 15000,
    });
    expect(l).toMatchObject({
      tempsBaremeCentiemes: 150,
      tauxHoraireCentimes: 10000,
      prixUnitaireCentimes: null,
    });
  });
  it('ligne de texte : aucun prix', () => {
    const l = convertirLigneDevisEnLigneOr({
      ...base,
      typeLigne: 'texte',
      htCentimes: 0,
      tvaCentimes: 0,
      ttcCentimes: 0,
    });
    expect(l.prixUnitaireCentimes).toBeNull();
  });
  it('refuse un type sans équivalent d’OR avec CONFLIT', () => {
    expect(() => convertirLigneDevisEnLigneOr({ ...base, typeLigne: 'acompte_deduit' })).toThrow(
      expect.objectContaining({ code: 'CONFLIT' }),
    );
  });
});

describe('deriverCleIdempotenceOr', () => {
  it('est stable, différente de l’entrée et un uuid v4', () => {
    const k = '3f2b8c1e-5d7a-4e9b-8a6c-1d2e3f4a5b6c';
    const d = deriverCleIdempotenceOr(k);
    expect(d).toBe(deriverCleIdempotenceOr(k));
    expect(d).not.toBe(k);
    expect(d).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('phraseAccordClient', () => {
  it('nom, canal, heure suisse et commentaire', () => {
    expect(
      phraseAccordClient({
        nom: 'Mme Perret',
        canal: 'telephone',
        horodate: '2026-11-07T09:15:00.000Z',
        commentaire: 'OK pour les freins.',
      }),
    ).toBe('Accord du client : Mme Perret (téléphone), le 07.11.2026 à 10:15. OK pour les freins.');
  });
  it('sans horodate, pas de date', () => {
    expect(phraseAccordClient({ nom: 'M. Roux', canal: 'comptoir' })).toBe(
      'Accord du client : M. Roux (au comptoir).',
    );
  });
});

describe('determinerPlafondDevis', () => {
  it('valeur fournie prioritaire', () =>
    expect(determinerPlafondDevis(5000, 100, 0, 0)).toBe(5000));
  it('OR sans plafond : null', () =>
    expect(determinerPlafondDevis(undefined, null, 10, 10)).toBeNull());
  it('plafond suffisant : inchangé', () =>
    expect(determinerPlafondDevis(undefined, 10000, 4000, 3000)).toBe(10000));
  it('plafond insuffisant : relevé au strict nécessaire', () =>
    expect(determinerPlafondDevis(undefined, 10000, 8000, 3000)).toBe(11000));
});

describe('phraseTransitionInterdite', () => {
  it('phrase de garagiste, étapes possibles', () => {
    expect(phraseTransitionInterdite('ordre_reparation', 'controle', 'termine', ['en_cours'])).toBe(
      "L'OR est « En contrôle » : il ne peut pas passer à « Terminé ». Étape possible : « En cours ».",
    );
  });
  it('état terminal', () => {
    expect(phraseTransitionInterdite('ligne_or', 'facturee', 'annulee', 'terminal')).toContain(
      'définitive',
    );
  });
});
