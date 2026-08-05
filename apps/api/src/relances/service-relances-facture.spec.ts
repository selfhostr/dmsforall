import { describe, expect, it, vi } from 'vitest';
import type { ReponseEnvoiMessageClient, RequeteEnvoiMessageClient } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneRegleRelance } from '../db/schema';
import { Horloge } from '../common/horloge';
import { ServiceJournal } from '../common/journal';
import type { AdaptateurNotificationSender } from '../connecteurs';
import { RegistreConnecteursService } from '../connecteurs';

import { ServiceRelancesFacture } from './service-relances-facture';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneRegle(champs: Partial<LigneRegleRelance> = {}): LigneRegleRelance {
  return {
    id: 'regle-1',
    tenantId: 'tid-1',
    typeRelance: 'facture_echue',
    actif: true,
    delaisJours: [7, 15],
    canaux: ['email'],
    texteModeleId: null,
    prereglageAppliqueLe: null,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
    ...champs,
  } as LigneRegleRelance;
}

/**
 * Chaînable universel : réagit à `.from/.where/.orderBy/.set/.values/.onConflictDoNothing` en se
 * rendant lui-même (poursuite de chaîne), et se résout (`.returning()` OU `await` direct via
 * `.then`) sur `valeur` — même valeur quel que soit le chemin emprunté par le vrai code, puisque
 * dans un test donné le CODE RÉEL n'emprunte jamais les deux à la fois pour un même appel.
 */
function chainable<T>(valeur: T): PromiseLike<T> & Record<string, (...args: unknown[]) => unknown> {
  const objet: Record<string, (...args: unknown[]) => unknown> = {
    from: () => objet,
    where: () => objet,
    orderBy: () => objet,
    set: () => objet,
    values: () => objet,
    onConflictDoNothing: () => objet,
    onConflictDoUpdate: () => objet,
    returning: () => Promise.resolve(valeur),
  };
  return Object.assign(objet, {
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(valeur).then(resolve, reject),
  }) as PromiseLike<T> & Record<string, (...args: unknown[]) => unknown>;
}

/** File d'étapes consommées STRICTEMENT dans l'ordre où le service les déclenche — même patron
 *  que `txFactice` de `pieces/service-parametrage-pieces.spec.ts`, étendu à `execute()` (SQL
 *  brut) en plus de `select`/`update`. Un genre qui ne correspond pas fait échouer le test avec
 *  un message explicite plutôt qu'un mauvais résultat silencieux. */
type Genre = 'select' | 'execute' | 'updateReturning' | 'update' | 'insertReturning';
interface Etape {
  readonly genre: Genre;
  readonly valeur: unknown;
}

function txFactice(etapes: readonly Etape[]) {
  const file = [...etapes];
  function prochaine(genre: Genre): unknown {
    const etape = file.shift();
    if (!etape) {
      throw new Error(`txFactice : file épuisée, appel inattendu de genre "${genre}".`);
    }
    if (etape.genre !== genre) {
      throw new Error(`txFactice : attendu genre "${etape.genre}", appelé avec "${genre}".`);
    }
    return etape.valeur;
  }

  const tx = {
    select: () => chainable(prochaine('select')),
    execute: () => Promise.resolve({ rows: prochaine('execute') }),
    insert: () => chainable(prochaine('insertReturning')),
    update: () => {
      // `.returning()` OU un `await` direct décident du genre au moment où l'un des deux est
      // effectivement invoqué — on ne sait pas encore lequel ici, donc on réserve les DEUX
      // lectures possibles sur la MÊME étape de la file (voir `chainableUpdate` ci-dessous).
      let consomme: { genre: Genre; valeur: unknown } | null = null;
      const consommer = (genre: Genre) => {
        if (!consomme) {
          consomme = { genre, valeur: prochaine(genre) };
        }
        return consomme.valeur;
      };
      const objet: Record<string, (...args: unknown[]) => unknown> = {
        set: () => objet,
        where: () => objet,
        returning: () => Promise.resolve(consommer('updateReturning')),
      };
      return Object.assign(objet, {
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(consommer('update')).then(resolve, reject),
      });
    },
  };
  return { tx: tx as unknown as TransactionDfa, restantes: () => file.length };
}

