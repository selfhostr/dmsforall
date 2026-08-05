import { describe, expect, it } from 'vitest';

import { schemaCreationPaiement } from './paiement';

/**
 * Correctif devise (2026-08-05, `apps/api/src/facturation/paiements/imputations.ts`) : le refus
 * explicite d'imputer un paiement sur un document d'une autre devise ne doit JAMAIS casser un
 * appelant existant qui n'envoie pas `devise` — compatibilité ascendante du contrat (CONTRIBUTING.md).
 * Ce fichier prouve que `schemaCreationPaiement` continue de défaulter sur `'CHF'` exactement
 * comme avant ce correctif : rien n'a changé dans ce schéma, la correction vit entièrement côté
 * service (`imputations.ts::verifierCoherenceDevise`), jamais dans la forme de la requête.
 */
describe('schemaCreationPaiement — devise (compatibilité ascendante, RF-58/MD-58)', () => {
  const CORPS_SANS_DEVISE = {
    siteId: '00000000-0000-0000-0000-000000000000',
    dateValeur: '2026-08-05',
    moyen: 'especes',
    montantCentimes: 10000,
    payeurLibelle: 'Client comptoir',
  };

  it("un appelant historique qui n'envoie pas `devise` obtient 'CHF' par défaut (aucune régression introduite)", () => {
    const resultat = schemaCreationPaiement.parse(CORPS_SANS_DEVISE);
    expect(resultat.devise).toBe('CHF');
    expect(resultat.imputations).toEqual([]);
  });

  it('un appelant qui envoie explicitement `devise: "EUR"` est respecté tel quel', () => {
    const resultat = schemaCreationPaiement.parse({ ...CORPS_SANS_DEVISE, devise: 'EUR' });
    expect(resultat.devise).toBe('EUR');
  });

  it('une devise hors CHF/EUR est rejetée à la validation (borne DEVISES_FACTURATION)', () => {
    const resultat = schemaCreationPaiement.safeParse({ ...CORPS_SANS_DEVISE, devise: 'USD' });
    expect(resultat.success).toBe(false);
  });
});
