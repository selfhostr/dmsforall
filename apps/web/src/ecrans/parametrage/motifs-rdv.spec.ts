import { describe, expect, it } from 'vitest';

import {
  centiemesVersHeures,
  codeDepuisLibelle,
  construireCreation,
  construireModification,
  type SaisieMotifRendezVous,
} from './motifs-rdv';

const SAISIE: SaisieMotifRendezVous = {
  libelleFr: 'Expertise MFK',
  libelleDe: '',
  libelleIt: ' Collaudo MFK ',
  dureeMinutes: '45',
  heuresAtelier: '',
};

describe('codeDepuisLibelle', () => {
  it('majuscules sans accents, tirets', () => {
    expect(codeDepuisLibelle('Révision été / pneus')).toBe('REVISION-ETE-PNEUS');
  });
  it('plafonné à 40 caractères sans tiret final', () => {
    const code = codeDepuisLibelle('a'.repeat(39) + ' b');
    expect(code.length).toBeLessThanOrEqual(40);
    expect(code.endsWith('-')).toBe(false);
  });
  it('libellé sans caractère exploitable : vide', () => {
    expect(codeDepuisLibelle('€€€')).toBe('');
  });
});

describe('construireCreation', () => {
  it('convertit la saisie : code dérivé, traductions vides en null, minutes en nombre', () => {
    expect(construireCreation(SAISIE)).toEqual({
      ok: true,
      entree: {
        code: 'EXPERTISE-MFK',
        libelleFr: 'Expertise MFK',
        libelleDe: null,
        libelleIt: 'Collaudo MFK',
        dureeDefautMinutes: 45,
        heuresAtelierDefautCentiemes: null,
      },
    });
  });
  it('heures décimales avec virgule en centièmes exacts', () => {
    const r = construireCreation({ ...SAISIE, dureeMinutes: '', heuresAtelier: '1,5' });
    expect(r.ok && r.entree.heuresAtelierDefautCentiemes).toBe(150);
  });
  it('libellé vide : erreur sur le libellé', () => {
    expect(construireCreation({ ...SAISIE, libelleFr: ' ' })).toEqual({
      ok: false,
      champ: 'libelleFr',
    });
  });
  it('durée non entière : erreur sur la durée', () => {
    expect(construireCreation({ ...SAISIE, dureeMinutes: '1.5' })).toEqual({
      ok: false,
      champ: 'dureeMinutes',
    });
  });
  it('durée hors bornes (0, 1441) : refusée par le contrat partagé', () => {
    expect(construireCreation({ ...SAISIE, dureeMinutes: '0' }).ok).toBe(false);
    expect(construireCreation({ ...SAISIE, dureeMinutes: '1441' })).toEqual({
      ok: false,
      champ: 'dureeMinutes',
    });
  });
  it('heures mal écrites : erreur sur les heures', () => {
    expect(construireCreation({ ...SAISIE, heuresAtelier: 'une heure' })).toEqual({
      ok: false,
      champ: 'heuresAtelier',
    });
  });
});

describe('construireModification', () => {
  it('ne contient jamais le code (immuable)', () => {
    const r = construireModification(SAISIE);
    expect(r.ok && 'code' in r.entree).toBe(false);
  });
});

describe('centiemesVersHeures', () => {
  it('aller-retour', () => {
    expect(centiemesVersHeures(150)).toBe('1.5');
    expect(centiemesVersHeures(null)).toBe('');
  });
});