function accesFactice(tx: TransactionDfa): { acces: AccesBase; appels: ContexteTenant[] } {
  const appels: ContexteTenant[] = [];
  const acces: AccesBase = {
    enTenant: vi.fn((ctx, travail) => {
      appels.push(ctx);
      return travail(tx);
    }),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
  return { acces, appels };
}

function journalFactice(): ServiceJournal {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ServiceJournal;
}

function horlogeFixe(date: string): Horloge {
  return { maintenant: () => new Date(date) } as unknown as Horloge;
}

function registreFactice(
  adaptateur: AdaptateurNotificationSender | null,
): RegistreConnecteursService {
  return {
    resoudre: vi.fn(async () => (adaptateur ? { adaptateur, activation: {} } : null)),
  } as unknown as RegistreConnecteursService;
}

function adaptateurFactice(
  reponse: ReponseEnvoiMessageClient,
): AdaptateurNotificationSender & { readonly appels: RequeteEnvoiMessageClient[] } {
  const appels: RequeteEnvoiMessageClient[] = [];
  return {
    nomInterface: 'NotificationSender',
    typeConnecteurCode: 'factice_test',
    appels,
    executer: vi.fn(),
    envoyer: vi.fn(async (requete: RequeteEnvoiMessageClient) => {
      appels.push(requete);
      return reponse;
    }),
  } as unknown as AdaptateurNotificationSender & { readonly appels: RequeteEnvoiMessageClient[] };
}

describe('ServiceRelancesFacture.planifier — RA-05 (idempotence)', () => {
  it(
    'aucune règle configurée (ou inactive) → rien à planifier, AUCUNE lecture de document ' +
      '(fail-closed, un seul select consommé)',
    async () => {
      const { tx, restantes } = txFactice([{ genre: 'select', valeur: [] }]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(null),
        horlogeFixe('2026-08-05'),
        journalFactice(),
      );

      const resultat = await service.planifier(CTX);

      expect(resultat).toEqual({ creees: 0, ignorees: 0, encoreATraiter: false });
      expect(restantes()).toBe(0);
    },
  );

  it('règle active, un document échu, palier dû → une ligne créée', async () => {
    const document = {
      id: 'doc-1',
      clientId: 'client-1',
      dateEcheance: '2026-07-01',
      email: 'client@example.ch',
      telephoneE164: null,
    };
    const { tx } = txFactice([
      { genre: 'select', valeur: [ligneRegle({ delaisJours: [7], canaux: ['email'] })] },
      { genre: 'execute', valeur: [document] },
      { genre: 'insertReturning', valeur: [{ id: 'relance-1' }] }, // insert…onConflictDoNothing().returning()
    ]);
    const { acces } = accesFactice(tx);
    const service = new ServiceRelancesFacture(
      acces,
      registreFactice(null),
      horlogeFixe('2026-07-10'),
      journalFactice(),
    );

    const resultat = await service.planifier(CTX);
    expect(resultat).toEqual({ creees: 1, ignorees: 0, encoreATraiter: false });
  });

  it(
    'rejouer la MÊME planification (redémarrage du job, §9 cas n°7) : le palier a déjà été ' +
      'créé, `ON CONFLICT DO NOTHING` ne renvoie plus de ligne → creees=0, ignorees=1, JAMAIS une ' +
      'deuxième ligne pour le même palier',
    async () => {
      const document = {
        id: 'doc-1',
        clientId: 'client-1',
        dateEcheance: '2026-07-01',
        email: 'client@example.ch',
        telephoneE164: null,
      };
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ delaisJours: [7], canaux: ['email'] })] },
        { genre: 'execute', valeur: [document] },
        { genre: 'insertReturning', valeur: [] }, // ON CONFLICT DO NOTHING : rien inséré, déjà présent.
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(null),
        horlogeFixe('2026-07-10'),
        journalFactice(),
      );

      const resultat = await service.planifier(CTX);
      expect(resultat).toEqual({ creees: 0, ignorees: 1, encoreATraiter: false });
    },
  );

  it('aucun document candidat → aucune tentative d’insertion (queue épuisée sans erreur)', async () => {
    const { tx, restantes } = txFactice([
      { genre: 'select', valeur: [ligneRegle()] },
      { genre: 'execute', valeur: [] },
    ]);
    const { acces } = accesFactice(tx);
    const service = new ServiceRelancesFacture(
      acces,
      registreFactice(null),
      horlogeFixe('2026-07-10'),
      journalFactice(),
    );

    const resultat = await service.planifier(CTX);
    expect(resultat).toEqual({ creees: 0, ignorees: 0, encoreATraiter: false });
    expect(restantes()).toBe(0);
  });
});

