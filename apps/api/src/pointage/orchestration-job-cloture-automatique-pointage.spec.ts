/**
 * `executerJobClotureAutomatiquePointage` — tests d'ORCHESTRATION MULTI-TENANT, dépendances
 * entièrement simulées (même patron que `job-mise-a-jour-referentiel-vehicules-ch.spec.ts`, le
 * modèle) : la logique de calcul par tenant (`ServiceClotureAutomatiquePointage.executerPour-
 * Tenant`) est déjà verrouillée par `service-cloture-automatique-pointage.spec.ts`, ce fichier
 * prouve seulement que le PASSAGE relie correctement énumération -> ctx par tenant -> service,
 * sans jamais mélanger deux tenants ni s'arrêter au premier échec.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  executerJobClotureAutomatiquePointage,
  type CollaborateursJobClotureAutomatiquePointage,
} from './orchestration-job-cloture-automatique-pointage';
import type { ResultatClotureAutomatiquePointage } from './service-cloture-automatique-pointage';

const RUN_ID = 'run-abc-123';

function resultat(
  overrides: Partial<ResultatClotureAutomatiquePointage> = {},
): ResultatClotureAutomatiquePointage {
  return { clotures: 0, examines: 0, ignores: 0, encoreATraiter: false, ...overrides };
}

function collaborateurs(
  overrides: Partial<CollaborateursJobClotureAutomatiquePointage> = {},
): CollaborateursJobClotureAutomatiquePointage {
  return {
    runId: RUN_ID,
    chargerTenantsActifs: vi.fn(async () => []),
    executerPourTenant: vi.fn(async () => resultat()),
    journaliser: vi.fn(),
    ...overrides,
  };
}

describe('executerJobClotureAutomatiquePointage — isolation tenant', () => {
  it('appelle executerPourTenant une fois par tenant actif, avec un ctx propre à CHAQUE tenant (utilisateurId null, requeteId préfixé par le runId commun)', async () => {
    const executerPourTenant = vi
      .fn<CollaborateursJobClotureAutomatiquePointage['executerPourTenant']>()
      .mockImplementation(async () => resultat({ clotures: 2, examines: 2 }));
    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a', 'tenant-b']),
      executerPourTenant,
    });

    const resultatJob = await executerJobClotureAutomatiquePointage(c);

    expect(executerPourTenant).toHaveBeenCalledTimes(2);
    const [ctxA] = executerPourTenant.mock.calls[0] ?? [];
    const [ctxB] = executerPourTenant.mock.calls[1] ?? [];
    if (!ctxA || !ctxB) throw new Error('executerPourTenant aurait dû être appelé deux fois.');

    expect(ctxA).toEqual({
      tenantId: 'tenant-a',
      utilisateurId: null,
      requeteId: `job:pointage-cloture-automatique:${RUN_ID}`,
    });
    expect(ctxB).toEqual({
      tenantId: 'tenant-b',
      utilisateurId: null,
      requeteId: `job:pointage-cloture-automatique:${RUN_ID}`,
    });
    // Jamais le ctx d'un tenant appliqué à l'autre.
    expect(ctxA.tenantId).not.toBe(ctxB.tenantId);

    expect(resultatJob.tenantsTraites).toBe(2);
    expect(resultatJob.tenantsEnErreur).toBe(0);
    expect(resultatJob.resultats).toEqual([
      { tenantId: 'tenant-a', clotures: 2, examines: 2, ignores: 0, passages: 1 },
      { tenantId: 'tenant-b', clotures: 2, examines: 2, ignores: 0, passages: 1 },
    ]);
  });

  it('aucun tenant actif -> aucun appel à executerPourTenant, résultat vide', async () => {
    const executerPourTenant = vi.fn();
    const c = collaborateurs({ chargerTenantsActifs: vi.fn(async () => []), executerPourTenant });

    const resultatJob = await executerJobClotureAutomatiquePointage(c);

    expect(executerPourTenant).not.toHaveBeenCalled();
    expect(resultatJob).toEqual({
      runId: RUN_ID,
      tenantsTraites: 0,
      tenantsEnErreur: 0,
      resultats: [],
    });
  });
});

describe('executerJobClotureAutomatiquePointage — isolation d’échec par tenant', () => {
  it('un tenant qui lève ne bloque pas les suivants — tous les tenants sont traités, un seul en erreur', async () => {
    const executerPourTenant = vi
      .fn<CollaborateursJobClotureAutomatiquePointage['executerPourTenant']>()
      .mockImplementationOnce(async () => {
        throw new Error('connexion refusée');
      })
      .mockImplementationOnce(async () => resultat({ clotures: 1, examines: 1 }));

    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-en-echec', 'tenant-ok']),
      executerPourTenant,
    });

    const resultatJob = await executerJobClotureAutomatiquePointage(c);

    expect(executerPourTenant).toHaveBeenCalledTimes(2);
    expect(resultatJob.tenantsTraites).toBe(2);
    expect(resultatJob.tenantsEnErreur).toBe(1);
    expect(resultatJob.resultats[0]).toMatchObject({
      tenantId: 'tenant-en-echec',
      erreur: 'connexion refusée',
    });
    expect(resultatJob.resultats[1]).toMatchObject({ tenantId: 'tenant-ok', clotures: 1 });
  });
});

describe('executerJobClotureAutomatiquePointage — drainage du lot borné par tenant', () => {
  it('encoreATraiter=true fait rappeler executerPourTenant pour le MÊME tenant jusqu’à épuisement', async () => {
    const executerPourTenant = vi
      .fn<CollaborateursJobClotureAutomatiquePointage['executerPourTenant']>()
      .mockResolvedValueOnce(resultat({ clotures: 200, examines: 200, encoreATraiter: true }))
      .mockResolvedValueOnce(resultat({ clotures: 50, examines: 50, encoreATraiter: false }));

    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a']),
      executerPourTenant,
    });

    const resultatJob = await executerJobClotureAutomatiquePointage(c);

    expect(executerPourTenant).toHaveBeenCalledTimes(2);
    expect(resultatJob.resultats).toEqual([
      { tenantId: 'tenant-a', clotures: 250, examines: 250, ignores: 0, passages: 2 },
    ]);
  });

  it('plafond de passages atteint -> s’arrête, journalise, ne boucle jamais indéfiniment', async () => {
    const executerPourTenant = vi.fn(async () =>
      resultat({ clotures: 1, examines: 1, encoreATraiter: true }),
    );
    const journaliser = vi.fn();
    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a']),
      executerPourTenant,
      journaliser,
    });

    const resultatJob = await executerJobClotureAutomatiquePointage(c);

    expect(resultatJob.resultats[0]?.passages).toBe(25);
    expect(
      journaliser.mock.calls.some(([message]) =>
        String(message).includes('plafond de 25 passages atteint'),
      ),
    ).toBe(true);
  });
});
