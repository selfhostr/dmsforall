import { GRILLE_VIDE, MODULES_APP, PREREGLAGES } from '@dfa/shared';
import { colonnesDepuisGrille } from '../grille-utilisateur';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { Config } from '../../config/config.types';
import type { AccesAmorcage, AccesBase, UtilisateurAmorcage } from '../../db/db.types';
import {
  session as tableSession,
  site as tableSite,
  tenant as tableTenant,
  utilisateur as tableUtilisateur,
} from '../../db/schema';
import type { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import type { ServiceLimitationDebit } from '../../common/limitation/limitation-debit.types';
import { MATRICE_DROITS } from '../matrice-droits';
import { ServiceAuthentificationImpl } from './authentification.service';
import type { ServiceMotDePasse, ServiceSession } from '../auth.types';
import {
  ErreurCompteSuspendu,
  ErreurCompteVerrouille,
  ErreurIdentifiantsInvalides,
  ErreurTenantSuspendu,
  ErreurTropDeTentatives,
} from '../erreurs-auth';

function configTest(overrides: Partial<Config> = {}): Config {
  return {
    LIMITE_CONNEXION_IP: 20,
    LIMITE_CONNEXION_COMPTE: 15,
    LIMITE_FENETRE_SECONDES: 900,
    SEUIL_VERROUILLAGE_COMPTE: 5,
    ...overrides,
  } as Config;
}

function utilisateurTest(overrides: Partial<UtilisateurAmorcage> = {}): UtilisateurAmorcage {
  return {
    id: 'utilisateur-id',
    tenantId: 'tenant-id',
    email: 'garage@example.ch',
    motDePasseHash: '$argon2id$v=19$m=19456,t=2,p=1$...',
    statut: 'actif',
    statutTenant: 'actif',
    role: 'admin',
    langue: 'fr',
    echecsConnexion: 0,
    verrouilleJusquA: null,
    ...overrides,
  };
}

/** Requête Drizzle simulée : thenable + `.orderBy()` chainable, pour couvrir `sessionCourante()`. */
function requeteMock<T>(resultat: readonly T[]) {
  const promesse = Promise.resolve(resultat);
  return Object.assign(promesse, { orderBy: () => requeteMock(resultat) });
}

function accesBaseTest(modulesDesactives: readonly string[] = []): AccesBase {
  const donnees = {
    utilisateur: {
      id: 'utilisateur-id',
      email: 'garage@example.ch',
      prenom: 'Jean',
      nom: 'Dupont',
      role: 'admin',
      langue: 'fr',
      // Compte de personne : aucun rattachement de site (migration 0039) — `sessionCourante()`
      // rend alors TOUS les sites du tenant, comportement inchangé depuis l'étape 0.
      siteId: null,
      ...colonnesDepuisGrille(PREREGLAGES.admin.grille),
    },
    tenant: {
      id: 'tenant-id',
      slug: 'garage-dupont',
      raisonSociale: 'Garage Dupont Sàrl',
      langueDefaut: 'fr',
      modulesDesactives,
    },
    sites: [{ id: 'site-id', code: 'SION', nom: 'Sion', actif: true }],
    session: { expireLe: new Date('2026-07-28T12:00:00.000Z') },
  };

  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === tableUtilisateur) return requeteMock([donnees.utilisateur]);
          if (table === tableTenant) return requeteMock([donnees.tenant]);
          if (table === tableSite) return requeteMock(donnees.sites);
          if (table === tableSession) return requeteMock([donnees.session]);
          throw new Error('Table inattendue dans le mock de test.');
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
  };

  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

function contexteTest(): ServiceContexteRequete {
  return {
    actuelOuNull: () => ({
      requeteId: 'requete-id',
      ip: '203.0.113.9',
      userAgent: 'agent-test',
    }),
  } as unknown as ServiceContexteRequete;
}

