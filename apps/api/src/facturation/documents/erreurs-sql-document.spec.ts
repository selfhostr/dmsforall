import { describe, expect, it } from 'vitest';
import {
  traduireErreurDocument,
  traduireErreurPeriodeClose,
  traduireErreurTransitionDocument,
  traduireErreurVerrouillage,
} from './erreurs-sql-document';

/**
 * Défaut CRITIQUE confirmé à l'audit (2026-08-04) : modifier une facture émise (verrouillée), ou
 * émettre un document sur une période comptable close, ressortait en `500 ERREUR_INTERNE` au lieu
 * du code métier attendu (`DOCUMENT_VERROUILLE` / `DOCUMENT_PERIODE_CLOSE` / MD-20, MD-21, MD-34).
 *
 * Cause : les trois traducteurs de ce module (`ZDFA1`/`ZDFA2`/`ZDFA5`) lisaient `code`/`table`/
 * `detail`/`hint` DIRECTEMENT sur l'objet intercepté — mais Drizzle (`pg-core/session.js`)
 * enveloppe systématiquement l'erreur `pg` brute dans une `DrizzleQueryError` qui porte ces champs
 * sous `.cause`, jamais en surface. Aucun des trois traducteurs ne reconnaissait donc jamais rien
 * en conditions réelles, et ce module est le MÉCANISME UNIQUE de traduction (aucun garde
 * applicatif en amont dans `service-documents.ts::modifier`).
 *
 * Ce fichier prouve les deux formes réellement observées en pratique (brute ET enveloppée sous
 * `.cause`), pour ne jamais régresser silencieusement sur l'une des deux — même patron que
 * `vehicules/erreurs-contraintes.spec.ts`.
 */

const DOCUMENT_ID = 'dc4c0257-446c-4ef7-b257-2bda5548bebf';
const NUMERO = '2026-00005';

interface ErreurPgSimulee {
  readonly code: string;
  readonly table?: string;
  readonly detail?: string;
  readonly hint?: string;
}

/** Reproduit la forme réelle d'un `DatabaseError` du pilote `pg` pour un SQLSTATE personnalisé. */
function erreurPgBrute(champs: ErreurPgSimulee): Error & ErreurPgSimulee {
  const erreur = new Error(`erreur pg simulée : ${champs.code}`) as Error & ErreurPgSimulee;
  Object.assign(erreur, champs);
  return erreur;
}

/** Reproduit la forme réelle d'une `DrizzleQueryError` (`drizzle-orm/pg-core/session.js`) — LA
 *  forme observée en production, cf. commentaire de tête. */
function erreurDrizzleEnveloppee(champs: ErreurPgSimulee): Error & { cause: unknown } {
  const enveloppe = new Error('Failed query') as Error & { cause: unknown };
  enveloppe.cause = erreurPgBrute(champs);
  return enveloppe;
}

const DETAIL_TRANSITION =
  'entite=document_vente;entite_id=abc;type_document=facture;depuis=emis;vers=brouillon';
const DETAIL_VERROUILLE = 'code=document_verrouille;entite=document_vente';
const HINT_TERMINAL = '« emis » est un état terminal, aucune transition possible.';
const HINT_LISTE = 'transitions autorisées : annule, avoir.';

