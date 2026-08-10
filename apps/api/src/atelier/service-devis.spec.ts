import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FiltresDevis } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneDevisComplementaire, LigneOrdreReparation } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';

/**
 * Correctif N+1 sur `ServiceDevis.lister()` (audit backend, `GET
 * /ordres-reparation/{orId}/devis-complementaires`) : la version précédente appelait
 * `chargerResumeUtilisateur(tx, ctx, d.emetteurId)` une fois PAR DEVIS de la page — une page de N
 * devis ouvrait N requêtes sur `utilisateur`, même quand plusieurs devis partagent le même
 * émetteur. Ce fichier prouve que la version corrigée n'ouvre plus qu'UN SEUL aller-retour
 * (`chargerResumesUtilisateurs`, `./references`), dédoublonné, quel que soit le nombre de devis —
 * même doctrine de preuve que `service-or.journal.spec.ts` / `service-or.listerDemandes.spec.ts`.
 */
vi.mock('./or-requetes', () => ({
  chargerOr: vi.fn(),
  listerDevisOr: vi.fn(),
  listerLignesDevis: vi.fn().mockResolvedValue([]),
}));
vi.mock('./references', () => ({
  chargerResumesUtilisateurs: vi.fn().mockResolvedValue(new Map()),
}));

import { ServiceDevis } from './service-devis';
import * as orRequetes from './or-requetes';
import * as references from './references';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';

function principal(): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role: 'direction',
    langue: 'fr',
  };
}

function accesBaseFactice() {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail({} as TransactionDfa),
    ),
  };
}

function serviceFactice(acces: ReturnType<typeof accesBaseFactice>): ServiceDevis {
  return new ServiceDevis(acces as never, {} as never, {} as never, {} as never);
}

function devisFixture(
  id: string,
  numeroOrdre: number,
  emetteurId: string | null,
): LigneDevisComplementaire {
  return {
    id,
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    numeroOrdre,
    montantTtcCentimes: 10_000,
    nouveauPlafondCentimes: null,
    impactRestitutionLe: null,
    envoyeLe: new Date('2026-08-01T08:00:00.000Z'),
    canal: 'comptoir',
    emetteurId,
    interlocuteurNom: null,
    reponduLe: null,
    decision: null,
    retranscription: null,
    preuve: null,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
  } as LigneDevisComplementaire;
}

const FILTRES_VIDES: FiltresDevis = { tri: 'numeroOrdre:asc' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceDevis.lister — résumés utilisateur par lot (correctif N+1)', () => {
  it("3 devis (2 émetteurs distincts, 1 doublon) ne déclenchent qu'UN SEUL appel à chargerResumesUtilisateurs — jamais un par devis", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerLignesDevis).mockResolvedValue([]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([
      devisFixture('devis-1', 1, 'user-a'),
      devisFixture('devis-2', 2, 'user-a'),
      devisFixture('devis-3', 3, 'user-b'),
    ]);
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(
      new Map([
        ['user-a', { utilisateurId: 'user-a', nomAffiche: 'Alice Un' }],
        ['user-b', { utilisateurId: 'user-b', nomAffiche: 'Bruno Deux' }],
      ]),
    );
    const service = serviceFactice(accesBaseFactice());

    const resultat = await service.lister(CTX, principal(), OR_ID, FILTRES_VIDES, 25, undefined);

    expect(references.chargerResumesUtilisateurs).toHaveBeenCalledTimes(1);
    expect(resultat.donnees.find((d) => d.id === 'devis-1')?.emetteur).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(resultat.donnees.find((d) => d.id === 'devis-2')?.emetteur).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(resultat.donnees.find((d) => d.id === 'devis-3')?.emetteur).toEqual({
      utilisateurId: 'user-b',
      nomAffiche: 'Bruno Deux',
    });
  });

  it("emetteurId renseigné mais ABSENT du lot rendu (utilisateur supprimé, ou d'un autre tenant) retombe sur emetteur: null — jamais un nom vide, jamais le devis écarté", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerLignesDevis).mockResolvedValue([]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([
      devisFixture('devis-1', 1, 'user-introuvable'),
    ]);
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(new Map());
    const service = serviceFactice(accesBaseFactice());

    const resultat = await service.lister(CTX, principal(), OR_ID, FILTRES_VIDES, 25, undefined);

    expect(resultat.donnees).toHaveLength(1);
    expect(resultat.donnees[0]?.emetteur).toBeNull();
  });
});
