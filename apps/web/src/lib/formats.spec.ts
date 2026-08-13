import { describe, expect, it } from 'vitest';

import {
  datetimeVersFormatSuisse,
  formatSuisseVersISO_Datetime,
  isoDatetimeDirectValide,
} from './formats';

describe('Utilitaires de datetime suisse', () => {
  describe('datetimeVersFormatSuisse', () => {
    it('convertit une ISO datetime en format suisse', () => {
      // ISO: 2026-08-12T14:30:00.000Z (UTC)
      const iso = '2026-08-12T14:30:00.000Z';
      const resultat = datetimeVersFormatSuisse(iso);
      // Dépend du fuseau horaire local du test. En UTC, on s'attend à 12.08.2026 14:30
      // (ou un décalage selon le fuseau du serveur de test)
      expect(resultat).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    });

    it('retourne une chaîne vide pour une valeur vide', () => {
      expect(datetimeVersFormatSuisse(undefined)).toBe('');
      expect(datetimeVersFormatSuisse('')).toBe('');
    });

    it('retourne une chaîne vide pour une Date invalide', () => {
      expect(datetimeVersFormatSuisse(new Date('invalid'))).toBe('');
    });
  });

  describe('formatSuisseVersISO_Datetime', () => {
    it('convertit une saisie suisse en ISO datetime', () => {
      const resultat = formatSuisseVersISO_Datetime('12.08.2026 14:30');
      expect(resultat).toBeDefined();
      // Doit être au format ISO
      expect(resultat).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('accepte des espaces flexibles', () => {
      const resultat1 = formatSuisseVersISO_Datetime('12.08.2026 14:30');
      const resultat2 = formatSuisseVersISO_Datetime('12.08.2026  14:30');
      expect(resultat1).toBeDefined();
      expect(resultat2).toBeDefined();
    });

    it('le aller-retour reproduit la même heure (applique le décalage local correctement)', () => {
      // Cet test fige le comportement : formatSuisseVersISO_Datetime + datetimeVersFormatSuisse
      // doit reproduire l'heure d'entrée, appliquant correctement le décalage fuseau horaire
      // du navigateur (CET/CEST) à chaque direction.
      const entrees = ['12.08.2026 14:30', '15.01.2027 14:30', '01.01.2026 00:00'];
      for (const entree of entrees) {
        const iso = formatSuisseVersISO_Datetime(entree);
        const sortie = datetimeVersFormatSuisse(iso);
        expect(sortie).toBe(entree);
      }
    });

    it('retourne undefined pour un format invalide', () => {
      expect(formatSuisseVersISO_Datetime('invalid')).toBeUndefined();
      expect(formatSuisseVersISO_Datetime('12/08/2026 14:30')).toBeUndefined();
      expect(formatSuisseVersISO_Datetime('12.08.2026')).toBeUndefined();
      expect(formatSuisseVersISO_Datetime('14:30')).toBeUndefined();
    });

    it('valide que la date existe réellement', () => {
      // 31 février n'existe pas
      expect(formatSuisseVersISO_Datetime('31.02.2026 14:30')).toBeUndefined();
      // 30 février 2026 (année non-bissextile)
      expect(formatSuisseVersISO_Datetime('30.02.2026 14:30')).toBeUndefined();
      // 29 février 2024 (année bissextile, OK)
      expect(formatSuisseVersISO_Datetime('29.02.2024 14:30')).toBeDefined();
    });

    it("valide que l'heure est valide", () => {
      expect(formatSuisseVersISO_Datetime('12.08.2026 24:00')).toBeUndefined();
      expect(formatSuisseVersISO_Datetime('12.08.2026 23:60')).toBeUndefined();
      expect(formatSuisseVersISO_Datetime('12.08.2026 -1:30')).toBeUndefined();
      // OK
      expect(formatSuisseVersISO_Datetime('12.08.2026 23:59')).toBeDefined();
    });

    it('retourne undefined pour une valeur vide', () => {
      expect(formatSuisseVersISO_Datetime('')).toBeUndefined();
      expect(formatSuisseVersISO_Datetime(undefined)).toBeUndefined();
      expect(formatSuisseVersISO_Datetime('   ')).toBeUndefined();
    });
  });

  describe('isoDatetimeDirectValide', () => {
    it('valide un format ISO datetime correct', () => {
      const resultat = isoDatetimeDirectValide('2026-08-12T14:30:00.000Z');
      expect(resultat).toBe('2026-08-12T14:30:00.000Z');
    });

    it('tolère les variantes de format ISO datetime', () => {
      // ISO sans secondes
      expect(isoDatetimeDirectValide('2026-08-12T14:30')).toBeDefined();
      // ISO avec secondes mais pas de millisecondes
      expect(isoDatetimeDirectValide('2026-08-12T14:30:00')).toBeDefined();
      // ISO complet
      expect(isoDatetimeDirectValide('2026-08-12T14:30:00.000Z')).toBeDefined();
    });

    it('retourne undefined pour un format invalide', () => {
      expect(isoDatetimeDirectValide('invalid')).toBeUndefined();
      expect(isoDatetimeDirectValide('12.08.2026 14:30')).toBeUndefined();
      expect(isoDatetimeDirectValide('2026-08-12')).toBeUndefined();
    });

    it('valide que la date existe réellement', () => {
      // 31 février n'existe pas
      expect(isoDatetimeDirectValide('2026-02-31T14:30')).toBeUndefined();
      // 29 février 2026 (année non-bissextile)
      expect(isoDatetimeDirectValide('2026-02-29T14:30')).toBeUndefined();
      // 29 février 2024 (année bissextile, OK)
      expect(isoDatetimeDirectValide('2024-02-29T14:30')).toBeDefined();
    });

    it("valide que l'heure est valide", () => {
      expect(isoDatetimeDirectValide('2026-08-12T24:00')).toBeUndefined();
      expect(isoDatetimeDirectValide('2026-08-12T23:60')).toBeUndefined();
    });

    it('retourne undefined pour une valeur vide', () => {
      expect(isoDatetimeDirectValide('')).toBeUndefined();
      expect(isoDatetimeDirectValide('   ')).toBeUndefined();
    });
  });
});
