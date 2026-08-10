import { describe, expect, it } from 'vitest';

import { neGarderQueChampsEnvoyes } from './champs-envoyes';

describe('neGarderQueChampsEnvoyes', () => {
  it('retire une clé absente du corps brut mais injectée par un `.default(...)` zod', () => {
    // Simule `schemaModificationAdresseClient.parse({ localite: 'Linz-Zentrum' })` : `pays`
    // n'a jamais été envoyé mais ressort du parse avec son défaut `'CH'`.
    const corpsBrut = { localite: 'Linz-Zentrum' };
    const entreeParsee = { localite: 'Linz-Zentrum', pays: 'CH' };

    const resultat = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);

    expect(resultat).toStrictEqual({ localite: 'Linz-Zentrum' });
    expect('pays' in resultat).toBe(false);
  });

  it('conserve une clé envoyée avec une valeur falsy (0, false, chaîne vide) — piège symétrique', () => {
    // Une valeur falsy explicitement envoyée est une donnée métier, pas une absence : le test
    // doit porter sur la présence de la clé (`in`), jamais sur sa véracité.
    const corpsBrut = { quantite: 0, actif: false, note: '' };
    const entreeParsee = { quantite: 0, actif: false, note: '' };

    const resultat = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);

    expect(resultat).toStrictEqual({ quantite: 0, actif: false, note: '' });
  });

  it('rend un résultat vide quand le corps brut ne porte que des clés inconnues du schéma', () => {
    // zod retire silencieusement les clés inconnues au parse : `entreeParsee` peut être vide
    // (ou ne porter que des défauts) même si `corpsBrut` ne l'était pas.
    const corpsBrut = { champInconnu: 'valeur' };
    const entreeParsee = { pays: 'CH' };

    const resultat = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);

    expect(resultat).toStrictEqual({});
  });

  it('conserve plusieurs clés réellement envoyées, y compris mélangées à des défauts injectés', () => {
    const corpsBrut = { npa: '1010', localite: 'Wien' };
    const entreeParsee = { npa: '1010', localite: 'Wien', pays: 'CH' };

    const resultat = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);

    expect(resultat).toStrictEqual({ npa: '1010', localite: 'Wien' });
  });
});
