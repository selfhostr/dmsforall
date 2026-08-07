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

/**
 * Issue #9, GitHub — « un paiement negatif credite une facture » : `POST /paiements` avec
 * `montantCentimes: -500` rendait 201, et le calcul en aval (`mappeurs.ts`, corrigé séparément)
 * traitait ce -500 comme +500 « disponible », imputable sur une vraie facture. BARRIÈRE 1/3 :
 * cette méthode `creer()` — le SEUL chemin qui écrit un paiement à la demande d'un appelant
 * externe — refuse maintenant tout montant non strictement positif, AVANT toute écriture en base
 * (`tx.insert` n'est jamais atteint : voir `txFactice()` sans `ligneRetournee`, qui ferait échouer
 * le test s'il fallait insérer quoi que ce soit).
 */
describe('ServicePaiement.creer — issue #9 : un montant non positif est refusé (barrière 1/3)', () => {
  it('rejette un montant négatif avec VALIDATION_ECHOUEE, code montant_negatif — jamais un 201', async () => {
    const tx = txFactice(); // aucune insertion ne doit être tentée.
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());
    const entreeNegative: EntreeCreationPaiement = { ...ENTREE, montantCentimes: -500 };

    await expect(service.creer(CTX, entreeNegative, 'idem-neg-1')).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      status: 400,
    });
  });

  it('le message d’erreur oriente explicitement vers /paiements/{id}/rembourser, pas une correction en place', async () => {
    const tx = txFactice();
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());
    const entreeNegative: EntreeCreationPaiement = { ...ENTREE, montantCentimes: -500 };

    await expect(service.creer(CTX, entreeNegative, 'idem-neg-2')).rejects.toMatchObject({
      erreurs: [expect.objectContaining({ champ: 'montantCentimes', code: 'montant_negatif' })],
    });
  });

  it('rejette toujours un montant nul (comportement préexistant, non régressé)', async () => {
    const tx = txFactice();
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());
    const entreeNulle: EntreeCreationPaiement = { ...ENTREE, montantCentimes: 0 };

    await expect(service.creer(CTX, entreeNulle, 'idem-nul-1')).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      erreurs: [expect.objectContaining({ champ: 'montantCentimes', code: 'montant_nul' })],
    });
  });

  it('un montant strictement positif reste accepté (non-régression)', async () => {
    const tx = txFactice({
      ligneRetournee: {
        id: 'pmt-pos-1',
        tenantId: CTX.tenantId,
        siteId: ENTREE.siteId,
        dateValeur: ENTREE.dateValeur,
        moyen: ENTREE.moyen,
        montantCentimes: 1000n,
        devise: 'CHF',
        payeurClientId: null,
        payeurLibelle: ENTREE.payeurLibelle,
        referenceQr: null,
        identifiantTransactionBanque: null,
        source: 'manuel',
        contrePasseId: null,
        exporteLe: null,
        exportId: null,
        // `null`, pas `CTX.utilisateurId` : évite d'avoir à mocker `tx.select()` pour
        // `chargerResumesUtilisateurs` (`paiement-requetes.ts`) — hors de ce que ce test vérifie
        // (barrière 1/3 sur le signe du montant, pas la résolution des auteurs).
        creeParId: null,
        creeLe: new Date('2026-08-04T10:00:00.000Z'),
        modifieLe: new Date('2026-08-04T10:00:00.000Z'),
      },
    });
    const service = new ServicePaiement(accesFactice(tx), idempotenceFactice(tx), new Horloge());

    const resultat = await service.creer(CTX, ENTREE, 'idem-pos-1');

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.donnees.montantCentimes).toBe(1000);
    expect(resultat.reponse.corps.donnees.montantNonImputeCentimes).toBe(1000);
  });
});
