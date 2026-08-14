import { describe, expect, it } from 'vitest';

import { schemaModificationBlocCreancier } from './creancier';

/**
 * Issue #12, appliquée à `schemaModificationBlocCreancier` (`.strict()`) : le bloc créancier porte
 * l'IBAN/QR-IBAN du garage — une donnée de paiement au même titre qu'un montant de ligne. Un champ
 * inconnu silencieusement jeté ici aurait le même effet pervers (ex. un futur champ `qrIBAN`, mal
 * casé, laisserait croire que le QR-IBAN a été enregistré alors qu'il ne l'a pas été).
 */
describe('schemaModificationBlocCreancier — champ inconnu REFUSÉ, nommé (issue #12, .strict())', () => {
  it('accepte une mise à jour partielle valide (non-régression)', () => {
    const resultat = schemaModificationBlocCreancier.safeParse({ iban: 'CH9300762011623852957' });
    expect(resultat.success).toBe(true);
  });

  it('un nom de champ voisin mais faux (qrIBAN, mauvaise casse) est REFUSÉ', () => {
    const resultat = schemaModificationBlocCreancier.safeParse({
      qrIBAN: 'CH2130113000012345678',
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "qrIBAN"');
  });
});
