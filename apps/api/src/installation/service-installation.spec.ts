import { describe, expect, it, vi } from 'vitest';

import { ErreurCreerGarage, creerGarage } from '../cli/creer-garage.service';
import { ErreurMetier } from '../common/erreurs';
import type { Config } from '../config/config.types';
import {
  codeInstallationCorrespond,
  empreinterCodeInstallation,
  genererCodeInstallation,
} from './code-installation';
import { ServiceInstallation } from './service-installation';
import type { ConnexionInstallation, FournisseurConnexionInstallation } from './installation.types';

vi.mock('../cli/creer-garage.service', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../cli/creer-garage.service')>();
  return { ...reel, creerGarage: vi.fn() };
});
const creerGarageMock = vi.mocked(creerGarage);

/** Base simulée : garages, ligne de code, et un verrou consultatif réellement exclusif. */
class BaseSimulee {
  garages = 0;
  code: { sel: Buffer; empreinte: Buffer } | null = null;
  requetes: string[] = [];
  verrouLibre = true;
  private attente: Array<() => void> = [];
  liberations: boolean[] = [];

  private async verrouiller(): Promise<void> {
    if (this.verrouLibre) {
      this.verrouLibre = false;
      return;
    }
    await new Promise<void>((resoudre) => this.attente.push(resoudre));
  }
  private deverrouiller(): void {
    const suivant = this.attente.shift();
    if (suivant) suivant();
    else this.verrouLibre = true;
  }

  connexion(): ConnexionInstallation {
    return {
      query: async (texte, valeurs) => {
        this.requetes.push(texte);
        if (texte.includes('pg_advisory_lock')) {
          await this.verrouiller();
          return { rows: [] };
        }
        if (texte.includes('pg_advisory_unlock')) {
          this.deverrouiller();
          return { rows: [] };
        }
        if (texte.includes('from tenant')) return { rows: [{ existe: this.garages > 0 }] };
        if (texte.startsWith('delete from amorcage.code_installation')) {
          this.code = null;
          return { rows: [] };
        }
        if (texte.includes('insert into amorcage.code_installation')) {
          const [sel, empreinte] = valeurs as [Buffer, Buffer];
          this.code = { sel, empreinte };
          return { rows: [] };
        }
        if (texte.includes('from amorcage.code_installation')) {
          return { rows: this.code ? [this.code] : [] };
        }
        throw new Error(`requête inattendue : ${texte}`);
      },
      liberer: (detruire) => {
        this.liberations.push(detruire);
      },
    };
  }

  fournisseur(): FournisseurConnexionInstallation {
    return { emprunter: async () => this.connexion(), fermer: async () => undefined };
  }
}

interface Limiteur {
  consommer: ReturnType<typeof vi.fn>;
}

function fabrique(base: BaseSimulee, limiteur?: Limiteur) {
  const lim = limiteur ?? {
    consommer: vi.fn().mockResolvedValue({ autorise: true, resteSecondes: 0 }),
  };
  const hacher = vi.fn().mockResolvedValue('hash');
  const service = new ServiceInstallation(
    base.fournisseur(),
    { hacher } as never,
    lim as never,
    { LIMITE_FENETRE_SECONDES: 900 } as Config,
  );
  return { service, limiteur: lim, hacher };
}

const SAISIE = {
  garage: 'Garage Exemple',
  prenom: 'Claire',
  nom: 'Martin',
  email: 'direction@exemple.ch',
  motDePasse: 'une phrase de passe assez longue',
};

function creationReussie(base: BaseSimulee) {
  creerGarageMock.mockImplementation(async () => {
    await Promise.resolve();
    base.garages += 1;
    return {
      tenantId: 't',
      slug: 's',
      siteId: 'si',
      siteCode: 'c',
      utilisateurId: 'u',
      email: 'direction@exemple.ch',
      role: 'direction',
    };
  });
}

async function codeValide(base: BaseSimulee, service: ServiceInstallation): Promise<string> {
  const code = await service.preparerCodeDemarrage();
  expect(code).not.toBeNull();
  expect(base.code).not.toBeNull();
  return code as string;
}

