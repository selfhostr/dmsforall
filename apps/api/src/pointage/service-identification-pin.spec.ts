import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs/erreur-metier';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type { AccesBase, ContexteTenant } from '../db';
import type { ServiceMotDePasse } from '../auth/auth.types';

// Les requêtes DB sont des fonctions de module : on les simule pour piloter ce que « voit » le
// service sans base. Preuve de la LOGIQUE (identification, unicité, hachage, upsert), pas du SQL.
vi.mock('./pin-requetes', () => ({
  chargerPinsActifsDuSite: vi.fn(),
  chargerPinsActifsAutresTechniciens: vi.fn(),
  chargerLignePin: vi.fn(),
  chargerUtilisateurCible: vi.fn(),
  verifierSiteExiste: vi.fn(),
  insererPin: vi.fn(),
  majPinHash: vi.fn(),
  desactiverPin: vi.fn(),
}));

import {
  chargerLignePin,
  chargerPinsActifsAutresTechniciens,
  chargerPinsActifsDuSite,
  chargerUtilisateurCible,
  desactiverPin,
  insererPin,
  majPinHash,
} from './pin-requetes';
import { ServiceIdentificationPin } from './service-identification-pin';
import type { ServiceVerrouillagePin } from './service-verrouillage-pin';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SITE = '66666666-6666-6666-6666-666666666666';
const BORNE = '44444444-4444-4444-4444-444444444444';
const CHEF = '77777777-7777-7777-7777-777777777777';
const MARCO = '22222222-2222-2222-2222-222222222222';
const LUCA = '33333333-3333-3333-3333-333333333333';

const CTX_BORNE = {
  tenantId: TENANT,
  utilisateurId: BORNE,
  requeteId: null,
} satisfies ContexteTenant;
const CTX_CHEF = {
  tenantId: TENANT,
  utilisateurId: CHEF,
  requeteId: null,
} satisfies ContexteTenant;

/** Faux haché reconnaissable et RÉVERSIBLE par le test — jamais le PIN en clair. */
const PREFIXE_HASH = 'HASH::';
const hasher: ServiceMotDePasse = {
  hacher: (clair: string) => Promise.resolve(`${PREFIXE_HASH}${clair}`),
  verifier: (hash: string, clair: string) => Promise.resolve(hash === `${PREFIXE_HASH}${clair}`),
  verifierLeurre: () => Promise.resolve(),
  doitEtreRehache: () => false,
};

/** `enTenant` déroule simplement le callback avec un faux `tx` (les requêtes sont mockées). */
const acces = {
  enTenant: vi.fn((_ctx: ContexteTenant, cb: (tx: unknown) => unknown) => cb({})),
} as unknown as AccesBase;

function verrouillageStub(overrides: Partial<ServiceVerrouillagePin> = {}): {
  service: ServiceVerrouillagePin;
  etatVerrou: Mock;
  enregistrerEchec: Mock;
  reinitialiser: Mock;
} {
  const etatVerrou = vi.fn(async () => ({ verrouille: false, resteSecondes: 0 }));
  const enregistrerEchec = vi.fn(async () => ({ verrouille: false, resteSecondes: 0 }));
  const reinitialiser = vi.fn(async () => undefined);
  const service = {
    etatVerrou,
    enregistrerEchec,
    reinitialiser,
    ...overrides,
  } as unknown as ServiceVerrouillagePin;
  return { service, etatVerrou, enregistrerEchec, reinitialiser };
}

function principalBorne(): PrincipalAuthentifie {
  return {
    sessionId: 's',
    tenantId: TENANT,
    utilisateurId: BORNE,
    role: 'poste_atelier',
    langue: 'fr',
    siteId: SITE,
  };
}
function principalPersonne(role: RoleUtilisateur, id: string): PrincipalAuthentifie {
  return { sessionId: 's', tenantId: TENANT, utilisateurId: id, role, langue: 'fr', siteId: null };
}

