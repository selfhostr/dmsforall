import { describe, expect, it, vi } from 'vitest';
import type { ReponseEnvoiMessageClient, RequeteEnvoiMessageClient } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneRegleRelance } from '../db/schema';
import { Horloge } from '../common/horloge';
import { ServiceJournal } from '../common/journal';
import type { AdaptateurNotificationSender } from '../connecteurs';
import { RegistreConnecteursService } from '../connecteurs';
import type { Config } from '../config';
import { ServiceCourriel } from '../courriel/service-courriel';
import { TransportCapture } from '../courriel/transport-capture';
import type { MessageCourriel } from '../courriel/service-courriel';
import type {
  EnveloppeCourriel,
  ResultatEnvoiCourriel,
} from '../courriel/transport-courriel.interface';

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

/** Double de `ServiceCourriel` — pour les tests qui portent sur l'ORCHESTRATION (comptage,
 *  retry, indépendance vis-à-vis du connecteur SMS), pas sur le contenu exact de l'enveloppe.
 *  Voir `chemin réel via ServiceCourriel + TransportCapture` plus bas pour la preuve que le
 *  CONTENU construit (destinataire, Reply-To, sujet, corps, langue) est correct — un double ne
 *  prouve jamais ça, seul le vrai socle courriel le peut. */
function courrielFactice(
  resultat: ResultatEnvoiCourriel = { succes: true, idMessage: 'courriel-1' },
): ServiceCourriel & { readonly appels: MessageCourriel[] } {
  const appels: MessageCourriel[] = [];
  return {
    envoyer: vi.fn(async (message: MessageCourriel) => {
      appels.push(message);
      return resultat;
    }),
    appels,
  } as unknown as ServiceCourriel & { readonly appels: MessageCourriel[] };
}

function configFactice(surcharges: Partial<Config> = {}): Config {
  return { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example', ...surcharges } as Config;
}

/** Ligne rendue par la requête de `resoudreExpediteurGarage` — un `execute` de plus dans la file
 *  dès qu'au moins une ligne `prete` existe (voir `envoyerPretes`), AVANT la première réclamation
 *  (`updateReturning`). */
function ligneExpediteurGarage(
  champs: {
    readonly raisonSociale?: string;
    readonly emailContactGarage?: string | null;
  } = {},
): readonly [{ readonly raisonSociale: string; readonly emailContactGarage: string | null }] {
  return [
    {
      raisonSociale: champs.raisonSociale ?? 'Garage Martin SA',
      emailContactGarage:
        champs.emailContactGarage === undefined
          ? 'direction@garage-martin.ch'
          : champs.emailContactGarage,
    },
  ];
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
        courrielFactice(),
        configFactice(),
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
      courrielFactice(),
      configFactice(),
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
        courrielFactice(),
        configFactice(),
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
      courrielFactice(),
      configFactice(),
    );

    const resultat = await service.planifier(CTX);
    expect(resultat).toEqual({ creees: 0, ignorees: 0, encoreATraiter: false });
    expect(restantes()).toBe(0);
  });
});

