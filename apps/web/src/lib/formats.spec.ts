import { describe, expect, it } from 'vitest';

import {
  datetimeVersFormatSuisse,
  formaterDate,
  formaterDateHeure,
  formaterHeure,
  formatSuisseVersISO_Datetime,
  isoDatetimeDirectValide,
} from './formats';

/**
 * Preuve du correctif de fond du 16.08.2026 : le rendu/parsing d'une heure suisse ne doit JAMAIS
 * dépendre du fuseau du PROCESSUS qui exécute les tests (celui de la CI, d'un poste de dev à
 * l'étranger…) — seul le fuseau Europe/Zurich compte. Ces assertions comparent un instant absolu
 * FIXE (`...Z`, sans ambiguïté) à une chaîne suisse littérale : contrairement à un aller-retour
 * encode-puis-decode (symétrique par construction, donc incapable de distinguer « heure suisse »
 * de « heure du process »), une valeur littérale attendue échoue réellement si `timeZone:
 * 'Europe/Zurich'` disparaît d'un formateur. Vérifié manuellement : en retirant le `timeZone`
 * explicite de `FORMATEUR_DATE`/`FORMATEUR_HEURE`/`FORMATEUR_COMPOSANTES_SUISSE` et en rejouant
 * `TZ=UTC pnpm --filter @dfa/web exec vitest run src/lib/formats.spec.ts`, ces tests-ci basculent
 * de vert à rouge (09:15 rendu au lieu de 11:15 attendu) — preuve qu'ils testent bien le bon
 * mécanisme, pas un artefact de l'environnement de test.
 */
describe('Heure suisse — indépendance au fuseau du PROCESSUS', () => {
  it("rend un instant absolu d'été (CEST, UTC+2) en heure murale suisse, quel que soit TZ", () => {
    const instant = '2026-07-20T09:15:00.000Z';
    expect(formaterDateHeure(instant)).toBe('20.07.2026 11:15');
    expect(datetimeVersFormatSuisse(instant)).toBe('20.07.2026 11:15');
  });

  it("rend un instant absolu d'hiver (CET, UTC+1) en heure murale suisse, quel que soit TZ", () => {
    const instant = '2026-01-15T09:15:00.000Z';
    expect(formaterDateHeure(instant)).toBe('15.01.2026 10:15');
    expect(datetimeVersFormatSuisse(instant)).toBe('15.01.2026 10:15');
  });

  it("interprète une saisie murale suisse d'été comme le bon instant absolu, quel que soit TZ", () => {
    expect(formatSuisseVersISO_Datetime('20.07.2026 11:15')).toBe('2026-07-20T09:15:00.000Z');
  });

  it("interprète une saisie murale suisse d'hiver comme le bon instant absolu, quel que soit TZ", () => {
    expect(formatSuisseVersISO_Datetime('15.01.2026 10:15')).toBe('2026-01-15T09:15:00.000Z');
  });
});

describe('formaterDate / formaterHeure', () => {
  it('formaterDate rend le jour civil suisse, quel que soit TZ (23h locale = jour suivant en Suisse)', () => {
    // 2026-01-15T23:15:00.000Z (UTC) = 16.01.2026 00:15 en Suisse (CET, +1) : le jour civil
    // suisse a déjà basculé alors que le jour civil UTC ne bascule qu'à minuit UTC.
    expect(formaterDate('2026-01-15T23:15:00.000Z')).toBe('16.01.2026');
  });

  it('formaterHeure rend l’heure murale suisse, quel que soit TZ', () => {
    expect(formaterHeure('2026-07-20T09:15:00.000Z')).toBe('11:15');
    expect(formaterHeure('2026-01-15T09:15:00.000Z')).toBe('10:15');
  });
});

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

    it("aller-retour exact en heure d'été (CEST, UTC+2) et heure d'hiver (CET, UTC+1), verrouillé sur l'ISO absolu attendu", () => {
      // ATTENTION : un aller-retour encode-puis-decode comparé à sa propre entrée ne prouve RIEN
      // — il est symétrique par construction et passe même si les deux fonctions partagent, à
      // tort, le fuseau du PROCESSUS plutôt que Europe/Zurich (mesuré le 16.08.2026 : cette
      // version antérieure du test passait identiquement sous TZ=UTC, TZ=America/New_York et
      // TZ=Europe/Zurich alors que le rendu affiché, lui, était faux sous UTC). Chaque cas
      // verrouille donc en plus l'ISO absolu attendu, indépendant de tout fuseau.
      const casTestes: Array<{ suisse: string; isoAttendu: string }> = [
        { suisse: '15.08.2026 14:30', isoAttendu: '2026-08-15T12:30:00.000Z' }, // CEST, UTC+2
        { suisse: '15.01.2026 14:30', isoAttendu: '2026-01-15T13:30:00.000Z' }, // CET, UTC+1
      ];

      for (const { suisse, isoAttendu } of casTestes) {
        const iso = formatSuisseVersISO_Datetime(suisse);
        expect(iso).toBe(isoAttendu);
        expect(datetimeVersFormatSuisse(iso)).toBe(suisse);
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
