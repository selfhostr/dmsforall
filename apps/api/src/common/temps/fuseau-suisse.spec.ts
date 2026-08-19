import { describe, expect, it } from 'vitest';

import {
  debutJourneeSuisse,
  finJourneeSuisse,
  instantLocalSuisse,
  jourCivilSuisse,
} from './fuseau-suisse';

/**
 * Valeurs attendues calculées INDÉPENDAMMENT de l'implémentation testée, via `Intl.DateTimeFormat`
 * en ligne de commande Node (même moteur ICU/tzdata que celui qui fait tourner l'API — la seule
 * source de vérité disponible sans dépendance externe ajoutée à ce dépôt) :
 *
 *   node -e "const dtf=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Zurich',hourCycle:'h23',
 *     year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 *     for (const iso of ['2026-03-28T12:00:00Z','2026-03-30T12:00:00Z',
 *                         '2026-10-24T12:00:00Z','2026-10-26T12:00:00Z'])
 *       console.log(iso, dtf.format(new Date(iso)));"
 *
 * confirme que le dernier dimanche de mars 2026 est le 29 (bascule CET->CEST, avance d'une heure à
 * 02h00 locale) et le dernier dimanche d'octobre 2026 le 25 (bascule CEST->CET, recule d'une heure
 * à 03h00 locale) — les deux dates exactes utilisées ci-dessous, jamais approximées.
 */
describe('fuseau-suisse — bornage de journée civile Europe/Zurich', () => {
  describe('bascule de printemps — 29.03.2026 (CET +1h -> CEST +2h, avance à 02h00 locale)', () => {
    it('00h00 locale du 29.03.2026 est encore CET (+1h) : 2026-03-28T23:00:00.000Z', () => {
      expect(debutJourneeSuisse('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    });

    it('23h59:59.999 locale du 29.03.2026 est déjà CEST (+2h, bascule passée à 02h00) : 2026-03-29T21:59:59.999Z', () => {
      expect(finJourneeSuisse('2026-03-29').toISOString()).toBe('2026-03-29T21:59:59.999Z');
    });

    it('la journée du 29.03.2026 dure exactement 23h — jamais 24h, jamais 0 ni 48h', () => {
      const debut = debutJourneeSuisse('2026-03-29').getTime();
      const fin = finJourneeSuisse('2026-03-29').getTime();
      const heures = (fin + 1 - debut) / 3_600_000;
      expect(heures).toBe(23);
    });
  });

  describe("bascule d'automne — 25.10.2026 (CEST +2h -> CET +1h, recul à 03h00 locale)", () => {
    it('00h00 locale du 25.10.2026 est encore CEST (+2h) : 2026-10-24T22:00:00.000Z', () => {
      expect(debutJourneeSuisse('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    });

    it('23h59:59.999 locale du 25.10.2026 est déjà CET (+1h, bascule passée à 03h00) : 2026-10-25T22:59:59.999Z', () => {
      expect(finJourneeSuisse('2026-10-25').toISOString()).toBe('2026-10-25T22:59:59.999Z');
    });

    it('la journée du 25.10.2026 dure exactement 25h — jamais 24h, jamais 0 ni 48h', () => {
      const debut = debutJourneeSuisse('2026-10-25').getTime();
      const fin = finJourneeSuisse('2026-10-25').getTime();
      const heures = (fin + 1 - debut) / 3_600_000;
      expect(heures).toBe(25);
    });
  });

  describe('un jour ordinaire dure toujours exactement 24h, hiver comme été', () => {
    it.each(['2026-01-15', '2026-07-15', '2026-12-31', '2026-06-01'])('%s -> 24h', (dateJour) => {
      const debut = debutJourneeSuisse(dateJour).getTime();
      const fin = finJourneeSuisse(dateJour).getTime();
      expect((fin + 1 - debut) / 3_600_000).toBe(24);
    });

    it('aucune journée de 2026 ne dure autre chose que 23h, 24h ou 25h (balayage complet de l’année)', () => {
      const anomalies: string[] = [];
      for (let mois = 0; mois < 12; mois += 1) {
        const joursDansMois = new Date(2026, mois + 1, 0).getDate();
        for (let jour = 1; jour <= joursDansMois; jour += 1) {
          const dateJour = `2026-${String(mois + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
          const heures =
            (finJourneeSuisse(dateJour).getTime() + 1 - debutJourneeSuisse(dateJour).getTime()) /
            3_600_000;
          if (heures !== 23 && heures !== 24 && heures !== 25)
            anomalies.push(`${dateJour}:${String(heures)}`);
        }
      }
      expect(anomalies).toEqual([]);
    });
  });

  describe('jourCivilSuisse — le bug mesuré le 14.08.2026 (bornage de journée en UTC pur)', () => {
    it('00h30 heure suisse EN ÉTÉ (15.07.2026) appartient au jour civil suisse EN COURS, pas à la veille', () => {
      // 00h30 locale (CEST, +2h) le 15.07.2026 == 2026-07-14T22:30:00.000Z en UTC.
      const instant = instantLocalSuisse('2026-07-15', '00:30:00.000');
      expect(instant.toISOString()).toBe('2026-07-14T22:30:00.000Z');

      // Le bug reproduit : `instant.toISOString().slice(0, 10)` (bornage UTC pur, doctrine
      // remplacée par ce fichier) rendrait '2026-07-14' — LA VEILLE, faux.
      expect(instant.toISOString().slice(0, 10)).toBe('2026-07-14');

      // Le comportement correct, celui que ce module doit garantir partout où il est branché :
      expect(jourCivilSuisse(instant)).toBe('2026-07-15');
    });

    it('23h30 heure suisse EN HIVER (15.01.2026) appartient au jour civil suisse en cours', () => {
      // 23h30 locale (CET, +1h) le 15.01.2026 == 2026-01-15T22:30:00.000Z en UTC.
      const instant = instantLocalSuisse('2026-01-15', '23:30:00.000');
      expect(instant.toISOString()).toBe('2026-01-15T22:30:00.000Z');
      expect(jourCivilSuisse(instant)).toBe('2026-01-15');
    });
  });

  describe('instantLocalSuisse — heure locale arbitraire (P-31, heure de fermeture de site)', () => {
    it('18h30 le 10.06.2026 (été, CEST +2h) -> 2026-06-10T16:30:00.000Z', () => {
      expect(instantLocalSuisse('2026-06-10', '18:30').toISOString()).toBe(
        '2026-06-10T16:30:00.000Z',
      );
    });

    it('18h30 le 10.12.2026 (hiver, CET +1h) -> 2026-12-10T17:30:00.000Z', () => {
      expect(instantLocalSuisse('2026-12-10', '18:30').toISOString()).toBe(
        '2026-12-10T17:30:00.000Z',
      );
    });

    it("accepte le format 'HH:MM:SS' rendu par la colonne `time` de Postgres via le pilote pg", () => {
      expect(instantLocalSuisse('2026-06-10', '18:30:00').toISOString()).toBe(
        '2026-06-10T16:30:00.000Z',
      );
    });
  });
});