describe('ServiceInstallation', () => {
  describe('état', () => {
    it('sans garage : premier garage requis', async () => {
      const base = new BaseSimulee();
      expect(await fabrique(base).service.premierGarageRequis()).toBe(true);
    });

    it('avec un garage : plus requis, et plus aucune requête base ensuite', async () => {
      const base = new BaseSimulee();
      base.garages = 1;
      const { service } = fabrique(base);
      expect(await service.premierGarageRequis()).toBe(false);
      const avant = base.requetes.length;
      expect(await service.premierGarageRequis()).toBe(false);
      expect(base.requetes.length).toBe(avant);
    });
  });

  describe('code de démarrage', () => {
    it('sans garage : stocke une empreinte (jamais le clair) et rend le code', async () => {
      const base = new BaseSimulee();
      const { service } = fabrique(base);
      const code = await codeValide(base, service);
      expect(codeInstallationCorrespond(code, base.code!)).toBe(true);
      expect(JSON.stringify(base.requetes)).not.toContain(code);
    });

    it('régénère un code différent à chaque démarrage, l’ancien devient invalide', async () => {
      const base = new BaseSimulee();
      const { service } = fabrique(base);
      const premier = await codeValide(base, service);
      const second = await codeValide(base, service);
      expect(second).not.toBe(premier);
      expect(codeInstallationCorrespond(premier, base.code!)).toBe(false);
    });

    it('avec un garage : supprime le code et n’en rend aucun', async () => {
      const base = new BaseSimulee();
      base.code = empreinterCodeInstallation('ABCD-EFGH-JKMN');
      base.garages = 1;
      const { service } = fabrique(base);
      expect(await service.preparerCodeDemarrage()).toBeNull();
      expect(base.code).toBeNull();
    });

    it('rend le verrou et la connexion', async () => {
      const base = new BaseSimulee();
      await codeValide(base, fabrique(base).service);
      expect(base.verrouLibre).toBe(true);
      expect(base.liberations).toEqual([false]);
    });
  });

  describe('création du premier garage', () => {
    it('code faux : INSTALLATION_CODE_INVALIDE, aucun garage créé', async () => {
      creerGarageMock.mockReset();
      const base = new BaseSimulee();
      const { service } = fabrique(base);
      await codeValide(base, service);
      await expect(
        service.creerPremierGarage({ ...SAISIE, codeInstallation: 'AAAA-BBBB-CCCC' }, '1.2.3.4'),
      ).rejects.toMatchObject({ code: 'INSTALLATION_CODE_INVALIDE', status: 403 });
      expect(creerGarageMock).not.toHaveBeenCalled();
      expect(base.garages).toBe(0);
      expect(base.verrouLibre).toBe(true);
    });

    it('aucun code stocké : INSTALLATION_CODE_INVALIDE', async () => {
      creerGarageMock.mockReset();
      const base = new BaseSimulee();
      const { service } = fabrique(base);
      await expect(
        service.creerPremierGarage(
          { ...SAISIE, codeInstallation: genererCodeInstallation() },
          '1.2.3.4',
        ),
      ).rejects.toMatchObject({ code: 'INSTALLATION_CODE_INVALIDE' });
      expect(creerGarageMock).not.toHaveBeenCalled();
    });

    it('bon code (saisie tolérante) : crée le garage, `source: web`, efface le code', async () => {
      creerGarageMock.mockReset();
      const base = new BaseSimulee();
      creationReussie(base);
      const { service, hacher } = fabrique(base);
      const code = await codeValide(base, service);

      const resultat = await service.creerPremierGarage(
        { ...SAISIE, codeInstallation: code.toLowerCase().replaceAll('-', ' ') },
        '1.2.3.4',
      );

      expect(resultat).toEqual({ email: 'direction@exemple.ch' });
      expect(creerGarageMock).toHaveBeenCalledTimes(1);
      const [, entree, fnHacher] = creerGarageMock.mock.calls[0]!;
      expect(entree).toEqual({
        garage: 'Garage Exemple',
        email: 'direction@exemple.ch',
        motDePasse: SAISIE.motDePasse,
        prenom: 'Claire',
        nom: 'Martin',
        source: 'web',
      });
      await fnHacher('x');
      expect(hacher).toHaveBeenCalledWith('x');
      expect(base.code).toBeNull();
      expect(await service.premierGarageRequis()).toBe(false);
    });

    it('code à usage unique : le même code ne sert pas deux fois', async () => {
      creerGarageMock.mockReset();
      const base = new BaseSimulee();
      creationReussie(base);
      const { service } = fabrique(base);
      const code = await codeValide(base, service);
      await service.creerPremierGarage({ ...SAISIE, codeInstallation: code }, null);
      await expect(
        service.creerPremierGarage({ ...SAISIE, codeInstallation: code }, null),
      ).rejects.toMatchObject({ code: 'INSTALLATION_DEJA_FAITE', status: 409 });
    });

    it('garage déjà présent : INSTALLATION_DEJA_FAITE, même avec un faux code', async () => {
      creerGarageMock.mockReset();
      const base = new BaseSimulee();
      base.garages = 1;
      const { service } = fabrique(base);
      await expect(
        service.creerPremierGarage({ ...SAISIE, codeInstallation: 'AAAA-BBBB-CCCC' }, '1.2.3.4'),
      ).rejects.toMatchObject({ code: 'INSTALLATION_DEJA_FAITE', status: 409 });
      expect(creerGarageMock).not.toHaveBeenCalled();
    });

    it('course : deux créations simultanées avec le bon code -> une seule réussit', async () => {
      creerGarageMock.mockReset();
      const base = new BaseSimulee();
      creationReussie(base);
      const { service } = fabrique(base);
      const code = await codeValide(base, service);

      const resultats = await Promise.allSettled([
        service.creerPremierGarage({ ...SAISIE, codeInstallation: code }, '1.1.1.1'),
        service.creerPremierGarage({ ...SAISIE, codeInstallation: code }, '2.2.2.2'),
      ]);

      expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refus = resultats.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refus.reason).toBeInstanceOf(ErreurMetier);
      expect((refus.reason as ErreurMetier).code).toBe('INSTALLATION_DEJA_FAITE');
      expect(creerGarageMock).toHaveBeenCalledTimes(1);
      expect(base.garages).toBe(1);
      expect(base.verrouLibre).toBe(true);
    });

    it.each([
      ['GARAGE_INVALIDE', 'garage'],
      ['COURRIEL_INVALIDE', 'email'],
      ['MOT_DE_PASSE_FAIBLE', 'motDePasse'],
    ] as const)('%s -> VALIDATION_ECHOUEE sur le champ %s', async (code, champ) => {
      creerGarageMock.mockReset();
      creerGarageMock.mockRejectedValue(new ErreurCreerGarage(code, 'refus'));
      const base = new BaseSimulee();
      const { service } = fabrique(base);
      const clair = await codeValide(base, service);
      await expect(
        service.creerPremierGarage({ ...SAISIE, codeInstallation: clair }, null),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ECHOUEE',
        status: 400,
        erreurs: [{ champ, code, message: 'refus' }],
      });
      expect(base.code).not.toBeNull();
      expect(base.verrouLibre).toBe(true);
    });

    it('GARAGE_EXISTANT (course sur la contrainte) -> INSTALLATION_DEJA_FAITE', async () => {
      creerGarageMock.mockReset();
      creerGarageMock.mockRejectedValue(new ErreurCreerGarage('GARAGE_EXISTANT', 'x'));
      const base = new BaseSimulee();
      const { service } = fabrique(base);
      const clair = await codeValide(base, service);
      await expect(
        service.creerPremierGarage({ ...SAISIE, codeInstallation: clair }, null),
      ).rejects.toMatchObject({ code: 'INSTALLATION_DEJA_FAITE' });
    });

    it('limitation de débit : 429 avec Retry-After, rien n’est lu ni créé', async () => {
      creerGarageMock.mockReset();
      const base = new BaseSimulee();
      const limiteur = {
        consommer: vi.fn().mockResolvedValue({ autorise: false, resteSecondes: 42 }),
      };
      const { service } = fabrique(base, limiteur);
      await expect(
        service.creerPremierGarage({ ...SAISIE, codeInstallation: 'AAAA-BBBB-CCCC' }, '9.9.9.9'),
      ).rejects.toMatchObject({
        code: 'AUTH_TROP_DE_TENTATIVES',
        status: 429,
        enTetes: { 'Retry-After': '42' },
      });
      expect(limiteur.consommer).toHaveBeenCalledWith('installation:ip:9.9.9.9', 5, 900);
      expect(base.requetes).toHaveLength(0);
    });

    it('limite aussi globalement, toutes adresses confondues', async () => {
      const base = new BaseSimulee();
      const limiteur = {
        consommer: vi
          .fn()
          .mockResolvedValueOnce({ autorise: true, resteSecondes: 0 })
          .mockResolvedValueOnce({ autorise: false, resteSecondes: 0 }),
      };
      const { service } = fabrique(base, limiteur);
      await expect(
        service.creerPremierGarage({ ...SAISIE, codeInstallation: 'A' }, '9.9.9.9'),
      ).rejects.toMatchObject({
        code: 'AUTH_TROP_DE_TENTATIVES',
        enTetes: { 'Retry-After': '900' },
      });
      expect(limiteur.consommer).toHaveBeenNthCalledWith(2, 'installation:global', 30, 900);
    });
  });
});
