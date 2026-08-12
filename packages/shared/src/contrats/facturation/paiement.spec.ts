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

/**
 * Issue #12, appliquée à `schemaCreationPaiement` (`.strict()`) : même défaut de principe que sur
 * la ligne de document — un montant d'encaissement mal nommé disparaissait silencieusement avant
 * ce correctif. `POST /paiements` est un encaissement réel, donc le même risque financier.
 */
describe('schemaCreationPaiement — champ inconnu REFUSÉ, nommé (issue #12, .strict())', () => {
  const CORPS_VALIDE = {
    siteId: '00000000-0000-0000-0000-000000000000',
    dateValeur: '2026-08-05',
    moyen: 'especes',
    montantCentimes: 10000,
    payeurLibelle: 'Client comptoir',
  };

  it('un nom de champ voisin mais faux (montantCentime, sans le "s") est REFUSÉ', () => {
    const resultat = schemaCreationPaiement.safeParse({ ...CORPS_VALIDE, montantCentime: 10000 });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "montantCentime"');
  });

  it('une imputation embarquée avec un champ inconnu est REFUSÉE (formeImputationInline, même garde)', () => {
    const resultat = schemaCreationPaiement.safeParse({
      ...CORPS_VALIDE,
      imputations: [
        {
          documentId: '11111111-1111-4111-8111-111111111111',
          montantCentimes: 5000,
          natur: 'reglement',
        },
      ],
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "natur"');
  });
});