describe('ServiceAuthentificationImpl.connecter', () => {
  let servicePwd: ServiceMotDePasse;
  let serviceSession: ServiceSession;
  let accesAmorcage: AccesAmorcage;
  let limiteur: ServiceLimitationDebit;

  beforeEach(() => {
    servicePwd = {
      hacher: vi.fn().mockResolvedValue('$argon2id$nouveau'),
      verifier: vi.fn().mockResolvedValue(true),
      verifierLeurre: vi.fn().mockResolvedValue(undefined),
      doitEtreRehache: vi.fn().mockReturnValue(false),
    };
    serviceSession = {
      ouvrir: vi.fn().mockResolvedValue({
        tokenClair: 'jeton-clair',
        sessionId: 'session-id',
        expireLe: new Date('2026-07-28T12:00:00.000Z'),
      }),
      resoudre: vi.fn(),
      fermer: vi.fn().mockResolvedValue(undefined),
    };
    accesAmorcage = {
      utilisateurParEmail: vi.fn().mockResolvedValue(utilisateurTest()),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn().mockResolvedValue(undefined),
      reinitialiserEchecsConnexion: vi.fn().mockResolvedValue(undefined),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
    limiteur = {
      consommer: vi.fn().mockResolvedValue({ autorise: true, resteSecondes: 0 }),
    };
  });

  function service(config: Config = configTest()): ServiceAuthentificationImpl {
    return new ServiceAuthentificationImpl(
      config,
      accesBaseTest(),
      accesAmorcage,
      servicePwd,
      serviceSession,
      limiteur,
      contexteTest(),
    );
  }

  it('email inconnu et mot de passe faux rendent EXACTEMENT la même erreur (anti-énumération)', async () => {
    // Cas A : email inconnu.
    accesAmorcage.utilisateurParEmail = vi.fn().mockResolvedValue(null);
    const erreurEmailInconnu = await service()
      .connecter({ email: 'inconnu@example.ch', motDePasse: 'peu-importe' }, '203.0.113.1', 'ua')
      .catch((e: unknown) => e);

    // Cas B : email connu, mauvais mot de passe.
    accesAmorcage.utilisateurParEmail = vi.fn().mockResolvedValue(utilisateurTest());
    servicePwd.verifier = vi.fn().mockResolvedValue(false);
    const erreurMotDePasseFaux = await service()
      .connecter({ email: 'garage@example.ch', motDePasse: 'mauvais' }, '203.0.113.1', 'ua')
      .catch((e: unknown) => e);

    expect(erreurEmailInconnu).toBeInstanceOf(ErreurIdentifiantsInvalides);
    expect(erreurMotDePasseFaux).toBeInstanceOf(ErreurIdentifiantsInvalides);
    expect((erreurEmailInconnu as ErreurIdentifiantsInvalides).getStatus()).toBe(
      (erreurMotDePasseFaux as ErreurIdentifiantsInvalides).getStatus(),
    );
    expect((erreurEmailInconnu as ErreurIdentifiantsInvalides).getResponse()).toEqual(
      (erreurMotDePasseFaux as ErreurIdentifiantsInvalides).getResponse(),
    );
  });

  it('appelle verifierLeurre() (jamais verifier()) quand l’email est inconnu', async () => {
    accesAmorcage.utilisateurParEmail = vi.fn().mockResolvedValue(null);

    await expect(
      service().connecter({ email: 'inconnu@example.ch', motDePasse: 'x' }, null, null),
    ).rejects.toBeInstanceOf(ErreurIdentifiantsInvalides);

    expect(servicePwd.verifierLeurre).toHaveBeenCalledOnce();
    expect(servicePwd.verifier).not.toHaveBeenCalled();
  });

  // Finding sécurité #3 : le verrouillage n'est révélé (423) que si le mot de passe fourni est
  // correct — sinon (peu importe l'état de verrouillage) l'attaquant reçoit EXACTEMENT le même
  // 401 générique, et paie systématiquement le coût Argon2 réel. Voir aussi les deux tests
  // dédiés au finding #3 plus bas dans ce describe.
  it('compte déjà verrouillé + mot de passe CORRECT : 423, mot de passe vérifié malgré tout', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ verrouilleJusquA: new Date(Date.now() + 60_000) }));
    servicePwd.verifier = vi.fn().mockResolvedValue(true);

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'bon' }, null, null),
    ).rejects.toBeInstanceOf(ErreurCompteVerrouille);

    expect(servicePwd.verifier).toHaveBeenCalledOnce();
    expect(serviceSession.ouvrir).not.toHaveBeenCalled();
  });

  it('compte déjà verrouillé + mot de passe FAUX : même 401 générique qu’un compte non verrouillé (pas de fuite du 423)', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ verrouilleJusquA: new Date(Date.now() + 60_000) }));
    servicePwd.verifier = vi.fn().mockResolvedValue(false);

    const erreur = await service()
      .connecter({ email: 'garage@example.ch', motDePasse: 'faux' }, null, null)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurIdentifiantsInvalides);
    expect(erreur).not.toBeInstanceOf(ErreurCompteVerrouille);
    // Coût Argon2 payé malgré le verrouillage préexistant — c'est précisément ce qui égalise la
    // latence avec la branche « compte non verrouillé, mauvais mot de passe ».
    expect(servicePwd.verifier).toHaveBeenCalledOnce();
  });

  it('rejette avec 429 quand la limitation de débit par IP est dépassée, sans requêter la base', async () => {
    limiteur.consommer = vi.fn().mockResolvedValueOnce({ autorise: false, retryApresSecondes: 42 });

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'x' }, '203.0.113.1', null),
    ).rejects.toBeInstanceOf(ErreurTropDeTentatives);

    expect(accesAmorcage.utilisateurParEmail).not.toHaveBeenCalled();
  });

  // Bloquant B2 (rapport QA étape 0) : le budget par email n'est plus consulté qu'APRÈS un échec
  // de vérification — jamais avant, jamais sur une tentative qui va réussir. On simule donc ici
  // un mot de passe FAUX (la seule façon d'atteindre ce budget) pour prouver qu'il reste
  // effectif contre le devinage de mot de passe.
  it('rejette avec 429 quand la limitation de débit par email est dépassée (après un échec de mot de passe)', async () => {
    servicePwd.verifier = vi.fn().mockResolvedValue(false);
    limiteur.consommer = vi
      .fn()
      .mockResolvedValueOnce({ autorise: true, resteSecondes: 0 }) // IP
      .mockResolvedValueOnce({ autorise: false, resteSecondes: 7 }); // email, consommé après l'échec

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'faux' }, '203.0.113.1', null),
    ).rejects.toBeInstanceOf(ErreurTropDeTentatives);
  });

  // Bloquant B2 (rapport QA étape 0) : sur des postes partagés d'atelier, plusieurs connexions
  // RÉUSSIES en peu de temps sont l'usage normal, pas une attaque. Une connexion réussie ne doit
  // ni consulter ni consommer le budget par email — seul le budget par IP, inconditionnel, est
  // sollicité.
  it('B2 — une connexion réussie ne consulte ni ne consomme jamais le budget de débit par email', async () => {
    await service().connecter(
      { email: 'garage@example.ch', motDePasse: 'bon' },
      '203.0.113.1',
      'ua-test',
    );

    expect(limiteur.consommer).toHaveBeenCalledTimes(1);
    expect(limiteur.consommer).toHaveBeenCalledWith('auth:connexion:ip:203.0.113.1', 20, 900);
  });

  // Bloquant B1 (rapport QA étape 0) : avant correction, `verifierLimitationDebit()` consommait
  // inconditionnellement le budget par email en tout PREMIER, avant même la vérification du mot
  // de passe — la 6e requête (mot de passe enfin correct, après 5 échecs ayant déjà épuisé le
  // budget par défaut) tombait donc systématiquement sur 429 avant d'atteindre le code qui rend
  // 423. Le fond de la correction : le budget par email n'est plus consulté DU TOUT sur le
  // chemin de succès (voir le test B2 ci-dessus) — la vérification du verrouillage reste donc
  // TOUJOURS atteignable, quel que soit l'état du budget Redis par email.
  it('B1 — compte déjà verrouillé + mot de passe CORRECT : 423, même si le budget de débit par email seraît épuisé', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ verrouilleJusquA: new Date(Date.now() + 60_000) }));
    servicePwd.verifier = vi.fn().mockResolvedValue(true);
    // Si le budget par email était encore consulté sur ce chemin, cette réponse « refusé »
    // ferait échouer le test avec un 429 au lieu du 423 attendu.
    limiteur.consommer = vi.fn().mockResolvedValue({ autorise: false, resteSecondes: 1 });

    const erreur = await service()
      .connecter({ email: 'garage@example.ch', motDePasse: 'bon' }, null, null)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurCompteVerrouille);
  });

  // Bloquant B1 (rapport QA étape 0) : le seuil de verrouillage n'était pas configurable
  // (constante interne `SEUIL_VERROUILLAGE = 5`). Il l'est désormais via
  // `SEUIL_VERROUILLAGE_COMPTE`, distinct de `LIMITE_CONNEXION_COMPTE` (voir `charger-config.ts`).
  it('B1 — le seuil de verrouillage est configurable via SEUIL_VERROUILLAGE_COMPTE', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ echecsConnexion: 2 }));
    servicePwd.verifier = vi.fn().mockResolvedValue(false);

    await expect(
      service(configTest({ SEUIL_VERROUILLAGE_COMPTE: 3 })).connecter(
        { email: 'garage@example.ch', motDePasse: 'faux' },
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(ErreurIdentifiantsInvalides);

    const [, verrouilleJusquA] = (
      accesAmorcage.enregistrerEchecConnexion as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, Date | null];
    // 3e échec avec un seuil réglé à 3 : le compte doit déjà être verrouillé (contre un seuil
    // par défaut de 5, où ce 3e échec ne verrouillerait pas encore).
    expect(verrouilleJusquA).not.toBeNull();
    expect((verrouilleJusquA as Date).getTime()).toBeGreaterThan(Date.now());
  });

  // Bug distinct signalé avec B1 (rapport QA étape 0) : `u.verrouilleJusquA` est contractuellement
  // `Date | null`, mais un pilote SQL peut renvoyer une chaîne ISO brute sur ce chemin d'amorçage
  // non typé par Drizzle. Sans coercition défensive, `.getTime()` lève un `TypeError` NON typé,
  // capturé comme `500 ERREUR_INTERNE` au lieu du `423 AUTH_COMPTE_VERROUILLE` attendu — sur le
  // chemin de sécurité qui vérifie le verrouillage. `versDateOuNull()` neutralise ce cas.
  it('verrouilleJusquA reçu comme chaîne ISO brute (pilote SQL non garanti) rend 423, pas 500', async () => {
    const dateFuture = new Date(Date.now() + 60_000);
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(
        utilisateurTest({ verrouilleJusquA: dateFuture.toISOString() as unknown as Date }),
      );
    servicePwd.verifier = vi.fn().mockResolvedValue(true);

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'bon' }, null, null),
    ).rejects.toBeInstanceOf(ErreurCompteVerrouille);
  });

  it('incrémente les échecs et verrouille le compte au seuil (5e échec)', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ echecsConnexion: 4 }));
    servicePwd.verifier = vi.fn().mockResolvedValue(false);

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'faux' }, null, null),
    ).rejects.toBeInstanceOf(ErreurIdentifiantsInvalides);

    expect(accesAmorcage.enregistrerEchecConnexion).toHaveBeenCalledWith(
      'utilisateur-id',
      expect.any(Date),
    );
    const [, verrouilleJusquA] = (
      accesAmorcage.enregistrerEchecConnexion as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, Date];
    expect(verrouilleJusquA.getTime()).toBeGreaterThan(Date.now());
  });

  it('ne verrouille pas encore sous le seuil (échec < 5)', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ echecsConnexion: 0 }));
    servicePwd.verifier = vi.fn().mockResolvedValue(false);

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'faux' }, null, null),
    ).rejects.toBeInstanceOf(ErreurIdentifiantsInvalides);

    expect(accesAmorcage.enregistrerEchecConnexion).toHaveBeenCalledWith('utilisateur-id', null);
  });

  it('refuse un compte suspendu APRÈS vérification du mot de passe, sans ouvrir de session', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ statut: 'suspendu' }));

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'bon' }, null, null),
    ).rejects.toBeInstanceOf(ErreurCompteSuspendu);

    expect(servicePwd.verifier).toHaveBeenCalled();
    expect(serviceSession.ouvrir).not.toHaveBeenCalled();
  });

  it('refuse un tenant suspendu, sans ouvrir de session', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ statutTenant: 'suspendu' }));

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'bon' }, null, null),
    ).rejects.toBeInstanceOf(ErreurTenantSuspendu);

    expect(serviceSession.ouvrir).not.toHaveBeenCalled();
  });

  it('connexion réussie : réinitialise les échecs, ouvre une session, journalise, rend le corps attendu', async () => {
    const resultat = await service().connecter(
      { email: 'GARAGE@Example.CH', motDePasse: 'bon-mot-de-passe' },
      '203.0.113.1',
      'ua-test',
    );

    expect(accesAmorcage.reinitialiserEchecsConnexion).toHaveBeenCalledWith(
      'utilisateur-id',
      expect.any(Date),
    );
    expect(serviceSession.ouvrir).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'utilisateur-id' }),
      '203.0.113.1',
      'ua-test',
    );
    expect(resultat.session.tokenClair).toBe('jeton-clair');
    expect(resultat.corps.utilisateur.email).toBe('garage@example.ch');
    expect(resultat.corps.tenant.slug).toBe('garage-dupont');
    expect(resultat.corps.sites).toHaveLength(1);
    expect(resultat.corps.expireLe).toBe('2026-07-28T12:00:00.000Z');

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(appelsJournal.some(([e]) => (e as { type: string }).type === 'connexion_reussie')).toBe(
      true,
    );
  });

  it('normalise l’email (trim + lowercase) avant de chercher l’utilisateur', async () => {
    await service().connecter({ email: '  GARAGE@Example.CH  ', motDePasse: 'bon' }, null, null);

    expect(accesAmorcage.utilisateurParEmail).toHaveBeenCalledWith('garage@example.ch');
  });

  it('un échec de journalisation ne fait pas échouer une connexion par ailleurs réussie', async () => {
    accesAmorcage.journaliserSecurite = vi.fn().mockRejectedValue(new Error('redis kaput'));

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'bon' }, null, null),
    ).resolves.toBeDefined();
  });

  // Finding sécurité #6 (volet auth) : une IP syntaxiquement invalide ne doit jamais atteindre
  // `journaliserSecurite()` telle quelle (elle ferait échouer le cast `::inet` côté base, et donc
  // disparaître l'événement de sécurité tout entier avec elle) — elle est remplacée par `null`.
  it('journalise ip = null quand l’IP fournie n’est pas une IPv4/IPv6 valide (au lieu de risquer l’échec de l’INSERT)', async () => {
    await service().connecter(
      { email: 'garage@example.ch', motDePasse: 'bon' },
      "1' OR '1'='1", // chaîne non-IP, passait le motif regex historique (drapeau `i` + `A-Z`)
      'ua-test',
    );

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(appelsJournal.length).toBeGreaterThan(0);
    for (const [evenement] of appelsJournal) {
      expect((evenement as { ip: string | null }).ip).toBeNull();
    }
  });

  it('journalise l’IP telle quelle quand elle est une IPv4 valide', async () => {
    await service().connecter(
      { email: 'garage@example.ch', motDePasse: 'bon' },
      '203.0.113.42',
      'ua-test',
    );

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock
      .calls;
    const evenementReussi = appelsJournal.find(
      ([e]) => (e as { type: string }).type === 'connexion_reussie',
    )?.[0] as { ip: string | null } | undefined;
    expect(evenementReussi?.ip).toBe('203.0.113.42');
  });
});