const mockPins = chargerPinsActifsDuSite as unknown as Mock;
const mockAutres = chargerPinsActifsAutresTechniciens as unknown as Mock;
const mockLigne = chargerLignePin as unknown as Mock;
const mockCible = chargerUtilisateurCible as unknown as Mock;
const mockInserer = insererPin as unknown as Mock;
const mockMaj = majPinHash as unknown as Mock;
const mockDesactiver = desactiverPin as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

// =================================================================================================
// Identification (borne)
// =================================================================================================

describe('ServiceIdentificationPin.identifier', () => {
  it('PIN correct → rend l’identité du technicien, et remet l’ardoise à zéro', async () => {
    mockPins.mockResolvedValue([
      { utilisateurId: LUCA, pinHash: `${PREFIXE_HASH}9999`, prenom: 'Luca', nom: 'Rossi' },
      { utilisateurId: MARCO, pinHash: `${PREFIXE_HASH}4071`, prenom: 'Marco', nom: 'Bianchi' },
    ]);
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    const rep = await service.identifier(CTX_BORNE, principalBorne(), '4071');

    expect(rep).toEqual({ technicienId: MARCO, prenom: 'Marco', nom: 'Bianchi' });
    expect(v.reinitialiser).toHaveBeenCalledWith(TENANT, BORNE);
    expect(v.enregistrerEchec).not.toHaveBeenCalled();
  });

  it('PIN inconnu → 401 POINTAGE_PIN_INVALIDE, et enregistre un échec (anti-balayage)', async () => {
    mockPins.mockResolvedValue([
      { utilisateurId: MARCO, pinHash: `${PREFIXE_HASH}4071`, prenom: 'Marco', nom: 'Bianchi' },
    ]);
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    await expect(service.identifier(CTX_BORNE, principalBorne(), '0000')).rejects.toMatchObject({
      code: 'POINTAGE_PIN_INVALIDE',
      status: 401,
    });
    expect(v.enregistrerEchec).toHaveBeenCalledWith(TENANT, BORNE);
    expect(v.reinitialiser).not.toHaveBeenCalled();
  });

  it('borne VERROUILLÉE → 423 POINTAGE_PIN_VERROUILLE + Retry-After, SANS toucher la base', async () => {
    const v = verrouillageStub({
      etatVerrou: vi.fn(async () => ({ verrouille: true, resteSecondes: 120 })) as never,
    });
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    const erreur = await service
      .identifier(CTX_BORNE, principalBorne(), '4071')
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect(erreur).toMatchObject({ code: 'POINTAGE_PIN_VERROUILLE', status: 423 });
    expect((erreur as ErreurMetier).enTetes).toEqual({ 'Retry-After': '120' });
    // Le verrou mord AVANT toute lecture : aucune transaction, aucune requête PIN.
    expect(acces.enTenant).not.toHaveBeenCalled();
    expect(mockPins).not.toHaveBeenCalled();
  });

  it('un compte de PERSONNE (pas la borne) est refusé (session incohérente) sans lire la base', async () => {
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);
    // exigerSiteDuCompteDeService lève pour un non-compte-de-service → jamais d'accès disque.
    await expect(
      service.identifier(CTX_CHEF, principalPersonne('chef_atelier', CHEF), '4071'),
    ).rejects.toBeInstanceOf(Error);
    expect(acces.enTenant).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// Gestion des PIN (encadrement)
// =================================================================================================

describe('ServiceIdentificationPin.attribuer', () => {
  const entree = { siteId: SITE, utilisateurId: MARCO, codePin: '4071' };

  beforeEach(() => {
    mockCible.mockResolvedValue({ id: MARCO, role: 'technicien', statut: 'actif' });
    mockAutres.mockResolvedValue([]);
    mockLigne.mockResolvedValue(null);
  });

  it('HACHE le PIN (jamais en clair) et INSÈRE un nouveau rattachement', async () => {
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    const rep = await service.attribuer(CTX_CHEF, principalPersonne('chef_atelier', CHEF), entree);

    expect(rep).toEqual({ siteId: SITE, utilisateurId: MARCO, actif: true });
    expect(mockInserer).toHaveBeenCalledTimes(1);
    const valeurs = mockInserer.mock.calls[0]![1] as {
      pinHash: string;
      creeParUtilisateurId: string;
    };
    // Le PIN stocké est la SORTIE du hacheur (ici le faux `HASH::…`), jamais le code brut passé en
    // entrée. Avec le vrai Argon2id, `pinHash` serait un PHC `$argon2id$…` — le point prouvé est le
    // même : ce qui atteint la base est le HACHÉ, obtenu via `ServiceMotDePasse.hacher`, pas '4071'.
    expect(valeurs.pinHash).toBe(`${PREFIXE_HASH}4071`);
    expect(valeurs.pinHash).not.toBe('4071');
    expect(valeurs.pinHash).not.toBe(entree.codePin);
    // RM-128 : traçabilité de l'auteur (le chef, pas la cible).
    expect(valeurs.creeParUtilisateurId).toBe(CHEF);
    expect(mockMaj).not.toHaveBeenCalled();
  });

  it('rattachement EXISTANT → met à jour (réinitialisation), n’insère pas', async () => {
    mockLigne.mockResolvedValue({ id: 'x', actif: false });
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    await service.attribuer(CTX_CHEF, principalPersonne('direction', CHEF), entree);

    expect(mockMaj).toHaveBeenCalledTimes(1);
    expect(mockInserer).not.toHaveBeenCalled();
    const args = mockMaj.mock.calls[0]!;
    expect(args[4]).toBe(`${PREFIXE_HASH}4071`); // pinHash haché
    expect(args[5]).toBe(CHEF); // modifiePar
  });

  it('unicité PAR SITE (RM-127) : un PIN déjà porté par un AUTRE technicien actif → 409 CONFLIT, aucune écriture', async () => {
    mockAutres.mockResolvedValue([{ utilisateurId: LUCA, pinHash: `${PREFIXE_HASH}4071` }]);
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    await expect(
      service.attribuer(CTX_CHEF, principalPersonne('chef_atelier', CHEF), entree),
    ).rejects.toMatchObject({ code: 'CONFLIT', status: 409 });
    expect(mockInserer).not.toHaveBeenCalled();
    expect(mockMaj).not.toHaveBeenCalled();
  });

  it('cible = compte de SERVICE (la borne) → 400 VALIDATION_ECHOUEE, aucune écriture', async () => {
    mockCible.mockResolvedValue({ id: BORNE, role: 'poste_atelier', statut: 'actif' });
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    await expect(
      service.attribuer(CTX_CHEF, principalPersonne('chef_atelier', CHEF), {
        ...entree,
        utilisateurId: BORNE,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect(mockInserer).not.toHaveBeenCalled();
  });
});

describe('ServiceIdentificationPin.revoquer', () => {
  const entree = { siteId: SITE, utilisateurId: MARCO };

  it('rattachement actif → désactive (jamais un DELETE)', async () => {
    mockLigne.mockResolvedValue({ id: 'x', actif: true });
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    const rep = await service.revoquer(CTX_CHEF, principalPersonne('chef_atelier', CHEF), entree);

    expect(rep).toEqual({ siteId: SITE, utilisateurId: MARCO, actif: false });
    expect(mockDesactiver).toHaveBeenCalledWith(expect.anything(), CTX_CHEF, SITE, MARCO, CHEF);
  });

  it('aucun rattachement actif → 404 RESSOURCE_INTROUVABLE', async () => {
    mockLigne.mockResolvedValue({ id: 'x', actif: false });
    const v = verrouillageStub();
    const service = new ServiceIdentificationPin(acces, hasher, v.service);

    await expect(
      service.revoquer(CTX_CHEF, principalPersonne('chef_atelier', CHEF), entree),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE', status: 404 });
    expect(mockDesactiver).not.toHaveBeenCalled();
  });
});
