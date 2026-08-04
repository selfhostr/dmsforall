import { describe, expect, it } from 'vitest';
import { remonterCausePg } from './remonter-cause-pg';

/**
 * Défaut confirmé à l'audit (2026-08-04) — voir le commentaire de tête de `remonter-cause-pg.ts` :
 * quatre helpers du dépôt testaient `erreur.code` au premier niveau, alors que Drizzle enveloppe
 * SYSTÉMATIQUEMENT l'erreur `pg` brute dans une `DrizzleQueryError` qui ne porte `code` que sous
 * `.cause`. Ce fichier prouve les deux formes réellement observées (brute ET enveloppée), ainsi que
 * les gardes de robustesse (profondeur, cycle, valeur non-objet).
 */

/** Reproduit la forme réelle d'un `DatabaseError` du pilote `pg`. */
function erreurPgBrute(
  code: string,
  constraint?: string,
): Error & { code: string; constraint?: string } {
  const erreur = new Error(`erreur pg simulée : ${code}`) as Error & {
    code: string;
    constraint?: string;
  };
  erreur.code = code;
  if (constraint) erreur.constraint = constraint;
  return erreur;
}

/** Reproduit la forme réelle d'une `DrizzleQueryError` (`drizzle-orm/pg-core/session.js`) : aucun
 *  `code`/`constraint` en surface, uniquement `.cause`. */
function envelopper(cause: unknown): Error & { cause: unknown } {
  const enveloppe = new Error('Failed query') as Error & { cause: unknown };
  enveloppe.cause = cause;
  return enveloppe;
}

describe('remonterCausePg', () => {
  it('reconnaît la forme brute (pilote pg directement, sans passer par Drizzle)', () => {
    const brute = erreurPgBrute('23505', 'vehicule_stock_pkey');
    expect(remonterCausePg(brute)).toBe(brute);
  });

  it('reconnaît la forme enveloppée sous .cause (DrizzleQueryError — la forme réelle en production)', () => {
    const brute = erreurPgBrute('ZDFA4');
    const enveloppee = envelopper(brute);
    const resultat = remonterCausePg(enveloppee);
    expect(resultat).toBe(brute);
    expect(resultat?.code).toBe('ZDFA4');
  });

  it('déballe plusieurs couches d’enveloppe tant que la profondeur maximale n’est pas dépassée', () => {
    const brute = erreurPgBrute('23505', 'vehicule_stock_pkey');
    const enveloppeeTriple = envelopper(envelopper(envelopper(brute)));
    expect(remonterCausePg(enveloppeeTriple)).toBe(brute);
  });

  it('rend null au-delà de la profondeur maximale (10 maillons)', () => {
    const brute = erreurPgBrute('23505', 'vehicule_stock_pkey');
    // 11 enveloppes successives : le maillon utile est au-delà de PROFONDEUR_MAX_CAUSE (10).
    let chaine: unknown = brute;
    for (let i = 0; i < 11; i += 1) {
      chaine = envelopper(chaine);
    }
    expect(remonterCausePg(chaine)).toBeNull();
  });

  it('reconnaît un maillon utile exactement à la limite de la profondeur maximale', () => {
    const brute = erreurPgBrute('23505', 'vehicule_stock_pkey');
    // 9 enveloppes successives : le maillon utile est le 10e objet examiné (indices 0..9).
    let chaine: unknown = brute;
    for (let i = 0; i < 9; i += 1) {
      chaine = envelopper(chaine);
    }
    expect(remonterCausePg(chaine)).toBe(brute);
  });

  it('ne boucle jamais à l’infini sur une chaîne .cause cyclique', () => {
    const cyclique = new Error('cyclique') as Error & { cause: unknown };
    cyclique.cause = cyclique;
    expect(remonterCausePg(cyclique)).toBeNull();
  });

  it('rend null pour une exception sans .cause ni code exploitable', () => {
    expect(remonterCausePg(new Error('boom'))).toBeNull();
  });

  it('rend null pour une valeur non-objet', () => {
    expect(remonterCausePg('boom')).toBeNull();
    expect(remonterCausePg(42)).toBeNull();
    expect(remonterCausePg(null)).toBeNull();
    expect(remonterCausePg(undefined)).toBeNull();
  });

  it('rend null quand la chaîne se termine (.cause absent) sans jamais porter de code', () => {
    const sansCode = envelopper(envelopper(undefined));
    expect(remonterCausePg(sansCode)).toBeNull();
  });
});