describe('ServiceAuthentificationImpl.connecter — rehachage en arrière-plan, scoping tenant', () => {
  it('scope l’UPDATE de rehachage du mot de passe par tenantId, pas seulement par id (le RLS est le filet, pas le mécanisme)', async () => {
    const clausesWhereUpdate: unknown[] = [];
    const donnees = {
      utilisateur: [
        {
          id: 'utilisateur-id',
          email: 'garage@example.ch',
          prenom: 'Jean',
          nom: 'Dupont',
          role: 'admin',
          langue: 'fr',
          siteId: null,
        },
      ],
      tenant: [
        {
          id: 'tenant-id',
          slug: 'garage-dupont',
          raisonSociale: 'Garage Dupont Sàrl',
          langueDefaut: 'fr',
          modulesDesactives: [],
        },
      ],
      sites: [{ id: 'site-id', code: 'SION', nom: 'Sion', actif: true }],
      session: [{ expireLe: new Date('2026-07-28T12:00:00.000Z') }],
    };

    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === tableUtilisateur) return requeteMock(donnees.utilisateur);
            if (table === tableTenant) return requeteMock(donnees.tenant);
            if (table === tableSite) return requeteMock(donnees.sites);
            if (table === tableSession) return requeteMock(donnees.session);
            throw new Error('Table inattendue dans le mock de test.');
          },
        }),
      }),
      update: (table: unknown) => ({
        set: () => ({
          where: (clause: unknown) => {
            if (table === tableUtilisateur) clausesWhereUpdate.push(clause);
            return Promise.resolve(undefined);
          },
        }),
      }),
    };

    const accesBase: AccesBase = {
      enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
      verifierConnexion: vi.fn(),
      verifierPostureRls: vi.fn(),
    };

    const svc = new ServiceAuthentificationImpl(
      configTest(),
      accesBase,
      {
        utilisateurParEmail: vi.fn().mockResolvedValue(utilisateurTest()),
        sessionParEmpreinte: vi.fn(),
        toucherSession: vi.fn(),
        enregistrerEchecConnexion: vi.fn(),
        reinitialiserEchecsConnexion: vi.fn().mockResolvedValue(undefined),
        journaliserSecurite: vi.fn().mockResolvedValue(undefined),
      },
      {
        hacher: vi.fn().mockResolvedValue('$argon2id$nouveau-hash'),
        verifier: vi.fn().mockResolvedValue(true),
        verifierLeurre: vi.fn(),
        // Déclenche le chemin de rehachage best-effort : c'est CE chemin, et lui seul, qui exécute
        // l'UPDATE audité (authentification.service.ts, `rehacherEnArrierePlan()`).
        doitEtreRehache: vi.fn().mockReturnValue(true),
      },
      {
        ouvrir: vi.fn().mockResolvedValue({
          tokenClair: 'jeton-clair',
          sessionId: 'session-id',
          expireLe: new Date('2026-07-28T12:00:00.000Z'),
        }),
        resoudre: vi.fn(),
        fermer: vi.fn(),
      },
      { consommer: vi.fn().mockResolvedValue({ autorise: true, resteSecondes: 0 }) },
      contexteTest(),
    );

    await svc.connecter({ email: 'garage@example.ch', motDePasse: 'bon' }, null, null);

    // Le rehachage tourne en arrière-plan (fire-and-forget, best-effort — voir le commentaire de
    // `rehacherEnArrierePlan()`) : attendre qu'il ait eu l'occasion de s'exécuter avant d'asserter,
    // plutôt que de dépendre d'un ordonnancement précis des microtâches.
    await vi.waitFor(() => {
      expect(clausesWhereUpdate).toHaveLength(1);
    });

    // Un `.where()` scopé UNIQUEMENT par id (régression de ce correctif) n'aurait qu'UN seul
    // paramètre bindé ; la correction en exige deux : id ET tenant_id.
    const dialecte = new PgDialect();
    const requeteUpdate = dialecte.sqlToQuery(clausesWhereUpdate[0] as SQL);
    expect(requeteUpdate.params).toEqual(['utilisateur-id', 'tenant-id']);
  });
});

