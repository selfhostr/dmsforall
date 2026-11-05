/**
 * FAILLE CORRIGÉE (audit sécurité #2, gravité HAUTE, DÉFENSE EN PROFONDEUR) — même classe de défaut
 * que celle refermée dans `service-pointage.spec.ts` (`demarrer`/`arreter`/`corriger`/`lister`/
 * `dernierDuJour`), trouvée dans le même passage : `verrouiller`/`deverrouiller` recevaient
 * `entree.siteId` sans jamais le confronter au `principal`.
 *
 * `poste_atelier` (la borne) ne détient AUJOURD'HUI ni `atelier.pointage.verrouiller_periode` ni
 * `.deverrouiller_periode` (`DROITS_POINTAGE_PAR_ROLE`, `matrice-droits.ts`) — le garde HTTP bloque
 * donc déjà cette route pour un compte de service. Ces tests exercent le SERVICE directement, sans
 * passer par ce garde, exactement comme toute la suite `service-pointage.spec.ts` : c'est le point
 * de la défense en profondeur — si ce droit était un jour accordé à un compte de service, ou si un
 * autre compte de service voyait le jour, ce service doit rester sûr par lui-même.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { RoleUtilisateur } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type { ContexteTenant } from '../db';

import { ServiceVerrouillagePeriode } from './service-verrouillage-periode';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MOI = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BORNE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SITE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
/** Site B — même tenant, AUTRE site que celui de la borne. */
const SITE_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const CTX = { tenantId: TENANT, utilisateurId: MOI, requeteId: null } satisfies ContexteTenant;

function principal(role: RoleUtilisateur, utilisateurId: string): PrincipalAuthentifie {
  return {
    sessionId: 'sess',
    tenantId: TENANT,
    utilisateurId,
    role,
    langue: 'fr',
    siteId: role === 'poste_atelier' ? SITE : null,
  };
}

const horlogeStub = {
  maintenant: () => new Date('2026-07-31T09:00:00.000Z'),
} as unknown as ConstructorParameters<typeof ServiceVerrouillagePeriode>[1];

/**
 * `tx` factice couvrant les TROIS chaînes réellement utilisées par ce service :
 *  - `select({...}).from(pointage).where(...)` → résout directement (pas de `.limit`/`.orderBy`
 *    après `.where` dans ce fichier) — `ouverts`, les pointages `en_cours` qui bloqueraient RM-95.
 *  - `update(pointage).set({...}).where(...).returning({...})` → résout au `.returning`.
 *  - `insert(pointageVerrouillageSite).values({...}).onConflictDoUpdate({...})` → résout à
 *    `.onConflictDoUpdate` (`ecrireSeuil`, valeur de retour jamais utilisée par l'appelant).
 */
function txFausseVerrouillage(options: {
  ouverts?: readonly { id: string; technicienId: string }[];
  misAJour?: readonly { id: string }[];
}) {
  const { ouverts = [], misAJour = [] } = options;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(ouverts)),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(misAJour)),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
      })),
    })),
  };
}

function serviceAvecAcces(txOptions: Parameters<typeof txFausseVerrouillage>[0] = {}): {
  service: ServiceVerrouillagePeriode;
  acces: { enTenant: Mock };
} {
  const acces = {
    enTenant: vi.fn((_ctx: unknown, cb: (tx: unknown) => unknown) =>
      cb(txFausseVerrouillage(txOptions)),
    ),
  };
  const service = new ServiceVerrouillagePeriode(
    acces as unknown as ConstructorParameters<typeof ServiceVerrouillagePeriode>[0],
    horlogeStub,
  );
  return { service, acces };
}

describe('ServiceVerrouillagePeriode.verrouiller — confinement de site pour une borne (faille corrigée #2)', () => {
  it('REFUSE (403 DROIT_INSUFFISANT) la borne poste_atelier du site A verrouillant une période du site B — aucune écriture atteinte', async () => {
    const { service, acces } = serviceAvecAcces();
    const entree = { siteId: SITE_B, jusquauLe: '2026-07-31' };

    await expect(
      service.verrouiller(CTX, principal('poste_atelier', BORNE), entree),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('AUTORISE la borne poste_atelier du site A à verrouiller une période de SON PROPRE site', async () => {
    const { service } = serviceAvecAcces({ ouverts: [], misAJour: [{ id: 'p1' }] });
    const entree = { siteId: SITE, jusquauLe: '2026-07-31' };

    const resultat = await service.verrouiller(CTX, principal('poste_atelier', BORNE), entree);
    expect(resultat).toEqual({ siteId: SITE, jusquauLe: '2026-07-31', pointagesVerrouilles: 1 });
  });

  it('N’IMPOSE aucune restriction à un chef d’atelier (personne, portée tenant) verrouillant une période d’un AUTRE site — non régressé', async () => {
    const { service } = serviceAvecAcces({ ouverts: [], misAJour: [{ id: 'p1' }, { id: 'p2' }] });
    const entree = { siteId: SITE_B, jusquauLe: '2026-07-31' };

    const resultat = await service.verrouiller(CTX, principal('chef_atelier', MOI), entree);
    expect(resultat).toEqual({ siteId: SITE_B, jusquauLe: '2026-07-31', pointagesVerrouilles: 2 });
  });

  it('un pointage encore `en_cours` dans la plage bloque toujours l’opération (RM-95) — le refus de site n’a pas dérobé ce contrôle', async () => {
    const { service } = serviceAvecAcces({
      ouverts: [{ id: 'p1', technicienId: MOI }],
      misAJour: [],
    });
    const entree = { siteId: SITE, jusquauLe: '2026-07-31' };

    await expect(
      service.verrouiller(CTX, principal('poste_atelier', BORNE), entree),
    ).rejects.toMatchObject({ code: 'CONFLIT' });
  });
});

describe('ServiceVerrouillagePeriode.deverrouiller — confinement de site pour une borne (faille corrigée #2)', () => {
  it('REFUSE (403 DROIT_INSUFFISANT) la borne poste_atelier du site A déverrouillant une période du site B — aucune écriture atteinte', async () => {
    const { service, acces } = serviceAvecAcces();
    const entree = { siteId: SITE_B, jusquauLe: '2026-07-15', motif: 'Test' };

    await expect(
      service.deverrouiller(CTX, principal('poste_atelier', BORNE), entree),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('AUTORISE la borne poste_atelier du site A à déverrouiller une période de SON PROPRE site', async () => {
    const { service } = serviceAvecAcces({ misAJour: [{ id: 'p1' }] });
    const entree = { siteId: SITE, jusquauLe: '2026-07-15', motif: 'Test' };

    const resultat = await service.deverrouiller(CTX, principal('poste_atelier', BORNE), entree);
    expect(resultat).toEqual({
      siteId: SITE,
      jusquauLe: '2026-07-15',
      pointagesDeverrouilles: 1,
    });
  });

  it('N’IMPOSE aucune restriction à un chef d’atelier (personne, portée tenant) déverrouillant une période d’un AUTRE site — non régressé', async () => {
    const { service } = serviceAvecAcces({ misAJour: [{ id: 'p1' }] });
    const entree = { siteId: SITE_B, jusquauLe: '2026-07-15', motif: 'Test' };

    const resultat = await service.deverrouiller(CTX, principal('chef_atelier', MOI), entree);
    expect(resultat).toEqual({
      siteId: SITE_B,
      jusquauLe: '2026-07-15',
      pointagesDeverrouilles: 1,
    });
  });
});
