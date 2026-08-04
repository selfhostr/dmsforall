import { describe, expect, it, vi } from 'vitest';
import type { EntreeCreationPaiement } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import { Horloge } from '../../common/horloge/horloge';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../../common/idempotence';
import { ServicePaiement } from './service-paiement';

/**
 * Défaut confirmé à l'audit (2026-08-04) : ressaisir un paiement avec un
 * `identifiantTransactionBanque` déjà enregistré ressortait en `500 ERREUR_INTERNE` au lieu du
 * `409 CONFLIT` attendu — reproduit en conditions réelles (deux `POST /paiements` avec le même
 * `identifiantTransactionBanque`, `Idempotency-Key` distinctes).
 *
 * Cause : `estViolationUnicite` lisait `erreur.code` DIRECTEMENT sur l'objet intercepté — mais
 * Drizzle (`pg-core/session.js`) enveloppe systématiquement l'erreur `pg` brute (SQLSTATE `23505`
 * sur `identifiant_transaction_banque`) dans une `DrizzleQueryError` qui porte `code` sous
 * `.cause`, jamais en surface. Ce fichier prouve les deux formes réellement observées en pratique
 * (brute ET enveloppée), pour ne jamais régresser silencieusement sur l'une des deux — même patron
 * que `vehicules/erreurs-contraintes.spec.ts`.
 */

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

const ENTREE: EntreeCreationPaiement = {
  siteId: 's1',
  dateValeur: '2026-08-04',
  moyen: 'virement',
  montantCentimes: 1000,
  devise: 'CHF',
  payeurClientId: null,
  payeurLibelle: 'Audit Doublon',
  identifiantTransactionBanque: 'AUDIT-DUP-1',
  imputations: [],
};

/** Reproduit la forme réelle d'un `DatabaseError` du pilote `pg` pour une violation `unique`. */
function erreurPgBrute23505(): Error & { code: string; constraint: string } {
  const erreur = new Error('duplicate key value violates unique constraint') as Error & {
    code: string;
    constraint: string;
  };
  erreur.code = '23505';
  erreur.constraint = 'paiement_identifiant_transaction_banque_uk';
  return erreur;
}

/** Reproduit la forme réelle d'une `DrizzleQueryError` (`drizzle-orm/pg-core/session.js`) — LA
 *  forme observée en production. */
function erreurDrizzleEnveloppee23505(): Error & { cause: unknown } {
  const enveloppe = new Error('Failed query') as Error & { cause: unknown };
  enveloppe.cause = erreurPgBrute23505();
  return enveloppe;
}

/** Fausse transaction : `insert(paiement).values()` lève `erreurInsertion` si fournie, sinon rend
 *  `ligneRetournee` via `.returning()` — même patron que `pieces/service-mouvement.spec.ts`. */
function txFactice(options: { erreurInsertion?: unknown; ligneRetournee?: unknown } = {}) {
  const tx = {
    insert: (_table: unknown) => ({
      values: (_vals: Record<string, unknown>) => ({
        returning: () => {
          if (options.erreurInsertion) return Promise.reject(options.erreurInsertion);
          return Promise.resolve(options.ligneRetournee ? [options.ligneRetournee] : []);
        },
      }),
    }),
  };
  return tx as unknown as TransactionDfa;
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

function idempotenceFactice(tx: TransactionDfa): ServiceIdempotence {
  return {
    async executer<T extends ReponseMemorisable>(
      _ctx: ContexteTenant,
      _requete: RequeteIdempotente,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<ResultatIdempotent<T>> {
      const reponse = await travail(tx);
      return { reponse, rejoue: false };
    },
  };
}

describe('ServicePaiement.creer — 23505 sur identifiant_transaction_banque → CONFLIT (409)', () => {
  it('traduit la forme enveloppée sous .cause (Drizzle — la forme réelle en production)', async () => {
    const tx = txFactice({ erreurInsertion: erreurDrizzleEnveloppee23505() });
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());

    await expect(service.creer(CTX, ENTREE, 'idem-1')).rejects.toMatchObject({
      code: 'CONFLIT',
      status: 409,
    });
  });

  it('traduit également la forme brute (pilote pg directement, sans passer par Drizzle)', async () => {
    const tx = txFactice({ erreurInsertion: erreurPgBrute23505() });
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());

    await expect(service.creer(CTX, ENTREE, 'idem-2')).rejects.toMatchObject({
      code: 'CONFLIT',
      status: 409,
    });
  });

  it('relance telle quelle une erreur qui ne porte aucun SQLSTATE 23505 exploitable', async () => {
    const tx = txFactice({ erreurInsertion: new Error('boom, sans rapport') });
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());

    await expect(service.creer(CTX, ENTREE, 'idem-3')).rejects.toThrow('boom, sans rapport');
  });

  it('ne boucle jamais à l’infini sur une chaîne .cause cyclique', async () => {
    const cyclique = new Error('cyclique') as Error & { cause: unknown };
    cyclique.cause = cyclique;
    const tx = txFactice({ erreurInsertion: cyclique });
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());

    await expect(service.creer(CTX, ENTREE, 'idem-4')).rejects.toThrow('cyclique');
  });
});
