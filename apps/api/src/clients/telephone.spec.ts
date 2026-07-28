import { describe, expect, it } from 'vitest';
import { normaliserTelephoneCh } from './telephone';

/**
 * `normaliserTelephoneCh` alimente la détection de doublons (RM-05) et la recherche : une
 * normalisation qui accepte à tort une forme invalide fabriquerait un faux rapprochement, une
 * normalisation trop stricte en manquerait un vrai. Les deux sens comptent.
 */
describe('normaliserTelephoneCh — formats suisses usuels vers E.164', () => {
  it('un numéro mobile national avec zéro initial devient +41', () => {
    expect(normaliserTelephoneCh('0791234567')).toBe('+41791234567');
  });

  it('un numéro national avec séparateurs (espaces) est normalisé', () => {
    expect(normaliserTelephoneCh('079 123 45 67')).toBe('+41791234567');
  });

  it('un numéro avec points et tirets comme séparateurs est normalisé', () => {
    expect(normaliserTelephoneCh('079.123-45.67')).toBe('+41791234567');
  });

  it('un numéro avec parenthèses est normalisé', () => {
    expect(normaliserTelephoneCh('(079) 123 45 67')).toBe('+41791234567');
  });

  it('un numéro déjà en E.164 passe tel quel', () => {
    expect(normaliserTelephoneCh('+41791234567')).toBe('+41791234567');
  });

  it('un numéro au format international 00 devient +', () => {
    expect(normaliserTelephoneCh('0041791234567')).toBe('+41791234567');
  });

  it('un numéro étranger déjà au format +<pays> est conservé sans réinterprétation suisse', () => {
    expect(normaliserTelephoneCh('+33612345678')).toBe('+33612345678');
  });
});

describe('normaliserTelephoneCh — entrées absentes ou vides', () => {
  it('null rend null', () => {
    expect(normaliserTelephoneCh(null)).toBeNull();
  });

  it('undefined rend null', () => {
    expect(normaliserTelephoneCh(undefined)).toBeNull();
  });

  it('une chaîne vide rend null', () => {
    expect(normaliserTelephoneCh('')).toBeNull();
  });

  it('une chaîne composée uniquement de séparateurs rend null', () => {
    expect(normaliserTelephoneCh('   ...--  ')).toBeNull();
  });
});

describe('normaliserTelephoneCh — refuse plutôt que deviner (RM-05 : un faux positif coûte plus cher)', () => {
  it('une forme sans +, ni 00, ni 0 initial est refusée', () => {
    expect(normaliserTelephoneCh('791234567')).toBeNull();
  });

  it('un texte non numérique est refusé', () => {
    expect(normaliserTelephoneCh('appeler le garage')).toBeNull();
  });

  it('un "0" seul (candidat trop court après conversion) est refusé', () => {
    expect(normaliserTelephoneCh('0')).toBeNull();
  });

  it('un "00" seul (candidat vide après le préfixe international) est refusé', () => {
    expect(normaliserTelephoneCh('00')).toBeNull();
  });

  it('un numéro trop court après normalisation est refusé', () => {
    expect(normaliserTelephoneCh('07912')).toBeNull();
  });
});