describe('traduireErreurTransitionDocument (ZDFA1)', () => {
  describe('forme enveloppée sous .cause (Drizzle — la forme réelle en production)', () => {
    it('traduit en DOCUMENT_TRANSITION_INTERDITE, transitions possibles listées', () => {
      const erreur = erreurDrizzleEnveloppee({
        code: 'ZDFA1',
        table: 'document_vente',
        detail: DETAIL_TRANSITION,
        hint: HINT_LISTE,
      });
      const resultat = traduireErreurTransitionDocument(erreur, DOCUMENT_ID, NUMERO);
      expect(resultat).not.toBeNull();
      expect(resultat?.code).toBe('DOCUMENT_TRANSITION_INTERDITE');
      expect(resultat?.status).toBe(409);
      expect(resultat?.actionsProposees).toEqual([{ code: 'RAFRAICHIR' }]);
      expect(resultat?.blocages).toEqual([
        {
          type: 'document_vente',
          id: DOCUMENT_ID,
          libelle: NUMERO,
          donnees: { statutActuel: 'emis', statutDemande: 'brouillon', typeDocument: 'facture' },
        },
      ]);
    });

    it('ne propose aucune action quand le hint signale un état terminal', () => {
      const erreur = erreurDrizzleEnveloppee({
        code: 'ZDFA1',
        table: 'document_vente',
        detail: DETAIL_TRANSITION,
        hint: HINT_TERMINAL,
      });
      const resultat = traduireErreurTransitionDocument(erreur, DOCUMENT_ID, NUMERO);
      expect(resultat?.actionsProposees).toEqual([]);
    });
  });

  describe('forme brute (pilote pg directement, sans passer par Drizzle)', () => {
    it('traduit également sans enveloppe .cause', () => {
      const erreur = erreurPgBrute({
        code: 'ZDFA1',
        table: 'document_vente',
        detail: DETAIL_TRANSITION,
        hint: HINT_LISTE,
      });
      expect(traduireErreurTransitionDocument(erreur, DOCUMENT_ID, NUMERO)?.code).toBe(
        'DOCUMENT_TRANSITION_INTERDITE',
      );
    });
  });

  describe('non-reconnaissance — repli sur le traitement générique de l’appelant', () => {
    it('rend null pour un autre SQLSTATE', () => {
      const erreur = erreurDrizzleEnveloppee({
        code: 'ZDFA2',
        table: 'document_vente',
        detail: DETAIL_TRANSITION,
      });
      expect(traduireErreurTransitionDocument(erreur, DOCUMENT_ID, NUMERO)).toBeNull();
    });

    it('rend null pour une autre table (ligne_document, pas concernée par ZDFA1 document)', () => {
      const erreur = erreurDrizzleEnveloppee({
        code: 'ZDFA1',
        table: 'ligne_document',
        detail: DETAIL_TRANSITION,
      });
      expect(traduireErreurTransitionDocument(erreur, DOCUMENT_ID, NUMERO)).toBeNull();
    });

    it('rend null pour un detail de forme inattendue', () => {
      const erreur = erreurDrizzleEnveloppee({
        code: 'ZDFA1',
        table: 'document_vente',
        detail: 'forme inattendue',
      });
      expect(traduireErreurTransitionDocument(erreur, DOCUMENT_ID, NUMERO)).toBeNull();
    });

    it('rend null pour une exception sans .cause ni code exploitable', () => {
      expect(traduireErreurTransitionDocument(new Error('boom'), DOCUMENT_ID, NUMERO)).toBeNull();
    });

    it('rend null pour une valeur non-objet', () => {
      expect(traduireErreurTransitionDocument('boom', DOCUMENT_ID, NUMERO)).toBeNull();
      expect(traduireErreurTransitionDocument(null, DOCUMENT_ID, NUMERO)).toBeNull();
      expect(traduireErreurTransitionDocument(undefined, DOCUMENT_ID, NUMERO)).toBeNull();
    });

    it('ne boucle jamais à l’infini sur une chaîne .cause cyclique', () => {
      const cyclique = new Error('cyclique') as Error & { cause: unknown };
      cyclique.cause = cyclique;
      expect(traduireErreurTransitionDocument(cyclique, DOCUMENT_ID, NUMERO)).toBeNull();
    });
  });
});

