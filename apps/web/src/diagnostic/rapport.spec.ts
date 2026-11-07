import { describe, expect, it } from 'vitest';

import {
  construireSignalement,
  construireUrl,
  decoderBase64Url,
  encoderBase64Url,
  rapportMarkdown,
  reduirePourUrl,
  type Diagnostic,
} from './rapport';

const BASE = 'https://dmsforall.selfhostr.io/signaler';

function diagnostic(nbErreurs: number, taillePile: number): Diagnostic {
  return {
    version: '0.2.0',
    navigateur: 'Firefox 140 / Linux',
    ecran: '1440x900',
    langue: 'fr',
    route: '/atelier/or/:id',
    modules: ['atelier'],
    nbSites: 2,
    erreurs: Array.from({ length: nbErreurs }, (_, i) => ({
      message: `Erreur ${i}`,
      pile: 'x'.repeat(taillePile),
      quand: '2026-11-07T10:00:00.000Z',
    })),
    appelsEchec: [],
  };
}

const SAISIE = { constat: 'Le bouton ne fait rien', etapes: '', attendu: '' };

describe('base64url', () => {
  it('aller-retour exact avec accents et émojis, sans + / =', () => {
    const texte = 'Écran « OR » à Genève ✓ 😀 ???>>>';
    const encode = encoderBase64Url(texte);
    expect(encode).not.toMatch(/[+/=]/);
    expect(decoderBase64Url(encode)).toBe(texte);
  });
});

describe('construireSignalement', () => {
  it('nettoie les textes de l’utilisateur et fixe v et source', () => {
    const s = construireSignalement(
      { constat: ' Client a@b.ch, VS 12345 ', etapes: 'CHF 10', attendu: 'ok' },
      null,
    );
    expect(s).toEqual({
      v: 1,
      source: 'app',
      constat: 'Client [masqué], [masqué]',
      etapes: '[masqué]',
      attendu: 'ok',
      diagnostic: null,
    });
  });

  it('borne constat, étapes et attendu', () => {
    const s = construireSignalement(
      { constat: 'a'.repeat(9000), etapes: 'b'.repeat(9000), attendu: 'c'.repeat(9000) },
      null,
    );
    expect([s.constat.length, s.etapes.length, s.attendu.length]).toEqual([4000, 4000, 2000]);
  });
});

describe('reduirePourUrl', () => {
  it('ne touche à rien quand l’URL tient', () => {
    const s = construireSignalement(SAISIE, diagnostic(3, 100));
    const r = reduirePourUrl(s, BASE);
    expect(r.signalement).toBe(s);
    expect(r.url).toBe(construireUrl(s, BASE));
    expect(r.url.startsWith(`${BASE}#r=`)).toBe(true);
  });

  it('raccourcit d’abord les piles, en gardant toutes les erreurs', () => {
    const s = construireSignalement(SAISIE, diagnostic(20, 2000));
    expect(construireUrl(s, BASE).length).toBeGreaterThan(16_000);
    const r = reduirePourUrl(s, BASE);
    expect(r.url.length).toBeLessThanOrEqual(16_000);
    expect(r.signalement.diagnostic?.erreurs).toHaveLength(20);
    expect(r.signalement.diagnostic?.erreurs[0]?.pile).toHaveLength(500);
  });

  it('retire ensuite les erreurs les plus anciennes', () => {
    const s = construireSignalement(SAISIE, diagnostic(20, 2000));
    const r = reduirePourUrl(s, BASE, 1500);
    const erreurs = r.signalement.diagnostic?.erreurs ?? [];
    expect(r.url.length).toBeLessThanOrEqual(1500);
    expect(erreurs.length).toBeLessThan(20);
    expect(erreurs.length).toBeGreaterThan(0);
    expect(erreurs.at(-1)?.message).toBe('Erreur 19');
    expect(erreurs[0]?.pile).toBe('');
  });

  it('en dernier recours, retire le diagnostic', () => {
    const s = construireSignalement(SAISIE, diagnostic(2, 10));
    expect(reduirePourUrl(s, BASE, 100).signalement.diagnostic).toBeNull();
  });
});

describe('rapportMarkdown', () => {
  const titres = {
    constat: 'Constat',
    etapes: 'Étapes',
    attendu: 'Attendu',
    diagnostic: 'Diagnostic',
    aucun: '(rien)',
  };

  it('rend les sections, « (rien) » pour une section vide, et le JSON du diagnostic', () => {
    const md = rapportMarkdown(construireSignalement(SAISIE, diagnostic(0, 0)), titres);
    expect(md).toContain('### Constat\n\nLe bouton ne fait rien\n');
    expect(md).toContain('### Étapes\n\n(rien)\n');
    expect(md).toContain('```json\n{');
    expect(md).toContain('"route": "/atelier/or/:id"');
  });

  it('sans diagnostic : pas de bloc JSON', () => {
    const md = rapportMarkdown(construireSignalement(SAISIE, null), titres);
    expect(md).not.toContain('```json');
    expect(md).toContain('### Diagnostic\n\n(rien)');
  });
});
