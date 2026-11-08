import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/config.types';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ServicePolitiqueMotDePasse } from '../politique-mot-de-passe';
import { ErreurTropDeTentatives } from '../erreurs-auth';
import { ServiceProfilCourant } from './profil-courant.service';

const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 's1',
  tenantId: 't1',
  utilisateurId: 'u1',
  role: 'receptionnaire',
  langue: 'fr',
  motDePasseAChanger: true,
};

function monter(options: { actuelValide: boolean; budgetAutorise?: boolean }) {
  const ecritures: Array<Record<string, unknown>> = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: async () => [
          { email: 'neuf@garage.test', motDePasseHash: 'H', motDePasseAChanger: true },
        ],
      }),
    }),
    update: () => ({
      set: (valeurs: Record<string, unknown>) => {
        ecritures.push(valeurs);
        return { where: async () => undefined };
      },
    }),
  };
  const accesBase = { enTenant: vi.fn(async (_c: unknown, f: (t: unknown) => unknown) => f(tx)) };
  const accesAmorcage = { journaliserSecurite: vi.fn(async () => undefined) };
  const servicePwd = {
    verifier: vi.fn(async () => options.actuelValide),
    hacher: vi.fn(async (c: string) => `HASH(${c})`),
  };
  const limiteur = {
    consommer: vi.fn(async () => ({ autorise: options.budgetAutorise ?? true, resteSecondes: 30 })),
  };
  const service = new ServiceProfilCourant(
    { LIMITE_CONNEXION_COMPTE: 5, LIMITE_FENETRE_SECONDES: 900 } as Config,
    accesBase as never,
    accesAmorcage as never,
    servicePwd as never,
    limiteur as never,
    new ServicePolitiqueMotDePasse(),
    { actuelOuNull: () => null } as never,
  );
  return { service, ecritures, servicePwd, limiteur, accesAmorcage };
}

describe('ServiceProfilCourant.changerMotDePasse', () => {
  it('succès : écrit le hash, lève le drapeau, révoque les autres sessions, journalise', async () => {
    const m = monter({ actuelValide: true });
    await m.service.changerMotDePasse(
      PRINCIPAL,
      { motDePasseActuel: 'temporaire-xyz', nouveauMotDePasse: 'Un-Nouveau-Mdp-2026!' },
      '127.0.0.1',
      null,
    );
    expect(m.ecritures[0]).toMatchObject({
      motDePasseHash: 'HASH(Un-Nouveau-Mdp-2026!)',
      motDePasseAChanger: false,
    });
    expect(m.ecritures[1]).toHaveProperty('revoqueeLe');
    expect(m.accesAmorcage.journaliserSecurite).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reinitialisation_reussie', utilisateurId: 'u1' }),
    );
  });

  it('mot de passe actuel faux : VALIDATION_ECHOUEE, rien écrit, budget consommé', async () => {
    const m = monter({ actuelValide: false });
    await expect(
      m.service.changerMotDePasse(
        PRINCIPAL,
        { motDePasseActuel: 'faux', nouveauMotDePasse: 'Un-Nouveau-Mdp-2026!' },
        null,
        null,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(m.ecritures).toEqual([]);
    expect(m.servicePwd.hacher).not.toHaveBeenCalled();
    expect(m.limiteur.consommer).toHaveBeenCalledOnce();
  });

  it('mot de passe actuel faux au-delà du budget : 429', async () => {
    const m = monter({ actuelValide: false, budgetAutorise: false });
    await expect(
      m.service.changerMotDePasse(
        PRINCIPAL,
        { motDePasseActuel: 'faux', nouveauMotDePasse: 'Un-Nouveau-Mdp-2026!' },
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(ErreurTropDeTentatives);
  });

  it('refuse un nouveau mot de passe identique à l’actuel et un mot de passe trop commun', async () => {
    const m = monter({ actuelValide: true });
    await expect(
      m.service.changerMotDePasse(
        PRINCIPAL,
        { motDePasseActuel: 'Temporaire-Identique-1', nouveauMotDePasse: 'Temporaire-Identique-1' },
        null,
        null,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    await expect(
      m.service.changerMotDePasse(
        PRINCIPAL,
        { motDePasseActuel: 'temporaire-xyz', nouveauMotDePasse: 'password1234' },
        null,
        null,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(m.ecritures).toEqual([]);
  });
});

describe('ServiceProfilCourant.changerLangue', () => {
  it('écrit la langue sur la ligne du principal uniquement', async () => {
    const m = monter({ actuelValide: true });
    await m.service.changerLangue(PRINCIPAL, { langue: 'de' });
    expect(m.ecritures).toEqual([{ langue: 'de' }]);
  });
});
