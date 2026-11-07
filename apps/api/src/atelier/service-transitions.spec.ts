import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneLigneOr, LigneOrdreReparation } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

vi.mock('./or-requetes', () => ({
  chargerOrPourEcriture: vi.fn(),
  listerLignesOr: vi.fn(),
}));

vi.mock('./references', () => ({
  chargerParametresAtelier: vi.fn(async () => ({ controleQualite: 'jamais' })),
  chargerClientLigne: vi.fn(async () => ({ poObligatoire: false })),
}));

import * as orRequetes from './or-requetes';
import { ServiceTransitions } from './service-transitions';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';
const MAINTENANT = new Date('2026-11-06T10:00:00.000Z');

const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 'session-1',
  tenantId: 'tenant-a',
  utilisateurId: 'user-1',
  role: 'chef_atelier',
  langue: 'fr',
};

function ligne(id: string, statut: LigneLigneOr['statut'], numero: number): LigneLigneOr {
  return {
    id,
    type: 'main_oeuvre_bareme',
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    numeroOrdre: numero,
    statut,
    origine: 'commandee',
    designation: `Ligne ${String(numero)}`,
    montantTtcCentimes: 10_810,
  } as LigneLigneOr;
}

/** `lignesNonRealisees` = ce que renvoie le SELECT de la garde I-10 (le filtre SQL est celui de
 *  production, non rejoué ici : ce test prouve le branchement, le corps de l'erreur et l'ordre). */
function construire(lignesNonRealisees: LigneLigneOr[], precedents: LigneLigneOr[][] = []) {
  const files = [...precedents];
  const ecritures: { table: unknown; valeurs: unknown }[] = [];
  const tx = {
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve(files.shift() ?? lignesNonRealisees) }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (valeurs: unknown) => {
        ecritures.push({ table, valeurs });
        return { where: () => Promise.resolve([]) };
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (valeurs: unknown) => {
        ecritures.push({ table, valeurs });
        return Promise.resolve([]);
      },
    })),
  } as unknown as TransactionDfa;
  vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue({
    id: OR_ID,
    tenantId: 'tenant-a',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    statut: 'controle',
  } as LigneOrdreReparation);

  const acces = {
    enTenant: async (_c: ContexteTenant, t: (tx: TransactionDfa) => Promise<unknown>) => t(tx),
  };
  const publier = vi.fn(async () => undefined);
  const assemblerDocument = vi.fn(async () => ({ id: OR_ID }));
  const service = new ServiceTransitions(
    acces as never,
    { publier } as never,
    { pointagesOuvertsPourOr: vi.fn(async () => []) } as never,
    { maintenant: () => MAINTENANT } as never,
    { assemblerDocument } as never,
    {} as never,
  );
  return { service, ecritures, publier, assemblerDocument };
}

beforeEach(() => vi.clearAllMocks());

describe('ServiceTransitions.validerControle — garde I-10 (lignes non réalisées)', () => {
  it('refuse avec OR_LIGNE_NON_REALISEE, les lignes bloquantes et MARQUER_LIGNES_REALISEES, sans rien écrire', async () => {
    const { service, ecritures, publier } = construire([
      ligne('l-1', 'validee', 1),
      ligne('l-2', 'en_cours', 2),
    ]);

    const erreur = await service
      .validerControle(CTX, PRINCIPAL, OR_ID, {
        controleurId: 'user-2',
        pointsControles: [{ code: 'freins', conforme: true }],
      })
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurMetier);
    const e = erreur as ErreurMetier;
    expect(e.code).toBe('OR_LIGNE_NON_REALISEE');
    expect(e.status).toBe(409);
    expect(e.actionsProposees).toEqual([{ code: 'MARQUER_LIGNES_REALISEES' }]);
    expect(e.blocages?.map((b) => [b.id, b.donnees?.statut, b.donnees?.type])).toEqual([
      ['l-1', 'validee', 'main_oeuvre_bareme'],
      ['l-2', 'en_cours', 'main_oeuvre_bareme'],
    ]);
    expect(e.detail).toContain('2 ligne(s)');
    expect(ecritures).toHaveLength(0);
    expect(publier).not.toHaveBeenCalled();
  });

  it('accepte quand toutes les lignes sont réalisées : OR termine + contrôle conforme + événement', async () => {
    const { service, ecritures, publier } = construire([]);

    await service.validerControle(CTX, PRINCIPAL, OR_ID, {
      controleurId: 'user-2',
      pointsControles: [{ code: 'freins', conforme: true }],
    });

    expect(ecritures[0]?.valeurs).toEqual({ statut: 'termine', termineLe: MAINTENANT });
    expect(ecritures[1]?.valeurs).toMatchObject({ conforme: true, controleurId: 'user-2' });
    expect(publier).toHaveBeenCalledTimes(1);
  });

  it('terminer expose les mêmes blocages (statut + type), code et action', async () => {
    // 1er SELECT = garde I-08 (aucune ligne à valider), 2e = garde I-10.
    const { service } = construire([ligne('l-1', 'validee', 1)], [[]]);

    const erreur = (await service
      .terminer(CTX, PRINCIPAL, OR_ID, { unite: 'km' } as never)
      .catch((e: unknown) => e)) as ErreurMetier;

    expect(erreur.code).toBe('OR_LIGNE_NON_REALISEE');
    expect(erreur.actionsProposees).toEqual([{ code: 'MARQUER_LIGNES_REALISEES' }]);
    expect(erreur.blocages?.[0]).toMatchObject({
      id: 'l-1',
      donnees: { statut: 'validee', type: 'main_oeuvre_bareme' },
    });
  });
});
