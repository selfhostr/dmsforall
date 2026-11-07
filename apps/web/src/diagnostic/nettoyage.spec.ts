import { describe, expect, it } from 'vitest';

import { masquer, nettoyerPile, LONGUEUR_MAX_PILE } from './nettoyage';

const M = '[masqué]';

describe('masquer — ce qui doit disparaître', () => {
  it.each([
    ['écrire à jean.dupont@garage-martin.ch', `écrire à ${M}`],
    ['id 3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f ok', `id ${M} ok`],
    ['tél +41 79 123 45 67 fin', `tél ${M} fin`],
    ['tél 0041 79 123 45 67 fin', `tél ${M} fin`],
    ['tél +49 30 123456 fin', `tél ${M} fin`],
    ['tél 079 123 45 67 fin', `tél ${M} fin`],
    ['tél 021/123.45.67 fin', `tél ${M} fin`],
    ['tél 0791234567 fin', `tél ${M} fin`],
    ['IBAN CH93 0076 2011 6238 5295 7 ok', `IBAN ${M} ok`],
    ['IBAN CH9300762011623852957 ok', `IBAN ${M} ok`],
    ['IBAN LI21 0881 0000 2324 013A A ok', `IBAN ${M} ok`],
    ['plaque VS 12345 ok', `plaque ${M} ok`],
    ['plaque GE123456 ok', `plaque ${M} ok`],
    ['plaque ZH 1 ok', `plaque ${M} ok`],
    ['AVS 756.1234.5678.97 ok', `AVS ${M} ok`],
    ['AVS 7561234567897 ok', `AVS ${M} ok`],
    ["total CHF 1'234.50 ok", `total ${M} ok`],
    ['total CHF 99 ok', `total ${M} ok`],
    ["total 1'234.50 CHF ok", `total ${M} ok`],
    ['total 1’234’567.5 ok', `total ${M} ok`],
  ])('%s', (entree, attendu) => {
    expect(masquer(entree)).toBe(attendu);
  });

  it('masque plusieurs motifs dans le même texte', () => {
    expect(masquer('VS 12345 / a@b.ch / CHF 10.-')).toBe(`${M} / ${M} / ${M}.-`);
  });

  it('retire la query string et le fragment des URL', () => {
    expect(masquer('GET https://x.ch/api/clients?nom=Dupont#a échoué')).toBe(
      'GET https://x.ch/api/clients échoué',
    );
  });
});

describe('masquer — ce qui doit rester', () => {
  it.each([
    'Firefox 140 / Linux',
    'Cannot read properties of undefined (reading "id")',
    'at f (http://localhost:5173/assets/index-GE12345.js:12:3456)',
    'at g (http://localhost:5173/src/ecrans/Ecran.tsx:120:15)',
    'version 0.2.0',
    'ligne 1234 colonne 56',
    'GET /api/v1/clients 409',
    '2026-11-07T10:15:30.123Z',
    'AGE 12 ans',
    'BERNE 2024',
    'le 07.11.2026 à 10:15',
    '12 pièces à 3.50',
  ])('%s', (texte) => {
    expect(masquer(texte)).toBe(texte);
  });
});

describe('nettoyerPile', () => {
  it('garde fichiers et lignes, retire la query du fichier', () => {
    const pile = 'Error: boom\n    at a (https://x.ch/assets/app-abc.js?v=2:10:5)';
    expect(nettoyerPile(pile)).toBe('Error: boom\n    at a (https://x.ch/assets/app-abc.js:10:5)');
  });

  it('coupe à 2000 caractères', () => {
    expect(nettoyerPile('x'.repeat(5000))).toHaveLength(LONGUEUR_MAX_PILE);
  });

  it('une limite nulle vide la pile', () => {
    expect(nettoyerPile('abc', 0)).toBe('');
  });
});