describe('ServiceRelancesFacture.envoyerPretes', () => {
  it(
    'aucun connecteur SMS actif ET aucune ligne prête → lot vide, sans jamais résoudre ' +
      'l’expéditeur garage ni tenter le moindre envoi (aucune requête superflue)',
    async () => {
      const { tx, restantes } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['sms'] })] },
        { genre: 'execute', valeur: [] }, // candidats prêts : aucun
      ]);
      const { acces } = accesFactice(tx);
      const courriel = courrielFactice();
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(null),
        horlogeFixe('2026-08-05'),
        journalFactice(),
        courriel,
        configFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });
      expect(restantes()).toBe(0);
      expect(courriel.envoyer).not.toHaveBeenCalled();
    },
  );

  it(
    'aucune facture rappel n’est due pour un dossier déjà réglé — vérifié À L’EXÉCUTION ' +
      '(§9 cas n°1/n°4) : la ligne réclamée est annulée, raison objet_traite, ZÉRO tentative ' +
      'envoyée que ce soit au connecteur SMS ou au socle courriel',
    async () => {
      const adaptateur = adaptateurFactice({
        statut: 'accepte',
        identifiantMessagePrestataire: 'x',
      });
      const courriel = courrielFactice();
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle()] }, // canaux
        { genre: 'execute', valeur: [{ id: 'relance-1' }] }, // candidats prête
        { genre: 'execute', valeur: ligneExpediteurGarage() }, // expéditeur garage
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] }, // claim
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              statut: 'emis',
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
        courriel,
        configFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 0, annulees: 1, encoreATraiter: false });
      expect(adaptateur.envoyer).not.toHaveBeenCalled();
      expect(courriel.envoyer).not.toHaveBeenCalled();
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
      const courriel = courrielFactice();
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle()] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        { genre: 'execute', valeur: ligneExpediteurGarage() },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              statut: 'emis',
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
        courriel,
        configFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 0, annulees: 1, encoreATraiter: false });
      expect(adaptateur.envoyer).not.toHaveBeenCalled();
      expect(courriel.envoyer).not.toHaveBeenCalled();
    },
  );

  it(
    'canal email : chemin complet, réclame/envoie/trace VIA LE SOCLE COURRIEL, JAMAIS via le ' +
      'connecteur NotificationSender (issue #136 — avant cette issue, aucun e-mail ne partait ' +
      'réellement, voir la doc d’en-tête de service-relances-facture.ts)',
    async () => {
      const adaptateur = adaptateurFactice({
        statut: 'accepte',
        identifiantMessagePrestataire: 'x',
      });
      const courriel = courrielFactice({ succes: true, idMessage: 'courriel-msg-1' });
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['email'] })] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        { genre: 'execute', valeur: ligneExpediteurGarage() },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              statut: 'emis',
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
        registreFactice(adaptateur), // présent mais NE DOIT JAMAIS servir : le canal est email
        horlogeFixe('2026-08-05'),
        journalFactice(),
        courriel,
        configFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);

      expect(resultat).toEqual({ envoyees: 1, echouees: 0, annulees: 0, encoreATraiter: false });
      expect(adaptateur.envoyer).not.toHaveBeenCalled();
      expect(courriel.envoyer).toHaveBeenCalledTimes(1);
      expect(courriel.appels[0]).toMatchObject({
        destinataires: ['client@example.ch'],
        nomGarage: 'Garage Martin SA',
        adresseReponseGarage: 'direction@garage-martin.ch',
      });
    },
  );

  it(
    'canal email, échec du transport courriel (rejet du socle) → repasse en prete (retenté ' +
      'plus tard), compté comme "echouee" pour CET appel, jamais le connecteur SMS sollicité',
    async () => {
      const adaptateur = adaptateurFactice({
        statut: 'accepte',
        identifiantMessagePrestataire: 'x',
      });
      const courriel = courrielFactice({ succes: false, erreur: 'boîte du destinataire pleine' });
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['email'] })] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        { genre: 'execute', valeur: ligneExpediteurGarage() },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              statut: 'emis',
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
        { genre: 'execute', valeur: [] }, // insert relance_envoi (échoué)
        { genre: 'update', valeur: undefined }, // statut repasse à 'prete'
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(adaptateur),
        horlogeFixe('2026-08-05'),
        journalFactice(),
        courriel,
        configFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 1, annulees: 0, encoreATraiter: false });
      expect(adaptateur.envoyer).not.toHaveBeenCalled();
    },
  );

  it(
    'canal sms, aucun connecteur NotificationSender actif → rejet tracé (canal_non_supporte), ' +
      'AUCUN appel réseau tenté, comptée "echouee" (retentable) — avant l’issue #136, ce cas ' +
      'empêchait même les lignes email d’être traitées, régression désormais impossible',
    async () => {
      const courriel = courrielFactice();
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['sms'] })] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        { genre: 'execute', valeur: ligneExpediteurGarage() },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              statut: 'emis',
              contentieux: false,
              statutReglement: 'non_regle',
              totalTtcCentimes: 1000,
              soldeCentimes: 1000,
              dateEcheance: '2026-06-01',
              email: null,
              telephoneE164: '+41791234567',
              plusAucunContact: false,
              langue: 'fr',
            },
          ],
        },
        { genre: 'execute', valeur: [{ n: 0 }] },
        { genre: 'execute', valeur: [] }, // insert relance_envoi (échoué)
        { genre: 'update', valeur: undefined }, // statut repasse à 'prete'
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(null), // AUCUN connecteur SMS actif
        horlogeFixe('2026-08-05'),
        journalFactice(),
        courriel,
        configFactice(),
      );

      const resultat = await service.envoyerPretes(CTX);
      expect(resultat).toEqual({ envoyees: 0, echouees: 1, annulees: 0, encoreATraiter: false });
      expect(courriel.envoyer).not.toHaveBeenCalled();
    },
  );

  it(
    'chemin RÉEL, canal email, via le vrai ServiceCourriel + TransportCapture (aucun double de ' +
      'transport — voir CONTRIBUTING.md : « un test qui mocke la couche réseau ne prouve rien ») : ' +
      'destinataire, Reply-To, nom affiché, sujet et corps sont construits correctement, dans la ' +
      'langue du client (DE)',
    async () => {
      const transportCapture = new TransportCapture(journalFactice());
      const espionTransport = vi.spyOn(transportCapture, 'envoyer');
      const serviceCourriel = new ServiceCourriel(
        transportCapture,
        configFactice({ SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' }),
        journalFactice(),
      );

      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['email'] })] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        {
          genre: 'execute',
          valeur: ligneExpediteurGarage({
            raisonSociale: 'Garage Martin SA',
            emailContactGarage: 'direction@garage-martin.ch',
          }),
        },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 2 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-42',
              statut: 'emis',
              contentieux: false,
              statutReglement: 'non_regle',
              totalTtcCentimes: 123450,
              soldeCentimes: 123450,
              dateEcheance: '2026-06-01',
              email: 'client@example.ch',
              telephoneE164: null,
              plusAucunContact: false,
              langue: 'de',
            },
          ],
        },
        { genre: 'execute', valeur: [{ n: 1 }] },
        { genre: 'execute', valeur: [] }, // insert relance_envoi
        { genre: 'update', valeur: undefined }, // statut='envoyee'
        { genre: 'execute', valeur: [] }, // update document_vente
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(null), // aucun connecteur SMS — l’email ne doit JAMAIS en dépendre
        horlogeFixe('2026-08-05'),
        journalFactice(),
        serviceCourriel,
        configFactice({ SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' }),
      );

      const resultat = await service.envoyerPretes(CTX);

      expect(resultat).toEqual({ envoyees: 1, echouees: 0, annulees: 0, encoreATraiter: false });
      expect(espionTransport).toHaveBeenCalledTimes(1);
      const enveloppe = espionTransport.mock.calls[0]?.[0] as EnveloppeCourriel;
      expect(enveloppe.destinataires).toEqual(['client@example.ch']);
      expect(enveloppe.repondreA).toBe('direction@garage-martin.ch');
      expect(enveloppe.de).toBe('no-reply@dmsforall.example');
      expect(enveloppe.nomExpediteurAffiche).toBe('Garage Martin SA via dmsforall');
      // Langue lue à l'envoi (RA-11) — le client est `de`, sujet et corps doivent l'être aussi.
      expect(enveloppe.sujet).toBe('Zahlungserinnerung — Rechnung F-42');
      expect(enveloppe.corpsTexte).toContain('Mahnung 2');
      expect(enveloppe.corpsTexte).toContain('F-42');
      expect(enveloppe.corpsTexte).toContain("1'234.50");
    },
  );

  it(
    'canal email : aucun compte direction/comptable actif pour ce tenant → repli sur ' +
      'SMTP_EXPEDITEUR pour le Reply-To (jamais un envoi bloqué faute de contact garage connu)',
    async () => {
      const courriel = courrielFactice();
      const { tx } = txFactice([
        { genre: 'select', valeur: [ligneRegle({ canaux: ['email'] })] },
        { genre: 'execute', valeur: [{ id: 'relance-1' }] },
        {
          genre: 'execute',
          valeur: ligneExpediteurGarage({
            raisonSociale: 'Garage Martin SA',
            emailContactGarage: null,
          }),
        },
        { genre: 'updateReturning', valeur: [{ id: 'relance-1', objetId: 'doc-1', palier: 1 }] },
        {
          genre: 'execute',
          valeur: [
            {
              numero: 'F-1',
              statut: 'emis',
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
        { genre: 'execute', valeur: [] },
      ]);
      const { acces } = accesFactice(tx);
      const service = new ServiceRelancesFacture(
        acces,
        registreFactice(null),
        horlogeFixe('2026-08-05'),
        journalFactice(),
        courriel,
        configFactice({ SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' }),
      );

      await service.envoyerPretes(CTX);

      expect(courriel.appels[0]?.adresseReponseGarage).toBe('no-reply@dmsforall.example');
    },
  );
});