describe('ServiceAuthentificationImpl.sessionCourante — scoping tenant (finding sécurité #9)', () => {
  it('filtre les requêtes `utilisateur` et `session` par tenantId, pas seulement par id (le RLS est le filet, pas le mécanisme)', async () => {
    const clausesWhere: unknown[] = [];
    const donnees = {
      utilisateur: [
        {
          id: 'utilisateur-id',
          email: 'garage@example.ch',
          prenom: 'Jean',
          nom: 'Dupont',
          role: 'admin',
          langue: 'fr',
          siteId: null,
        },
      ],
      tenant: [
        {
          id: 'tenant-id',
          slug: 'garage-dupont',
          raisonSociale: 'Garage Dupont Sàrl',
          langueDefaut: 'fr',
          modulesDesactives: [],
        },
      ],
      sites: [{ id: 'site-id', code: 'SION', nom: 'Sion', actif: true }],
      session: [{ expireLe: new Date('2026-07-28T12:00:00.000Z') }],
    };

    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: (clause: unknown) => {
            clausesWhere.push(clause);
            if (table === tableUtilisateur) return requeteMock(donnees.utilisateur);
            if (table === tableTenant) return requeteMock(donnees.tenant);
            if (table === tableSite) return requeteMock(donnees.sites);
            if (table === tableSession) return requeteMock(donnees.session);
            throw new Error('Table inattendue dans le mock de test.');
          },
        }),
      }),
    };
    const accesBase: AccesBase = {
      enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
      verifierConnexion: vi.fn(),
      verifierPostureRls: vi.fn(),
    };

    const svc = new ServiceAuthentificationImpl(
      configTest(),
      accesBase,
      {
        utilisateurParEmail: vi.fn(),
        sessionParEmpreinte: vi.fn(),
        toucherSession: vi.fn(),
        enregistrerEchecConnexion: vi.fn(),
        reinitialiserEchecsConnexion: vi.fn(),
        journaliserSecurite: vi.fn(),
      },
      {
        hacher: vi.fn(),
        verifier: vi.fn(),
        verifierLeurre: vi.fn(),
        doitEtreRehache: vi.fn(),
      },
      { ouvrir: vi.fn(), resoudre: vi.fn(), fermer: vi.fn() },
      { consommer: vi.fn() },
      contexteTest(),
    );

    await svc.sessionCourante({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'admin',
      langue: 'fr',
    });

    // Ordre d'appel déterministe dans `sessionCourante()` : utilisateur (0), tenant (1),
    // sites (2), session (3) — voir authentification.service.ts.
    const dialecte = new PgDialect();
    const requeteUtilisateur = dialecte.sqlToQuery(clausesWhere[0] as SQL);
    const requeteSession = dialecte.sqlToQuery(clausesWhere[3] as SQL);

    // Un `.where()` scopé UNIQUEMENT par id (régression du finding #9) n'aurait qu'UN seul
    // paramètre bindé ; la correction en exige deux : id ET tenant_id.
    expect(requeteUtilisateur.params).toEqual(['utilisateur-id', 'tenant-id']);
    expect(requeteSession.params).toEqual(['session-id', 'tenant-id']);
  });
});

