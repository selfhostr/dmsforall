import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/config.types';
import type { AccesAmorcage, AccesBase, SessionAmorcage, UtilisateurAmorcage } from '../../db/db.types';
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

    expect(principal).toEqual({
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      utilisateurId: 'utilisateur-id',
      role: 'admin',
      langue: 'fr',
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

  it("ne touche PAS `vu_le` quand la dernière activité connue a moins de 60s", async () => {
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

  it("touche `vu_le` quand la dernière activité connue a plus de 60s", async () => {
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
