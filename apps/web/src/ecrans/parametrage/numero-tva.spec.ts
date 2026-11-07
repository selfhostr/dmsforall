import { describe, expect, it } from 'vitest';

import { validerNumeroTva } from './numero-tva';

describe('validerNumeroTva', () => {
  it('vide : accepté, envoyé comme null (non assujetti)', () => {
    expect(validerNumeroTva('  ')).toEqual({ ok: true, valeur: null });
  });
  it('numéro valide, saisi en minuscules : normalisé', () => {
    expect(validerNumeroTva('che-116.281.710 tva')).toEqual({
      ok: true,
      valeur: 'CHE-116.281.710 TVA',
    });
  });
  it('mauvaise forme', () => {
    expect(validerNumeroTva('CHE-116281710')).toEqual({ ok: false, raison: 'format' });
  });
  it('bonne forme, clé de contrôle fausse', () => {
    expect(validerNumeroTva('CHE-116.281.711 TVA')).toEqual({ ok: false, raison: 'cle' });
  });
});
