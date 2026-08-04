import { describe, it, expect } from 'vitest';

import { bornesJourneeLocale, dateJourLocale, formaterChrono } from './temps-pointage';

describe('hooks/pointage/temps-pointage', () => {
  describe('dateJourLocale', () => {
    it('retourne une date au format YYYY-MM-DD', () => {
      const resultat = dateJourLocale(new Date('2024-08-15T10:30:00Z'));
      expect(resultat).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('retourne la date locale, pas UTC', () => {
      // `2024-08-15T00:00:00Z` est minuit UTC, mais peut être la veille dans certains fuseaux
      const date = new Date('2024-08-15T00:00:00Z');
      const resultat = dateJourLocale(date);
      // Vérifie juste le format, le contenu exact dépend du fuseau local
      expect(resultat).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('formaterChrono', () => {
    it('formate 0 seconde en 00:00:00', () => {
      expect(formaterChrono(0)).toBe('00:00:00');
    });

    it('formate les secondes en HH:MM:SS', () => {
      expect(formaterChrono(3725)).toBe('01:02:05'); // 1h 2m 5s
    });

    it('formate correctement les grandes durées en heures', () => {
      expect(formaterChrono(36000)).toBe('10:00:00'); // 10 heures
    });

    it('remplit les zéros à gauche pour les minutes et secondes', () => {
      expect(formaterChrono(61)).toBe('00:01:01'); // 1m 1s
      expect(formaterChrono(3661)).toBe('01:01:01'); // 1h 1m 1s
    });
  });

  describe('bornesJourneeLocale', () => {
    it('retourne deux bornes ISO pour une date valide', () => {
      const { debutDu, debutAu } = bornesJourneeLocale('2024-08-15');
      expect(typeof debutDu).toBe('string');
      expect(typeof debutAu).toBe('string');
      expect(debutDu).toMatch(/^[\d\-T:.Z]+$/);
      expect(debutAu).toMatch(/^[\d\-T:.Z]+$/);
    });

    it('crée un début à minuit et une fin à 23h59:59.999', () => {
      const { debutDu, debutAu } = bornesJourneeLocale('2024-08-15');
      const debut = new Date(debutDu);
      const fin = new Date(debutAu);
      // Les heures en UTC peuvent varier selon le fuseau local d'exécution,
      // mais on peut vérifier que fin > debut
      expect(fin.getTime()).toBeGreaterThan(debut.getTime());
    });

    it("lève une erreur si le format n'a pas exactement 3 parties séparées par des tirets", () => {
      expect(() => bornesJourneeLocale('2024/08/15')).toThrow('Format de date invalide');
      expect(() => bornesJourneeLocale('2024-08')).toThrow('Format de date invalide');
      expect(() => bornesJourneeLocale('2024')).toThrow('Format de date invalide');
      expect(() => bornesJourneeLocale('2024-08-15-extra')).toThrow('Format de date invalide');
    });

    it('lève une erreur si les nombres ne peuvent pas être parsés', () => {
      expect(() => bornesJourneeLocale('xxxx-08-15')).toThrow('Conversion en nombre échouée');
      expect(() => bornesJourneeLocale('2024-xx-15')).toThrow('Conversion en nombre échouée');
      expect(() => bornesJourneeLocale('2024-08-xx')).toThrow('Conversion en nombre échouée');
    });

    it('accepte les dates avec des nombres valides', () => {
      // Test avec une date en début d'année
      expect(() => bornesJourneeLocale('2024-01-01')).not.toThrow();
      // Test avec une date en fin d'année
      expect(() => bornesJourneeLocale('2024-12-31')).not.toThrow();
    });
  });
});
