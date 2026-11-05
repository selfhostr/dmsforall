import { describe, expect, it } from 'vitest';

import { calculerIntervalleSondageRapport } from './useRapportReprise';

describe('calculerIntervalleSondageRapport — le sondage ne tourne que pendant un import actif', () => {
  it('statut inconnu (import pas encore chargé) -> sondage arrêté', () => {
    expect(calculerIntervalleSondageRapport(undefined)).toBe(false);
  });

  it('en_attente (rien encore écrit) -> sondage arrêté', () => {
    expect(calculerIntervalleSondageRapport('en_attente')).toBe(false);
  });

  it('en_cours -> sondage actif toutes les 3 s, même cadence que useImportReprise', () => {
    expect(calculerIntervalleSondageRapport('en_cours')).toBe(3_000);
  });

  it('termine -> sondage arrêté (EtapeImport force le dernier rafraîchissement lui-même)', () => {
    expect(calculerIntervalleSondageRapport('termine')).toBe(false);
  });

  it('echoue -> sondage arrêté', () => {
    expect(calculerIntervalleSondageRapport('echoue')).toBe(false);
  });

  it('annule -> sondage arrêté', () => {
    expect(calculerIntervalleSondageRapport('annule')).toBe(false);
  });
});
