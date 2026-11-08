import { PREREGLAGES } from '@dfa/shared';
import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/config.types';
import type {
  AccesAmorcage,
  AccesBase,
  SessionAmorcage,
  UtilisateurAmorcage,
} from '../../db/db.types';
import type { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import { ErreurSessionAbsente, ErreurSessionExpiree } from '../erreurs-auth';
import { ServiceSessionImpl } from './session.service';

function configTest(overrides: Partial<Config> = {}): Config {
  return {
    SESSION_DUREE_MINUTES: 480,
    SESSION_INACTIVITE_MINUTES: 120,
    ...overrides,
  } as Config;
}

function contexteTest(): ServiceContexteRequete {
  return { actuelOuNull: () => null } as unknown as ServiceContexteRequete;
}

function sessionAmorcageTest(overrides: Partial<SessionAmorcage> = {}): SessionAmorcage {
  const maintenant = new Date();
  return {
    sessionId: 'session-id',
    tenantId: 'tenant-id',
    utilisateurId: 'utilisateur-id',
    creeLe: maintenant,
    expireLe: new Date(maintenant.getTime() + 60 * 60_000),
    vuLe: maintenant,
    revoqueeLe: null,
    role: 'admin',
    langue: 'fr',
    statutUtilisateur: 'actif',
    statutTenant: 'actif',
    // Compte de PERSONNE : aucun rattachement de site (migration 0039). Les comptes de service
    // sont couverts par leurs propres tests, plus bas et dans `comptes-de-service.spec.ts`.
    siteId: null,
    capacites: PREREGLAGES.admin.grille,
    ...overrides,
  };
}

/** Construit un `AccesBase` minimal dont `enTenant` exécute directement le travail donné. */
function accesBaseTest(tx: Record<string, unknown> = {}): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceSessionImpl.resoudre — expiration absolue vs glissante', () => {
  it('rend un principal pour une session valide (ni expirée, ni inactive, ni révoquée)', async () => {
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn().mockResolvedValue(sessionAmorcageTest()),
      toucherSession: vi.fn().mockResolvedValue(undefined),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    const principal = await service.resoudre('un-token-quelconque');

    // `toEqual` EXHAUSTIF, pas `toMatchObject` : le principal est la surface d'autorisation de
    // toute l'application — un champ qui y apparaît sans décision (ou qui en disparaît) doit
    // faire rougir ce test. `siteId: null` = compte de personne, aucune restriction de site.
    expect(principal).toEqual({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'admin',
      langue: 'fr',
      siteId: null,
      // Grille relue de la base à chaque requête (migration 0087), jamais d'un jeton.
      capacites: PREREGLAGES.admin.grille,
      // Issue #58 : obligation de changer le mot de passe, relue à chaque requête.
      motDePasseAChanger: false,
    });
  });

  it('lève AUTH_SESSION_ABSENTE quand l’empreinte est inconnue de la base', async () => {
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn().mockResolvedValue(null),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    await expect(service.resoudre('jeton-forge')).rejects.toBeInstanceOf(ErreurSessionAbsente);
  });

  it('lève AUTH_SESSION_EXPIREE (pas ABSENTE) quand `now > expireLe` (expiration ABSOLUE), même si `vuLe` est récent', async () => {
    const maintenant = new Date();
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn().mockResolvedValue(
        sessionAmorcageTest({
          // Expirée dans l'absolu il y a 1 minute...
          expireLe: new Date(maintenant.getTime() - 60_000),
          // ...mais vue il y a seulement 1 seconde : l'inactivité glissante ne doit PAS masquer
          // le dépassement de la durée absolue.
          vuLe: new Date(maintenant.getTime() - 1_000),
        }),
      ),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    await expect(service.resoudre('token')).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('lève AUTH_SESSION_EXPIREE quand `now > vuLe + SESSION_INACTIVITE_MINUTES` (expiration GLISSANTE), même si `expireLe` est loin', async () => {
    const maintenant = new Date();
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn().mockResolvedValue(
        sessionAmorcageTest({
          // Encore valide dans l'absolu (loin dans le futur)...
          expireLe: new Date(maintenant.getTime() + 10 * 60 * 60_000),
          // ...mais inactive depuis plus longtemps que la fenêtre glissante configurée (120 min).
          vuLe: new Date(maintenant.getTime() - 121 * 60_000),
        }),
      ),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest({ SESSION_INACTIVITE_MINUTES: 120 }),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    await expect(service.resoudre('token')).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('lève AUTH_SESSION_EXPIREE pour une session révoquée', async () => {
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi
        .fn()
        .mockResolvedValue(sessionAmorcageTest({ revoqueeLe: new Date() })),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    await expect(service.resoudre('token')).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('lève AUTH_SESSION_EXPIREE si l’utilisateur ou le tenant ne sont plus actifs', async () => {
    const base = sessionAmorcageTest();
    const accesAmorcageUtilisateur: AccesAmorcage = {
      sessionParEmpreinte: vi
        .fn()
        .mockResolvedValue({ ...base, statutUtilisateur: 'suspendu' } as SessionAmorcage),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const serviceUtilisateur = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcageUtilisateur,
      contexteTest(),
    );
    await expect(serviceUtilisateur.resoudre('token')).rejects.toBeInstanceOf(ErreurSessionExpiree);

    const accesAmorcageTenant: AccesAmorcage = {
      sessionParEmpreinte: vi
        .fn()
        .mockResolvedValue({ ...base, statutTenant: 'suspendu' } as SessionAmorcage),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const serviceTenant = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcageTenant,
      contexteTest(),
    );
    await expect(serviceTenant.resoudre('token')).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('lève AUTH_SESSION_ABSENTE immédiatement (sans appel base) pour un jeton vide', async () => {
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    await expect(service.resoudre('')).rejects.toBeInstanceOf(ErreurSessionAbsente);
    expect(accesAmorcage.sessionParEmpreinte).not.toHaveBeenCalled();
  });

  it('ne touche PAS `vu_le` quand la dernière activité connue a moins de 60s', async () => {
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi
        .fn()
        .mockResolvedValue(sessionAmorcageTest({ vuLe: new Date(Date.now() - 5_000) })),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    await service.resoudre('token');

    expect(accesAmorcage.toucherSession).not.toHaveBeenCalled();
  });

  it('touche `vu_le` quand la dernière activité connue a plus de 60s', async () => {
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi
        .fn()
        .mockResolvedValue(sessionAmorcageTest({ vuLe: new Date(Date.now() - 61_000) })),
      toucherSession: vi.fn().mockResolvedValue(undefined),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest(),
      accesBaseTest(),
      accesAmorcage,
      contexteTest(),
    );

    await service.resoudre('token');

    expect(accesAmorcage.toucherSession).toHaveBeenCalledWith('session-id', expect.any(Date));
  });
});

describe('ServiceSessionImpl.ouvrir', () => {
  it('génère un jeton clair de 32 octets en base64url, distinct à chaque appel', async () => {
    const tx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'nouvelle-session-id' }]),
        }),
      }),
    };
    const accesBase = accesBaseTest(tx);
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest({ SESSION_DUREE_MINUTES: 480 }),
      accesBase,
      accesAmorcage,
      contexteTest(),
    );
    const utilisateur: UtilisateurAmorcage = {
      id: 'utilisateur-id',
      tenantId: 'tenant-id',
      email: 'a@example.ch',
      motDePasseHash: '$argon2id$...',
      statut: 'actif',
      statutTenant: 'actif',
      role: 'admin',
      langue: 'fr',
      echecsConnexion: 0,
      verrouilleJusquA: null,
    };

    const a = await service.ouvrir(utilisateur, '203.0.113.1', 'agent-test');
    const b = await service.ouvrir(utilisateur, '203.0.113.1', 'agent-test');

    expect(a.tokenClair).not.toBe(b.tokenClair);
    // 32 octets base64url ⇒ 43 caractères (pas de padding `=`).
    expect(a.tokenClair).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.sessionId).toBe('nouvelle-session-id');
    expect(a.expireLe.getTime()).toBeGreaterThan(Date.now() + 479 * 60_000);
  });
});

