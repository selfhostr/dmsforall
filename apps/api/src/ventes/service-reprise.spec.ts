import { describe, expect, it } from 'vitest';

import { estViolationCleUnique } from './service-reprise';

/**
 * Bug corrigé (audit 2026-08-04) : `estViolationCleUnique` testait `erreur.code` au premier
 * niveau, mais Drizzle enveloppe SYSTÉMATIQUEMENT l'erreur `pg` brute dans une `DrizzleQueryError`
 * (`code` sous `.cause`, jamais en surface) — une création de reprise en doublon sur le même
 * dossier de vente (`reprise.dossier_vente_id`, unique) rendait donc 500 `ERREUR_INTERNE` au lieu
 * de 409 `VENTE_REPRISE_DEJA_EXISTANTE`. Voir `common/erreurs-pg/remonter-cause-pg.ts`.
 */
describe('estViolationCleUnique (service-reprise)', () => {
  it('reconnaît un 23505 enveloppé sous .cause (forme réelle Drizzle)', () => {
    const brute = new Error('duplicate key') as Error & { code: string };
    brute.code = '23505';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationCleUnique(enveloppee)).toBe(true);
  });

  it('ne reconnaît pas un autre SQLSTATE enveloppé (ex. 23503, contrainte non concernée)', () => {
    const brute = new Error('foreign key violation') as Error & { code: string };
    brute.code = '23503';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationCleUnique(enveloppee)).toBe(false);
  });
});