describe('ServiceAuthentificationImpl.deconnecter', () => {
  it('ferme la session et journalise un événement deconnexion', async () => {
    const serviceSession: ServiceSession = {
      ouvrir: vi.fn(),
      resoudre: vi.fn(),
      fermer: vi.fn().mockResolvedValue(undefined),
    };
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn(),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new ServiceAuthentificationImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      {
        hacher: vi.fn(),
        verifier: vi.fn(),
        verifierLeurre: vi.fn(),
        doitEtreRehache: vi.fn(),
      },
      serviceSession,
      { consommer: vi.fn() },
      contexteTest(),
    );

    await svc.deconnecter({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'admin',
      langue: 'fr',
    });

    expect(serviceSession.fermer).toHaveBeenCalledOnce();
    const [evenement] = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ type: string }];
    expect(evenement.type).toBe('deconnexion');
  });

  // Finding sécurité #7 : si la révocation en base échoue, l'erreur ne doit JAMAIS être avalée en
  // silence — elle doit être à la fois loguée et journalisée comme événement de sécurité distinct,
  // pour rester reconstituable dans `journal_securite` a posteriori (le contrôleur, lui, garde le
  // droit de l'avaler pour rester idempotent côté client — voir auth.controller.ts).
  it('propage l’erreur ET journalise un événement d’échec quand `fermer()` échoue (ne l’avale pas en silence)', async () => {
    const erreurFermeture = new Error('statement_timeout');
    const serviceSession: ServiceSession = {
      ouvrir: vi.fn(),
      resoudre: vi.fn(),
      fermer: vi.fn().mockRejectedValue(erreurFermeture),
    };
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn(),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new ServiceAuthentificationImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      {
        hacher: vi.fn(),
        verifier: vi.fn(),
        verifierLeurre: vi.fn(),
        doitEtreRehache: vi.fn(),
      },
      serviceSession,
      { consommer: vi.fn() },
      contexteTest(),
    );

    await expect(
      svc.deconnecter({
        sessionId: 'session-id',
        tenantId: 'tenant-id',
        utilisateurId: 'utilisateur-id',
        role: 'admin',
        langue: 'fr',
      }),
    ).rejects.toBe(erreurFermeture);

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(appelsJournal).toHaveLength(1);
    const [evenement] = appelsJournal[0] as [{ type: string; details: unknown }];
    expect(evenement.type).toBe('deconnexion');
    expect(evenement.details).toMatchObject({ resultat: 'echec_revocation' });
  });
});

