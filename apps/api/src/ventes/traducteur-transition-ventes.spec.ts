import { describe, expect, it } from 'vitest';

import { traduireErreurTransitionVente } from './traducteur-transition-ventes';

/**
 * Défaut CRITIQUE confirmé à l'audit (2026-08-04) : `traduireErreurTransitionVente` lisait
 * `erreur.code` au PREMIER niveau, mais `drizzle-orm` (`pg-core/session.js`,
 * `catch (e) { throw new DrizzleQueryError(query, params, e) }`) enveloppe systématiquement l'erreur
 * `pg` brute dans une `DrizzleQueryError` dont `code`/`table`/`detail` vivent sous `.cause`. En
 * conséquence, refuser/confirmer/négocier une reprise, un financement ou un dossier déjà dans un
 * autre état ressortait en `500` au lieu du `409 VENTE_*_TRANSITION_INTERDITE` attendu (le trigger
 * SQL `verifier_transition()` est le seul garde — aucun contrôle applicatif en amont, donc le bug
 * était systématique). Même bug déjà corrigé pour atelier et véhicules.
 *
 * Ce fichier prouve les deux formes réellement observées (brute ET enveloppée sous `.cause`), la
 * forme doublement enveloppée, et le repli propre (`null`) sur toute erreur non exploitable.
 */

const SQLSTATE_ZDFA1 = 'ZDFA1';

/** Reproduit la forme réelle d'un `DatabaseError` du pilote `pg` pour un `ZDFA1` (transition). */
function erreurPgBrute(
  table: string,
  depuis: string,
  vers: string,
): Error & { code: string; table: string; detail: string } {
  const erreur = new Error(`transition interdite ${table}`) as Error & {
    code: string;
    table: string;
    detail: string;
  };
  erreur.code = SQLSTATE_ZDFA1;
  erreur.table = table;
  erreur.detail = `entite=${table};depuis=${depuis};vers=${vers}`;
  return erreur;
}

/** Reproduit la forme réelle d'une `DrizzleQueryError` (`drizzle-orm/pg-core/session.js`). */
function erreurDrizzleEnveloppee(cause: unknown): Error & { cause: unknown } {
  const enveloppe = new Error('Failed query') as Error & { cause: unknown };
  enveloppe.cause = cause;
  return enveloppe;
}

describe('traduireErreurTransitionVente', () => {
  describe('forme enveloppée sous .cause (Drizzle — la forme réelle en production)', () => {
    it('mappe reprise en VENTE_REPRISE_TRANSITION_INTERDITE (409)', () => {
      const erreur = erreurDrizzleEnveloppee(erreurPgBrute('reprise', 'confirmee', 'negociee'));
      const resultat = traduireErreurTransitionVente(erreur, 'id-reprise', 'reprise');
      expect(resultat).not.toBeNull();
      expect(resultat?.code).toBe('VENTE_REPRISE_TRANSITION_INTERDITE');
      expect(resultat?.status).toBe(409);
      expect(resultat?.detail).toBe('entite=reprise;depuis=confirmee;vers=negociee');
      expect(resultat?.actionsProposees).toEqual([{ code: 'RAFRAICHIR' }]);
    });

    it('mappe financement_vente en VENTE_FINANCEMENT_TRANSITION_INTERDITE (409)', () => {
      const erreur = erreurDrizzleEnveloppee(
        erreurPgBrute('financement_vente', 'refuse', 'confirme'),
      );
      const resultat = traduireErreurTransitionVente(erreur, 'id-fin', 'fin');
      expect(resultat?.code).toBe('VENTE_FINANCEMENT_TRANSITION_INTERDITE');
      expect(resultat?.status).toBe(409);
    });

    it('mappe dossier_vente en VENTE_DOSSIER_TRANSITION_INTERDITE (409)', () => {
      const erreur = erreurDrizzleEnveloppee(erreurPgBrute('dossier_vente', 'clos', 'livre'));
      const resultat = traduireErreurTransitionVente(erreur, 'id-dossier', 'dossier');
      expect(resultat?.code).toBe('VENTE_DOSSIER_TRANSITION_INTERDITE');
      expect(resultat?.status).toBe(409);
    });

    it('remonte une chaîne .cause doublement enveloppée', () => {
      const erreur = erreurDrizzleEnveloppee(
        erreurDrizzleEnveloppee(erreurPgBrute('reprise', 'refusee', 'confirmee')),
      );
      const resultat = traduireErreurTransitionVente(erreur, 'id', 'lbl');
      expect(resultat?.code).toBe('VENTE_REPRISE_TRANSITION_INTERDITE');
    });
  });

  describe('forme brute (pilote pg directement, sans passer par Drizzle)', () => {
    it('mappe une erreur ZDFA1 non enveloppée', () => {
      const resultat = traduireErreurTransitionVente(
        erreurPgBrute('reprise', 'confirmee', 'negociee'),
        'id',
        'lbl',
      );
      expect(resultat?.code).toBe('VENTE_REPRISE_TRANSITION_INTERDITE');
    });
  });

  describe('non-reconnaissance — repli sur le traitement générique de l’appelant', () => {
    it('rend null pour un SQLSTATE différent de ZDFA1', () => {
      const autre = erreurPgBrute('reprise', 'confirmee', 'negociee');
      (autre as { code: string }).code = '23505';
      expect(traduireErreurTransitionVente(erreurDrizzleEnveloppee(autre), 'id', 'lbl')).toBeNull();
    });

    it('rend null pour une table ZDFA1 hors du module ventes (ex. ordre_reparation)', () => {
      expect(
        traduireErreurTransitionVente(
          erreurDrizzleEnveloppee(erreurPgBrute('ordre_reparation', 'ouvert', 'clos')),
          'id',
          'lbl',
        ),
      ).toBeNull();
    });

    it('rend null pour un detail de forme inattendue', () => {
      const brute = erreurPgBrute('reprise', 'a', 'b');
      (brute as { detail: string }).detail = 'format-inattendu';
      expect(traduireErreurTransitionVente(erreurDrizzleEnveloppee(brute), 'id', 'lbl')).toBeNull();
    });

    it('rend null pour une exception sans .cause ni code exploitable', () => {
      expect(traduireErreurTransitionVente(new Error('boom'), 'id', 'lbl')).toBeNull();
    });

    it('rend null pour une valeur non-objet', () => {
      expect(traduireErreurTransitionVente('boom', 'id', 'lbl')).toBeNull();
      expect(traduireErreurTransitionVente(null, 'id', 'lbl')).toBeNull();
      expect(traduireErreurTransitionVente(undefined, 'id', 'lbl')).toBeNull();
    });

    it('ne boucle jamais à l’infini sur une chaîne .cause cyclique', () => {
      const cyclique = new Error('cyclique') as Error & { cause: unknown };
      cyclique.cause = cyclique;
      expect(traduireErreurTransitionVente(cyclique, 'id', 'lbl')).toBeNull();
    });
  });
});