describe('traduireErreurVerrouillage (ZDFA2) — DOCUMENT_VERROUILLE, MD-20/MD-21', () => {
  it.each([
    ['document_vente', DETAIL_VERROUILLE],
    ['ligne_document', DETAIL_VERROUILLE],
  ] as const)('reconnaît %s enveloppé sous .cause', (table, detail) => {
    const erreur = erreurDrizzleEnveloppee({ code: 'ZDFA2', table, detail });
    const resultat = traduireErreurVerrouillage(erreur, DOCUMENT_ID, NUMERO);
    expect(resultat).not.toBeNull();
    expect(resultat?.code).toBe('DOCUMENT_VERROUILLE');
    expect(resultat?.status).toBe(409);
  });

  it('reconnaît aussi la forme brute (sans .cause)', () => {
    const erreur = erreurPgBrute({
      code: 'ZDFA2',
      table: 'document_vente',
      detail: DETAIL_VERROUILLE,
    });
    expect(traduireErreurVerrouillage(erreur, DOCUMENT_ID, NUMERO)?.code).toBe(
      'DOCUMENT_VERROUILLE',
    );
  });

  it('rend null pour une table hors périmètre', () => {
    const erreur = erreurDrizzleEnveloppee({
      code: 'ZDFA2',
      table: 'ordre_reparation',
      detail: DETAIL_VERROUILLE,
    });
    expect(traduireErreurVerrouillage(erreur, DOCUMENT_ID, NUMERO)).toBeNull();
  });

  it('rend null si le detail ne porte pas code=document_verrouille', () => {
    const erreur = erreurDrizzleEnveloppee({
      code: 'ZDFA2',
      table: 'document_vente',
      detail: 'code=autre_chose',
    });
    expect(traduireErreurVerrouillage(erreur, DOCUMENT_ID, NUMERO)).toBeNull();
  });
});

describe('traduireErreurPeriodeClose (ZDFA5) — DOCUMENT_PERIODE_CLOSE, MD-34', () => {
  it('reconnaît la forme enveloppée sous .cause', () => {
    const erreur = erreurDrizzleEnveloppee({
      code: 'ZDFA5',
      table: 'document_vente',
      detail: 'periode=2026-01',
    });
    const resultat = traduireErreurPeriodeClose(erreur, DOCUMENT_ID, NUMERO);
    expect(resultat?.code).toBe('DOCUMENT_PERIODE_CLOSE');
    expect(resultat?.status).toBe(409);
    expect(resultat?.detail).toBe('periode=2026-01');
  });

  it('reconnaît la forme brute', () => {
    const erreur = erreurPgBrute({ code: 'ZDFA5', table: 'document_vente' });
    expect(traduireErreurPeriodeClose(erreur, DOCUMENT_ID, NUMERO)?.code).toBe(
      'DOCUMENT_PERIODE_CLOSE',
    );
  });

  it('rend null pour une autre table', () => {
    const erreur = erreurDrizzleEnveloppee({ code: 'ZDFA5', table: 'ligne_document' });
    expect(traduireErreurPeriodeClose(erreur, DOCUMENT_ID, NUMERO)).toBeNull();
  });
});

describe('traduireErreurDocument — orchestration des trois traducteurs', () => {
  it('reconnaît ZDFA1 enveloppé', () => {
    const erreur = erreurDrizzleEnveloppee({
      code: 'ZDFA1',
      table: 'document_vente',
      detail: DETAIL_TRANSITION,
    });
    expect(traduireErreurDocument(erreur, DOCUMENT_ID, NUMERO)?.code).toBe(
      'DOCUMENT_TRANSITION_INTERDITE',
    );
  });

  it('reconnaît ZDFA2 enveloppé', () => {
    const erreur = erreurDrizzleEnveloppee({
      code: 'ZDFA2',
      table: 'document_vente',
      detail: DETAIL_VERROUILLE,
    });
    expect(traduireErreurDocument(erreur, DOCUMENT_ID, NUMERO)?.code).toBe('DOCUMENT_VERROUILLE');
  });

  it('reconnaît ZDFA5 enveloppé', () => {
    const erreur = erreurDrizzleEnveloppee({ code: 'ZDFA5', table: 'document_vente' });
    expect(traduireErreurDocument(erreur, DOCUMENT_ID, NUMERO)?.code).toBe(
      'DOCUMENT_PERIODE_CLOSE',
    );
  });

  it('rend null (repli générique) pour un SQLSTATE totalement étranger', () => {
    const erreur = erreurDrizzleEnveloppee({ code: '23505', table: 'document_vente' });
    expect(traduireErreurDocument(erreur, DOCUMENT_ID, NUMERO)).toBeNull();
  });
});