/**
 * `sessionCourante()` — portée de site d'un COMPTE DE SERVICE (borne d'atelier, migration 0039).
 *
 * L'enjeu : jusqu'ici, `GET /auth/moi` rendait TOUS les sites du tenant à n'importe quel compte.
 * Pour une borne, ce serait à la fois inutile (elle n'a qu'un atelier) et trompeur (le front
 * offrirait un sélecteur de site à un écran qui n'en a pas). Le filtrage se fait sur
 * `utilisateur.site_id`, donc côté SERVEUR et depuis la session — pas sur un paramètre client.
 */
describe('ServiceAuthentificationImpl.sessionCourante — portée de site des comptes de service', () => {
  function svcAvecUtilisateur(siteIdUtilisateur: string | null): {
    svc: ServiceAuthentificationImpl;
    clausesWhere: unknown[];
  } {
    const clausesWhere: unknown[] = [];
    const donnees = {
      utilisateur: [
        {
          id: 'utilisateur-id',
          email: 'borne.sion@garage.test',
          prenom: 'Borne',
          nom: 'Atelier Sion',
          role: siteIdUtilisateur === null ? 'admin' : 'poste_atelier',
          langue: 'fr',
          siteId: siteIdUtilisateur,
          // Colonnes de grille : la borne n'en a pas (profil figé), un admin a son préréglage.
          ...colonnesDepuisGrille(
            siteIdUtilisateur === null ? PREREGLAGES.admin.grille : GRILLE_VIDE,
          ),
        },
      ],
      tenant: [
        {
          id: 'tenant-id',
          slug: 'garage-dupont',
          raisonSociale: 'Garage Dupont Sàrl',
          langueDefaut: 'fr',
          modulesDesactives: [],
        },
      ],
      sites: [{ id: 'site-sion', code: 'SION', nom: 'Sion', actif: true }],
      session: [{ expireLe: new Date('2026-07-28T12:00:00.000Z') }],
    };

    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: (clause: unknown) => {
            clausesWhere.push(clause);
            if (table === tableUtilisateur) return requeteMock(donnees.utilisateur);
            if (table === tableTenant) return requeteMock(donnees.tenant);
            if (table === tableSite) return requeteMock(donnees.sites);
            if (table === tableSession) return requeteMock(donnees.session);
            throw new Error('Table inattendue dans le mock de test.');
          },
        }),
      }),
    };

    const svc = new ServiceAuthentificationImpl(
      configTest(),
      {
        enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
        verifierConnexion: vi.fn(),
        verifierPostureRls: vi.fn(),
      },
      {
        utilisateurParEmail: vi.fn(),
        sessionParEmpreinte: vi.fn(),
        toucherSession: vi.fn(),
        enregistrerEchecConnexion: vi.fn(),
        reinitialiserEchecsConnexion: vi.fn(),
        journaliserSecurite: vi.fn(),
      },
      { hacher: vi.fn(), verifier: vi.fn(), verifierLeurre: vi.fn(), doitEtreRehache: vi.fn() },
      { ouvrir: vi.fn(), resoudre: vi.fn(), fermer: vi.fn() },
      { consommer: vi.fn() },
      contexteTest(),
    );
    return { svc, clausesWhere };
  }

  it('borne la requête `site` au SEUL site de rattachement quand le compte en porte un — deux paramètres bindés (tenant_id ET site_id), là où un compte de personne n’en binde qu’un', async () => {
    const dialecte = new PgDialect();

    const { svc: svcBorne, clausesWhere: clausesBorne } = svcAvecUtilisateur('site-sion');
    const corpsBorne = await svcBorne.sessionCourante({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'poste_atelier',
      langue: 'fr',
      siteId: 'site-sion',
    });
    // Ordre d'appel déterministe : utilisateur (0), tenant (1), sites (2), session (3).
    expect(dialecte.sqlToQuery(clausesBorne[2] as SQL).params).toEqual(['tenant-id', 'site-sion']);
    expect(corpsBorne.siteRattachementId).toBe('site-sion');

    const { svc: svcPersonne, clausesWhere: clausesPersonne } = svcAvecUtilisateur(null);
    const corpsPersonne = await svcPersonne.sessionCourante({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'admin',
      langue: 'fr',
      siteId: null,
    });
    // Compte de personne : scoping tenant SEUL, exactement comme avant la migration 0039 — aucune
    // régression sur le comportement des huit rôles existants.
    expect(dialecte.sqlToQuery(clausesPersonne[2] as SQL).params).toEqual(['tenant-id']);
    expect(corpsPersonne.siteRattachementId).toBeNull();
  });

  it('n’expose JAMAIS `siteId` à l’intérieur de l’objet `utilisateur` : le contrat UtilisateurCourant ne porte pas de site (c’est une propriété du COMPTE, publiée à part), et un champ non déclaré ferait diverger la réponse de l’OpenAPI généré', async () => {
    const { svc } = svcAvecUtilisateur('site-sion');

    const corps = await svc.sessionCourante({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'poste_atelier',
      langue: 'fr',
      siteId: 'site-sion',
    });

    expect(corps.utilisateur).not.toHaveProperty('siteId');
    expect(Object.keys(corps.utilisateur).sort()).toEqual(
      ['id', 'email', 'prenom', 'nom', 'role', 'langue'].sort(),
    );
  });

  it('publie les actions de la matrice du rôle LU EN BASE (triées) — la borne n’a que ses 7 actions, jamais celles de direction', async () => {
    const { svc: svcBorne } = svcAvecUtilisateur('site-sion');
    const borne = await svcBorne.sessionCourante({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      // Principal volontairement mensonger : seul le rôle de la base compte.
      role: 'direction',
      langue: 'fr',
      siteId: 'site-sion',
    });
    expect(borne.actions).toEqual([...MATRICE_DROITS.poste_atelier].sort());
    expect(borne.actions).not.toContain('socle.utilisateur.creer');

    const { svc: svcAdmin } = svcAvecUtilisateur(null);
    const admin = await svcAdmin.sessionCourante({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'admin',
      langue: 'fr',
      siteId: null,
    });
    expect(admin.actions).toEqual([...MATRICE_DROITS.admin].sort());
    expect(admin.actions).not.toContain('facturation.paiement.encaisser');
  });
});