describe('ServiceRelancesFacture.envoyerPretes', () => {
  it('aucun connecteur NotificationSender actif → lot vide, JAMAIS d’accès base (RegistreConnecteursService.resoudre rend null, cas normal)', async () => {
    const { tx } = txFactice([]);
    const { acces } = accesFactice(tx);
    const service = new ServiceRelancesFacture(
      acces,
      registreFactice(null),
      horlogeFixe('2026-08-05'),
      journalFactice(),
    );

    const resultat = await service.envoyerPretes(CTX);
    expect(resultat).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it(
    'aucune facture rappel n’est due pour un dossier déjà réglé — vérifié À L’EXÉCUTION ' +
      '(§9 cas n°1/n°4) : la ligne réclamée est annulée, raison objet_traite, ZÉRO tentative ' +
      'envoyée au connecteur',
    async () => {
      const adaptateur = adaptateurFactice({
        statut: 'accepte',
        identifiantMessagePrestataire: 'x',
      });
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle()] }, // canaux
        { genre: 'execute', valeur: [{ id: 'relance-1' }] }, // candidats prête
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] }, // claim
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              contentieux: false,
              statutReglement: 'regle', // ← réglé entre-temps
              totalTtcCentimes: 1000,
              soldeCentimes: 0,
              dateEcheance: '2026-06-01',
              email: 'client@example.ch',
              telephoneE164: null,
              plusAucunContact: false,
              langue: 'fr',
            },
          ],
        },
        { genre: 'update', valeur: undefined }, // set statut='annulee'
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(adaptateur),
        horlogeFixe('2026-08-05'),
        journalFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 0, annulees: 1, encoreATraiter: false });
      expect(adaptateur.envoyer).not.toHaveBeenCalled();
    },
  );

  it(
    'RA-14 : un client "plus aucun contact" bloque l’envoi même si la facture reste due ' +
      '(§9 cas n°8)',
    async () => {
      const adaptateur = adaptateurFactice({
        statut: 'accepte',
        identifiantMessagePrestataire: 'x',
      });
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle()] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              contentieux: false,
              statutReglement: 'non_regle',
              totalTtcCentimes: 1000,
              soldeCentimes: 1000,
              dateEcheance: '2026-06-01',
              email: 'client@example.ch',
              telephoneE164: null,
              plusAucunContact: true,
              langue: 'fr',
            },
          ],
        },
        { genre: 'update', valeur: undefined },
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(adaptateur),
        horlogeFixe('2026-08-05'),
        journalFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 0, annulees: 1, encoreATraiter: false });
      expect(adaptateur.envoyer).not.toHaveBeenCalled();
    },
  );

  it(
    'chemin complet : réclame, envoie, trace — envoyees=1, cleIdempotence = ' +
      '"<id>:<tentative>" (RA-05 côté connecteur, notification-sender.ts décision 2)',
    async () => {
      const adaptateur = adaptateurFactice({
        statut: 'accepte',
        identifiantMessagePrestataire: 'msg-1',
      });
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['email'] })] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              contentieux: false,
              statutReglement: 'non_regle',
              totalTtcCentimes: 1000,
              soldeCentimes: 1000,
              dateEcheance: '2026-06-01',
              email: 'client@example.ch',
              telephoneE164: null,
              plusAucunContact: false,
              langue: 'fr',
            },
          ],
        },
        { genre: 'execute', valeur: [{ n: 0 }] }, // count(*) des tentatives déjà tracées
        { genre: 'execute', valeur: [] }, // insert relance_envoi
        { genre: 'update', valeur: undefined }, // statut='envoyee'
        { genre: 'execute', valeur: [] }, // update document_vente relance_niveau/relance_le
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(adaptateur),
        horlogeFixe('2026-08-05'),
        journalFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);

      expect(resultat).toEqual({ envoyees: 1, echouees: 0, annulees: 0, encoreATraiter: false });
      expect(adaptateur.envoyer).toHaveBeenCalledTimes(1);
      expect(adaptateur.appels[0]?.cleIdempotence).toBe('relance-1:1');
    },
  );

  it(
    'échec du connecteur, tentatives non épuisées → repasse en prete (retenté plus tard), ' +
      'compté comme "echouee" pour CET appel (§6.1 : rejoue le MÊME enregistrement, jamais une ' +
      'deuxième ligne)',
    async () => {
      const adaptateur = adaptateurFactice({
        statut: 'rejete',
        raison: 'destinataire_invalide',
        message: 'adresse invalide',
      });
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['email'] })] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              contentieux: false,
              statutReglement: 'non_regle',
              totalTtcCentimes: 1000,
              soldeCentimes: 1000,
              dateEcheance: '2026-06-01',
              email: 'client@example.ch',
              telephoneE164: null,
              plusAucunContact: false,
              langue: 'fr',
            },
          ],
        },
        { genre: 'execute', valeur: [{ n: 0 }] },
        { genre: 'execute', valeur: [] },
        { genre: 'update', valeur: undefined },
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(adaptateur),
        horlogeFixe('2026-08-05'),
        journalFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 1, annulees: 0, encoreATraiter: false });
    },
  );
});