/**
 * Compte de service (borne d'atelier, migration 0039) — ce que la session doit garantir.
 *
 * Deux propriétés, toutes deux nécessaires au mode « borne partagée » du pointage :
 *
 *  1. le SITE de la borne remonte dans le principal, résolu depuis le seul cookie. C'est ce qui
 *     rend impossible qu'un client le déclare — et donc qu'une borne consulte les PIN d'un autre
 *     garage du même prestataire ;
 *  2. la session est LONGUE. RM-129 fonde tout l'anti-balayage du PIN sur « cette session ne peut
 *     pas se rafraîchir sans le mot de passe de la borne, que les techniciens ne connaissent pas ».
 *     Avec les 480 min / 120 min d'une personne, quelqu'un devrait retaper ce mot de passe devant
 *     l'atelier chaque matin : la prémisse deviendrait fausse en une semaine.
 */
describe('ServiceSessionImpl — comptes de service (poste_atelier)', () => {
  function serviceAvecSession(s: SessionAmorcage): {
    service: ServiceSessionImpl;
    toucherSession: ReturnType<typeof vi.fn>;
  } {
    const toucherSession = vi.fn().mockResolvedValue(undefined);
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn().mockResolvedValue(s),
      toucherSession,
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    return {
      service: new ServiceSessionImpl(configTest(), accesBaseTest(), accesAmorcage, contexteTest()),
      toucherSession,
    };
  }

  it('remonte le site du compte dans le principal — un compte de service sans site résolu ne pourrait rien faire (fail-closed de siteImposeAuPrincipal)', async () => {
    const { service } = serviceAvecSession(
      sessionAmorcageTest({ role: 'poste_atelier', siteId: 'site-sion' }),
    );

    const principal = await service.resoudre('jeton-quelconque');

    expect(principal?.siteId).toBe('site-sion');
    expect(principal?.role).toBe('poste_atelier');
  });

  it('renseigne TOUJOURS siteId, y compris pour un compte de personne (null explicite, jamais undefined) : l’invariant sur lequel repose le seul accesseur sanctionné', async () => {
    const { service } = serviceAvecSession(sessionAmorcageTest({ role: 'technicien' }));

    const principal = await service.resoudre('jeton-quelconque');

    expect(principal).toHaveProperty('siteId');
    expect(principal?.siteId).toBeNull();
  });

  it('n’expire PAS une session de borne restée 3 jours sans activité, là où la même inactivité expirerait la session d’une personne — sinon la borne serait déconnectée chaque week-end', async () => {
    const troisJours = 3 * 24 * 60 * 60_000;
    const vuLe = new Date(Date.now() - troisJours);
    const expireLe = new Date(Date.now() + 30 * 24 * 60 * 60_000);

    const { service: serviceBorne } = serviceAvecSession(
      sessionAmorcageTest({ role: 'poste_atelier', siteId: 'site-sion', vuLe, expireLe }),
    );
    await expect(serviceBorne.resoudre('jeton-quelconque')).resolves.toMatchObject({
      role: 'poste_atelier',
    });

    // Même session, même inactivité, rôle de personne : expirée (SESSION_INACTIVITE_MINUTES=120).
    const { service: servicePersonne } = serviceAvecSession(
      sessionAmorcageTest({ role: 'technicien', vuLe, expireLe }),
    );
    await expect(servicePersonne.resoudre('jeton-quelconque')).rejects.toBeInstanceOf(
      ErreurSessionExpiree,
    );
  });

  it('respecte malgré tout l’expiration ABSOLUE d’une session de borne : une session de service reste bornée dans le temps, elle n’est pas un jeton permanent', async () => {
    const { service } = serviceAvecSession(
      sessionAmorcageTest({
        role: 'poste_atelier',
        siteId: 'site-sion',
        vuLe: new Date(),
        expireLe: new Date(Date.now() - 1_000),
      }),
    );

    await expect(service.resoudre('jeton-quelconque')).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('respecte la révocation immédiate d’une session de borne : c’est le moyen de couper une tablette volée sans attendre l’expiration longue', async () => {
    const { service } = serviceAvecSession(
      sessionAmorcageTest({
        role: 'poste_atelier',
        siteId: 'site-sion',
        revoqueeLe: new Date(),
      }),
    );

    await expect(service.resoudre('jeton-quelconque')).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('ouvre une session BEAUCOUP plus longue que SESSION_DUREE_MINUTES pour un compte de service, et exactement SESSION_DUREE_MINUTES pour une personne', async () => {
    const tx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'nouvelle-session-id' }]),
        }),
      }),
    };
    const accesAmorcage: AccesAmorcage = {
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      utilisateurParEmail: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const service = new ServiceSessionImpl(
      configTest({ SESSION_DUREE_MINUTES: 480 }),
      accesBaseTest(tx),
      accesAmorcage,
      contexteTest(),
    );
    const base: UtilisateurAmorcage = {
      id: 'utilisateur-id',
      tenantId: 'tenant-id',
      email: 'borne.sion@garage.test',
      motDePasseHash: '$argon2id$...',
      statut: 'actif',
      statutTenant: 'actif',
      role: 'poste_atelier',
      langue: 'fr',
      echecsConnexion: 0,
      verrouilleJusquA: null,
    };

    const borne = await service.ouvrir(base, null, null);
    const personne = await service.ouvrir({ ...base, role: 'technicien' }, null, null);

    // Une journée de travail complète, week-end compris, ne doit pas suffire à expirer la borne.
    expect(borne.expireLe.getTime()).toBeGreaterThan(Date.now() + 7 * 24 * 60 * 60_000);
    // La personne, elle, garde exactement la durée configurée (480 min).
    expect(personne.expireLe.getTime()).toBeLessThan(Date.now() + 481 * 60_000);
    expect(personne.expireLe.getTime()).toBeGreaterThan(Date.now() + 479 * 60_000);
  });
});
