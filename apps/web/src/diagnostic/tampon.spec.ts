import { beforeEach, describe, expect, it } from 'vitest';

import {
  enregistrerAppelEchoue,
  enregistrerErreur,
  lireAppelsEchoues,
  lireErreurs,
  MAX_APPELS,
  MAX_ERREURS,
  viderTampon,
} from './tampon';

const T = new Date('2026-11-07T10:00:00.000Z');

beforeEach(viderTampon);

describe('tampon des erreurs', () => {
  it('nettoie le message et la pile, et date l’entrée', () => {
    const e = new Error('échec pour a@b.ch');
    e.stack = 'Error: échec pour a@b.ch\n    at f (https://x.ch/a.js:1:2)';
    enregistrerErreur(e, T);
    expect(lireErreurs()).toEqual([
      {
        message: 'Error: échec pour [masqué]',
        pile: 'Error: échec pour [masqué]\n    at f (https://x.ch/a.js:1:2)',
        quand: '2026-11-07T10:00:00.000Z',
      },
    ]);
  });

  it('accepte une valeur levée qui n’est pas une Error', () => {
    enregistrerErreur('VS 12345', T);
    expect(lireErreurs()[0]).toMatchObject({ message: '[masqué]', pile: '' });
  });

  it('garde seulement les 20 dernières', () => {
    for (let i = 0; i < 25; i++) enregistrerErreur(new Error(`e${i}x`), T);
    const messages = lireErreurs().map((e) => e.message);
    expect(messages).toHaveLength(MAX_ERREURS);
    expect(messages[0]).toBe('Error: e5x');
    expect(messages[19]).toBe('Error: e24x');
  });
});

describe('tampon des appels', () => {
  it('ne garde que méthode, gabarit, statut, code, id de requête et heure', () => {
    enregistrerAppelEchoue(
      {
        methode: 'post',
        url: 'https://g.ch/api/documents-vente/3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f/emettre?plaque=VS12345',
        statut: 409,
        code: 'TVA_NUMERO_REQUIS',
        requestId: 'req-1',
      },
      T,
    );
    expect(lireAppelsEchoues()).toEqual([
      {
        methode: 'POST',
        route: '/api/documents-vente/:id/emettre',
        statut: 409,
        code: 'TVA_NUMERO_REQUIS',
        requestId: 'req-1',
        quand: '2026-11-07T10:00:00.000Z',
      },
    ]);
  });

  it('omet code et id de requête absents', () => {
    enregistrerAppelEchoue({ methode: 'GET', url: '/api/clients', statut: 0, code: null }, T);
    expect(Object.keys(lireAppelsEchoues()[0] ?? {}).sort()).toEqual([
      'methode',
      'quand',
      'route',
      'statut',
    ]);
  });

  it('garde seulement les 10 derniers', () => {
    for (let i = 0; i < 13; i++) {
      enregistrerAppelEchoue({ methode: 'GET', url: '/api/x', statut: 500 + i }, T);
    }
    const statuts = lireAppelsEchoues().map((a) => a.statut);
    expect(statuts).toHaveLength(MAX_APPELS);
    expect(statuts[0]).toBe(503);
    expect(statuts[9]).toBe(512);
  });
});
