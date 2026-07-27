import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('refuse un compte déjà verrouillé SANS même vérifier le mot de passe', async () => {
    accesAmorcage.utilisateurParEmail = vi
      .fn()
      .mockResolvedValue(utilisateurTest({ verrouilleJusquA: new Date(Date.now() + 60_000) }));

    await expect(
      service().connecter({ email: 'garage@example.ch', motDePasse: 'x' }, null, null),
    ).rejects.toBeInstanceOf(ErreurCompteVerrouille);

    expect(servicePwd.verifier).not.toHaveBeenCalled();
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
});
