import { describe, expect, it } from 'vitest';
import { interpreterErreurTransitionInterdite } from './traducteur-erreur-transition-sql';

/** Construit une erreur pg brute plausible, telle que `node-postgres` la produirait pour ZDFA1. */
function erreurPg(champs: {
  code?: string;
  table?: string;
  detail?: string;
  hint?: string;
}): Error {
  return Object.assign(new Error('Transition interdite'), champs);
}

/**
 * Reproduit la forme RÉELLE observée en conditions réelles (transition interdite déclenchée en
 * direct sur l'API, objet intercepté avant traduction) : `drizzle-orm` enveloppe le
 * `DatabaseError` `pg` dans un `DrizzleQueryError`, et les champs SQLSTATE (`code`, `table`,
 * `detail`, `hint`) se retrouvent sous `.cause`, pas au premier niveau. C'est CETTE forme que
 * `ServiceTransitions.transitionner` (atelier) et les traducteurs homologues (pointage, ventes)
 * reçoivent réellement dans leur `catch`.
 */
function erreurDrizzleEnveloppee(champs: {
  code?: string;
  table?: string;
  detail?: string;
  hint?: string;
}): Error {
  const cause = Object.assign(new Error('Transition interdite'), champs);
  return Object.assign(new Error('Failed query: update "ordre_reparation" set …'), { cause });
}

