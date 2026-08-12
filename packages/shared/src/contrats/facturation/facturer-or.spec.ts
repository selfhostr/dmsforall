import { describe, expect, it } from 'vitest';

import { schemaFacturationOrdreReparation } from './facturer-or';

/**
 * Issue #12, appliquée à `schemaFacturationOrdreReparation` (`.strict()`) : cette action ne porte
 * ni ligne ni montant (tout est recopié et figé côté serveur, RF-81), mais un champ inconnu
 * silencieusement ignoré resterait le même défaut de principe — et `groupes`/`motifsReport`
 * embarquent `schemaSelecteurGroupePayeurOr`, désormais strict lui aussi.
 */
describe('schemaFacturationOrdreReparation — champ inconnu REFUSÉ, nommé (issue #12, .strict())', () => {
  const CORPS_VALIDE = {
    groupes: [{ payeur: 'client' as const }],
  };

  it('accepte un corps valide (non-régression)', () => {
    const resultat = schemaFacturationOrdreReparation.safeParse(CORPS_VALIDE);
    expect(resultat.success).toBe(true);
  });

  it('un champ inconnu à la racine est REFUSÉ', () => {
    const resultat = schemaFacturationOrdreReparation.safeParse({
      ...CORPS_VALIDE,
      inclureDemontage: true, // faux nom — le vrai est inclureDemontageRefuse
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "inclureDemontage"');
  });

  it('un champ inconnu dans un élément de `groupes` (schemaSelecteurGroupePayeurOr) est REFUSÉ', () => {
    const resultat = schemaFacturationOrdreReparation.safeParse({
      groupes: [{ payeur: 'client', payeurClient: null }], // faux nom — le vrai est payeurClientId
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "payeurClient"');
  });

  it('un champ inconnu dans un élément de `motifsReport` (intersection strict + strict) est REFUSÉ', () => {
    const resultat = schemaFacturationOrdreReparation.safeParse({
      groupes: [{ payeur: 'client' }],
      motifsReport: [{ payeur: 'constructeur', payeurClientId: null, motiff: 'en attente' }],
    });
    expect(resultat.success).toBe(false);
  });
});
