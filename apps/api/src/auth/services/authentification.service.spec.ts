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
    LIMITE_CONNEXION_COMPTE: 5,
    LIMITE_FENETRE_SECONDES: 900,
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

function accesBaseTest(): AccesBase {
  const donnees = {
    utilisateur: {
      id: 'utilisateur-id',
      email: 'garage@example.ch',
      prenom: 'Jean',
      nom: 'Dupont',
      role: 'admin',
      langue: 'fr',
    },
    tenant: {
      id: 'tenant-id',
      slug: 'garage-dupont',
      raisonSociale: 'Garage Dupont Sàrl',
      langueDefaut: 'fr',
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
    limiteur.consommer = vi
      .fn()
      .mockResolvedValueOnce({ autorise: false, retryApresSecondes: 42 });

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'x' }, '203.0.113.1', null),
    ).rejects.toBeInstanceOf(ErreurTropDeTentatives);

    expect(accesAmorcage.utilisateurParEmail).not.toHaveBeenCalled();
  });

  it('rejette avec 429 quand la limitation de débit par email est dépassée', async () => {
    limiteur.consommer = vi
      .fn()
      .mockResolvedValueOnce({ autorise: true, resteSecondes: 0 }) // IP
      .mockResolvedValueOnce({ autorise: false, retryApresSecondes: 7 }); // email

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'x' }, '203.0.113.1', null),
    ).rejects.toBeInstanceOf(ErreurTropDeTentatives);
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
    const [, verrouilleJusquA] = (accesAmorcage.enregistrerEchecConnexion as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, Date];
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

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock.calls;
    expect(appelsJournal.some(([e]) => (e as { type: string }).type === 'connexion_reussie')).toBe(
      true,
    );
  });

  it('normalise l’email (trim + lowercase) avant de chercher l’utilisateur', async () => {
    await service().connecter(
      { email: '  GARAGE@Example.CH  ', motDePasse: 'bon' },
      null,
      null,
    );

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

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock.calls;
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

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock.calls;
    const evenementReussi = appelsJournal.find(
      ([e]) => (e as { type: string }).type === 'connexion_reussie',
    )?.[0] as { ip: string | null } | undefined;
    expect(evenementReussi?.ip).toBe('203.0.113.42');
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
        },
      ],
      tenant: [
        {
          id: 'tenant-id',
          slug: 'garage-dupont',
          raisonSociale: 'Garage Dupont Sàrl',
          langueDefaut: 'fr',
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

    const appelsJournal = (accesAmorcage.journaliserSecurite as ReturnType<typeof vi.fn>).mock.calls;
    expect(appelsJournal).toHaveLength(1);
    const [evenement] = appelsJournal[0] as [{ type: string; details: unknown }];
    expect(evenement.type).toBe('deconnexion');
    expect(evenement.details).toMatchObject({ resultat: 'echec_revocation' });
  });
});