describe('ServiceAuthentificationImpl.sessionCourante — modules actifs', () => {
  function svcAvecModulesDesactives(desactives: readonly string[]): ServiceAuthentificationImpl {
    return new ServiceAuthentificationImpl(
      configTest(),
      accesBaseTest(desactives),
      {} as unknown as AccesAmorcage,
      {} as unknown as ServiceMotDePasse,
      {} as unknown as ServiceSession,
      {} as unknown as ServiceLimitationDebit,
      contexteTest(),
    );
  }
  const principal = {
    sessionId: 'session-id',
    tenantId: 'tenant-id',
    utilisateurId: 'utilisateur-id',
    role: 'admin',
    langue: 'fr',
  } as const;

  it('tout est actif par défaut, et `tenant` ne porte pas la liste brute', async () => {
    const corps = await svcAvecModulesDesactives([]).sessionCourante(principal);
    expect(corps.modulesActifs).toEqual(MODULES_APP);
    expect(corps.tenant).not.toHaveProperty('modulesDesactives');
  });

  it('retire le module choisi ET ses dépendants (atelier -> pointage -> tablettes)', async () => {
    const corps = await svcAvecModulesDesactives(['atelier', 'pneus']).sessionCourante(principal);
    expect(corps.modulesActifs).toEqual(
      MODULES_APP.filter((m) => !['atelier', 'pointage', 'tablettes', 'pneus'].includes(m)),
    );
  });
});
