import { describe, expect, it } from 'vitest';

import { detecterFormeSaisie, formaterPlaque, normaliserPlaque } from './plaque';

describe('normaliserPlaque', () => {
  it('met en majuscules et retire les espaces', () => {
    expect(normaliserPlaque('vd 123456')).toBe('VD123456');
  });

  it('neutralise tirets, apostrophes et points', () => {
    expect(normaliserPlaque("VD-123'456.")).toBe('VD123456');
    expect(normaliserPlaque('VD.123.456')).toBe('VD123456');
  });

  it('laisse un fragment de recherche tel quel une fois normalisé (CT-04)', () => {
    // Le fragment "123456" est envoyé tel quel au serveur (D-08) : normaliserPlaque ne fait que
    // neutraliser la saisie, jamais de résolution de plaque complète côté client.
    expect(normaliserPlaque('123456')).toBe('123456');
  });

  it('produit la même valeur normalisée quelle que soit la présentation d’une plaque historique (CT-05)', () => {
    // "VD 123456" a pu être portée par deux véhicules successifs (RM-17) : la recherche envoyée
    // au serveur doit être identique quelle que soit la façon dont l'utilisateur l'a tapée,
    // sinon un des deux véhicules devient introuvable selon la casse/ponctuation saisie.
    const variantes = ["VD 123456", "vd-123456", "V.D.123.456", "VD'123456"];
    const normalisees = variantes.map(normaliserPlaque);
    expect(new Set(normalisees).size).toBe(1);
    expect(normalisees[0]).toBe('VD123456');
  });
});

describe('formaterPlaque', () => {
  it('insère un espace après le code canton', () => {
    expect(formaterPlaque('VD123456')).toBe('VD 123456');
  });

  it('accepte une saisie déjà espacée ou ponctuée', () => {
    expect(formaterPlaque("vd-123'456")).toBe('VD 123456');
  });

  it('rend telle quelle une valeur qui ne correspond pas au motif canton+numéro', () => {
    expect(formaterPlaque('ABC')).toBe('ABC');
  });
});

describe('detecterFormeSaisie', () => {
  it('détecte un e-mail', () => {
    expect(detecterFormeSaisie('client@exemple.ch')).toBe('email');
  });

  it('détecte un VIN (17 caractères)', () => {
    expect(detecterFormeSaisie('WVWZZZ1KZAW123456')).toBe('vin');
  });

  it('détecte un numéro d’OR ("OR-")', () => {
    expect(detecterFormeSaisie('OR-2026-00123')).toBe('numeroOr');
  });

  it('détecte une plaque suisse (canton + numéro)', () => {
    expect(detecterFormeSaisie('VD 123456')).toBe('plaque');
  });

  it('détecte un numéro de téléphone', () => {
    expect(detecterFormeSaisie('+41791234567')).toBe('telephone');
    expect(detecterFormeSaisie('079 123 45 67')).toBe('telephone');
  });

  it('retombe sur une recherche libre sinon', () => {
    expect(detecterFormeSaisie('Dupont')).toBe('libre');
    expect(detecterFormeSaisie('')).toBe('libre');
  });
});