describe('interpreterErreurTransitionInterdite', () => {
  it('interprète un refus sur ordre_reparation avec une liste de transitions possibles', () => {
    const erreur = erreurPg({
      code: 'ZDFA1',
      table: 'ordre_reparation',
      detail: 'entite=ordre_reparation;depuis=ouvert;vers=facture',
      hint: 'Depuis « ouvert », transitions autorisées : annule, controle, en_cours, termine.',
    });

    expect(interpreterErreurTransitionInterdite(erreur)).toEqual({
      code: 'OR_TRANSITION_INTERDITE',
      entite: 'ordre_reparation',
      statutDepuis: 'ouvert',
      statutVers: 'facture',
      estEtatTerminal: false,
      transitionsPossibles: ['annule', 'controle', 'en_cours', 'termine'],
    });
  });

  it('interprète un refus sur ligne_or (table distincte -> code distinct, sans lire le message)', () => {
    const erreur = erreurPg({
      code: 'ZDFA1',
      table: 'ligne_or',
      detail: 'entite=ligne_or;depuis=facturee;vers=annulee',
      hint: "« facturee » est un état terminal : aucune transition n'en part.",
    });

    const resultat = interpreterErreurTransitionInterdite(erreur);
    expect(resultat?.code).toBe('LIGNE_TRANSITION_INTERDITE');
    expect(resultat?.estEtatTerminal).toBe(true);
    expect(resultat?.transitionsPossibles).toEqual([]);
  });

  it('reconnaît rendez_vous et pointage (déclarés au lot 1, transitions non encore émises)', () => {
    expect(
      interpreterErreurTransitionInterdite(
        erreurPg({
          code: 'ZDFA1',
          table: 'rendez_vous',
          detail: 'entite=rendez_vous;depuis=planifie;vers=honore',
        }),
      )?.code,
    ).toBe('RDV_TRANSITION_INTERDITE');
    expect(
      interpreterErreurTransitionInterdite(
        erreurPg({
          code: 'ZDFA1',
          table: 'pointage',
          detail: 'entite=pointage;depuis=ouvert;vers=clos',
        }),
      )?.code,
    ).toBe('POINTAGE_TRANSITION_INTERDITE');
  });

  it('rend null pour un code SQLSTATE différent', () => {
    const erreur = erreurPg({
      code: '23505',
      table: 'ordre_reparation',
      detail: 'entite=ordre_reparation;depuis=ouvert;vers=facture',
    });
    expect(interpreterErreurTransitionInterdite(erreur)).toBeNull();
  });

  it('rend null pour une table non cartographiée (entité sans machine à états)', () => {
    const erreur = erreurPg({
      code: 'ZDFA1',
      table: 'client',
      detail: 'entite=client;depuis=actif;vers=archive',
    });
    expect(interpreterErreurTransitionInterdite(erreur)).toBeNull();
  });

  it('rend null quand detail est absent ou mal formé', () => {
    expect(
      interpreterErreurTransitionInterdite(erreurPg({ code: 'ZDFA1', table: 'ordre_reparation' })),
    ).toBeNull();
    expect(
      interpreterErreurTransitionInterdite(
        erreurPg({ code: 'ZDFA1', table: 'ordre_reparation', detail: 'charabia' }),
      ),
    ).toBeNull();
  });

  it('rend null quand table est absent', () => {
    expect(
      interpreterErreurTransitionInterdite(
        erreurPg({ code: 'ZDFA1', detail: 'entite=ordre_reparation;depuis=ouvert;vers=facture' }),
      ),
    ).toBeNull();
  });

  it("rend null pour une valeur qui n'est pas un objet, ou null", () => {
    expect(interpreterErreurTransitionInterdite('pas une erreur')).toBeNull();
    expect(interpreterErreurTransitionInterdite(null)).toBeNull();
    expect(interpreterErreurTransitionInterdite(undefined)).toBeNull();
  });

  it('un hint absent produit une liste vide et estEtatTerminal false, sans lever', () => {
    const erreur = erreurPg({
      code: 'ZDFA1',
      table: 'ordre_reparation',
      detail: 'entite=ordre_reparation;depuis=ouvert;vers=facture',
    });
    const resultat = interpreterErreurTransitionInterdite(erreur);
    expect(resultat?.estEtatTerminal).toBe(false);
    expect(resultat?.transitionsPossibles).toEqual([]);
  });

  it("un hint d'une seule transition possible rend un tableau à un élément", () => {
    const erreur = erreurPg({
      code: 'ZDFA1',
      table: 'ordre_reparation',
      detail: 'entite=ordre_reparation;depuis=restitue;vers=ouvert',
      hint: 'Depuis « restitue », transitions autorisées : cloture.',
    });
    expect(interpreterErreurTransitionInterdite(erreur)?.transitionsPossibles).toEqual(['cloture']);
  });

  describe('erreur enveloppée par drizzle-orm (forme réelle en production)', () => {
    it('remonte `.cause` pour trouver le ZDFA1 sur ordre_reparation', () => {
      const erreur = erreurDrizzleEnveloppee({
        code: 'ZDFA1',
        table: 'ordre_reparation',
        detail: 'entite=ordre_reparation;depuis=ouvert;vers=cloture',
        hint: 'Depuis « ouvert », transitions autorisées : annule, controle, en_cours, termine.',
      });

      expect(interpreterErreurTransitionInterdite(erreur)).toEqual({
        code: 'OR_TRANSITION_INTERDITE',
        entite: 'ordre_reparation',
        statutDepuis: 'ouvert',
        statutVers: 'cloture',
        estEtatTerminal: false,
        transitionsPossibles: ['annule', 'controle', 'en_cours', 'termine'],
      });
    });

    it('remonte `.cause` pour trouver le ZDFA1 sur ligne_or', () => {
      const erreur = erreurDrizzleEnveloppee({
        code: 'ZDFA1',
        table: 'ligne_or',
        detail: 'entite=ligne_or;depuis=proposee;vers=refusee',
        hint: 'Depuis « proposee », transitions autorisées : validee, refusee.',
      });

      const resultat = interpreterErreurTransitionInterdite(erreur);
      expect(resultat?.code).toBe('LIGNE_TRANSITION_INTERDITE');
      expect(resultat?.statutDepuis).toBe('proposee');
      expect(resultat?.statutVers).toBe('refusee');
    });

    it('remonte une chaîne `.cause` imbriquée sur plusieurs niveaux', () => {
      const zdfa1 = Object.assign(new Error('Transition interdite'), {
        code: 'ZDFA1',
        table: 'ordre_reparation',
        detail: 'entite=ordre_reparation;depuis=ouvert;vers=facture',
      });
      const niveau2 = Object.assign(new Error('Failed query'), { cause: zdfa1 });
      const niveau3 = Object.assign(new Error('Query execution failed'), { cause: niveau2 });

      expect(interpreterErreurTransitionInterdite(niveau3)?.code).toBe('OR_TRANSITION_INTERDITE');
    });

    it("rend null si aucun niveau de la chaîne `.cause` ne porte ZDFA1 (n'invente rien)", () => {
      const causeSansRapport = Object.assign(new Error('connexion perdue'), { code: 'ECONNRESET' });
      const enveloppe = Object.assign(new Error('Failed query'), { cause: causeSansRapport });
      expect(interpreterErreurTransitionInterdite(enveloppe)).toBeNull();
    });

    it('ne boucle pas indéfiniment sur une chaîne `.cause` cyclique', () => {
      const a: { message: string; code?: string; cause?: unknown } = new Error('a');
      const b: { message: string; code?: string; cause?: unknown } = new Error('b');
      a.cause = b;
      b.cause = a;
      expect(interpreterErreurTransitionInterdite(a)).toBeNull();
    });
  });
});
