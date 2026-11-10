import { describe, expect, it, vi } from 'vitest';

import type { SessionCourante } from '@dfa/shared';

import { InstallationController } from './installation.controller';

const SESSION = { utilisateur: { email: 'direction@exemple.ch' } } as unknown as SessionCourante;
const SAISIE = {
  codeInstallation: 'ABCD-EFGH-JKMN',
  garage: 'Garage Exemple',
  prenom: 'Claire',
  nom: 'Martin',
  email: 'direction@exemple.ch',
  motDePasse: 'une phrase de passe assez longue',
};

function fabrique() {
  const installation = {
    premierGarageRequis: vi.fn().mockResolvedValue(true),
    creerPremierGarage: vi.fn().mockResolvedValue({ email: SAISIE.email }),
  };
  const authentification = {
    ouvrirSessionPourPremierCompte: vi.fn().mockResolvedValue({
      session: {
        tokenClair: 'jeton-secret',
        sessionId: 's',
        expireLe: new Date('2030-01-01T00:00:00Z'),
      },
      corps: SESSION,
    }),
  };
  const config = { SESSION_COOKIE_NOM: 'dfa_session', COOKIE_SECURE: true } as never;
  const controleur = new InstallationController(
    installation as never,
    authentification as never,
    config,
  );
  const res = { cookie: vi.fn() };
  const req = { ip: '203.0.113.7', headers: { 'user-agent': 'vitest' } };
  return { controleur, installation, authentification, res, req };
}

describe('InstallationController', () => {
  it('GET etat ne rend que le booléen', async () => {
    const { controleur } = fabrique();
    expect(await controleur.etat()).toEqual({ premierGarageRequis: true });
  });

  it('POST premier-garage crée, ouvre la session et pose le cookie', async () => {
    const { controleur, installation, authentification, res, req } = fabrique();
    const corps = await controleur.premierGarage(SAISIE, req as never, res as never);
    expect(corps).toBe(SESSION);
    expect(installation.creerPremierGarage).toHaveBeenCalledWith(SAISIE, '203.0.113.7');
    expect(authentification.ouvrirSessionPourPremierCompte).toHaveBeenCalledWith(
      SAISIE.email,
      '203.0.113.7',
      'vitest',
    );
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie.mock.calls[0]?.[1]).toBe('jeton-secret');
  });

  it('un refus de création n’ouvre aucune session et ne pose aucun cookie', async () => {
    const { controleur, installation, authentification, res, req } = fabrique();
    installation.creerPremierGarage.mockRejectedValue(new Error('refus'));
    await expect(controleur.premierGarage(SAISIE, req as never, res as never)).rejects.toThrow(
      'refus',
    );
    expect(authentification.ouvrirSessionPourPremierCompte).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
