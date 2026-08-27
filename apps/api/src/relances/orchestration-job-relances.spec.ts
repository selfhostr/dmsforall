/**
 * `executerJobRelancesFacture` — tests d'ORCHESTRATION MULTI-TENANT, dépendances entièrement
 * simulées (même patron que `pointage/orchestration-job-cloture-automatique-pointage.spec.ts`, le
 * modèle) : la logique métier (`ServiceRelancesFacture.planifier`/`.envoyerPretes`) est déjà
 * verrouillée par `service-relances-facture.spec.ts`, ce fichier prouve seulement que le PASSAGE
 * relie correctement énumération -> ctx par tenant -> planification -> envoi, sans jamais mélanger
 * deux tenants ni s'arrêter au premier échec.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReponseEnvoiRelances, ReponsePlanificationRelances } from '@dfa/shared';

import {
  executerJobRelancesFacture,
  type CollaborateursJobRelancesFacture,
} from './orchestration-job-relances';

const RUN_ID = 'run-abc-123';

function planif(
  overrides: Partial<ReponsePlanificationRelances> = {},
): ReponsePlanificationRelances {
  return { creees: 0, ignorees: 0, encoreATraiter: false, ...overrides };
}

function envoi(overrides: Partial<ReponseEnvoiRelances> = {}): ReponseEnvoiRelances {
  return { envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false, ...overrides };
}

function collaborateurs(
  overrides: Partial<CollaborateursJobRelancesFacture> = {},
): CollaborateursJobRelancesFacture {
  return {
    runId: RUN_ID,
    chargerTenantsActifs: vi.fn(async () => []),
    planifier: vi.fn(async () => planif()),
    envoyerPretes: vi.fn(async () => envoi()),
    journaliser: vi.fn(),
    ...overrides,
  };
}

describe('executerJobRelancesFacture — isolation tenant', () => {
  it('appelle planifier PUIS envoyerPretes une fois par tenant actif, avec un ctx propre à CHAQUE tenant', async () => {
    const planifier = vi
      .fn<CollaborateursJobRelancesFacture['planifier']>()
      .mockImplementation(async () => planif({ creees: 3 }));
    const envoyerPretes = vi
      .fn<CollaborateursJobRelancesFacture['envoyerPretes']>()
      .mockImplementation(async () => envoi({ envoyees: 2 }));
    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a', 'tenant-b']),
      planifier,
      envoyerPretes,
    });

    const resultatJob = await executerJobRelancesFacture(c);

    expect(planifier).toHaveBeenCalledTimes(2);
    expect(envoyerPretes).toHaveBeenCalledTimes(2);
    const [ctxA] = planifier.mock.calls[0] ?? [];
    const [ctxB] = planifier.mock.calls[1] ?? [];
    if (!ctxA || !ctxB) throw new Error('planifier aurait dû être appelé deux fois.');

    expect(ctxA).toEqual({
      tenantId: 'tenant-a',
      utilisateurId: null,
      requeteId: `job:relances-facture:${RUN_ID}`,
    });
    expect(ctxB).toEqual({
      tenantId: 'tenant-b',
      utilisateurId: null,
      requeteId: `job:relances-facture:${RUN_ID}`,
    });
    expect(ctxA.tenantId).not.toBe(ctxB.tenantId);

    // Ordre PAR tenant : planifier() puis envoyerPretes() pour tenant-a avant de passer à
    // tenant-b (jamais planifier(a), planifier(b), envoyerPretes(a), envoyerPretes(b)).
    const ctxEnvoiA = envoyerPretes.mock.calls[0]?.[0];
    expect(ctxEnvoiA).toEqual(ctxA);

    expect(resultatJob.tenantsTraites).toBe(2);
    expect(resultatJob.tenantsEnErreur).toBe(0);
    expect(resultatJob.resultats).toEqual([
      {
        tenantId: 'tenant-a',
        planifCreees: 3,
        planifIgnorees: 0,
        passagesPlanification: 1,
        envoiEnvoyees: 2,
        envoiEchouees: 0,
        envoiAnnulees: 0,
        passagesEnvoi: 1,
      },
      {
        tenantId: 'tenant-b',
        planifCreees: 3,
        planifIgnorees: 0,
        passagesPlanification: 1,
        envoiEnvoyees: 2,
        envoiEchouees: 0,
        envoiAnnulees: 0,
        passagesEnvoi: 1,
      },
    ]);
  });

  it('aucun tenant actif -> aucun appel, résultat vide', async () => {
    const planifier = vi.fn();
    const envoyerPretes = vi.fn();
    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => []),
      planifier,
      envoyerPretes,
    });

    const resultatJob = await executerJobRelancesFacture(c);

    expect(planifier).not.toHaveBeenCalled();
    expect(envoyerPretes).not.toHaveBeenCalled();
    expect(resultatJob).toEqual({
      runId: RUN_ID,
      tenantsTraites: 0,
      tenantsEnErreur: 0,
      resultats: [],
    });
  });
});

describe('executerJobRelancesFacture — isolation d’échec par tenant', () => {
  it('un tenant dont la planification échoue ne bloque pas les suivants, et n’enchaîne pas l’envoi pour LUI', async () => {
    const planifier = vi
      .fn<CollaborateursJobRelancesFacture['planifier']>()
      .mockImplementationOnce(async () => {
        throw new Error('connexion refusée');
      })
      .mockImplementationOnce(async () => planif({ creees: 1 }));
    const envoyerPretes = vi
      .fn<CollaborateursJobRelancesFacture['envoyerPretes']>()
      .mockImplementation(async () => envoi({ envoyees: 1 }));

    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-en-echec', 'tenant-ok']),
      planifier,
      envoyerPretes,
    });

    const resultatJob = await executerJobRelancesFacture(c);

    expect(planifier).toHaveBeenCalledTimes(2);
    // envoyerPretes n'est appelé QUE pour tenant-ok — jamais pour tenant-en-echec.
    expect(envoyerPretes).toHaveBeenCalledTimes(1);
    expect(envoyerPretes.mock.calls[0]?.[0]).toMatchObject({ tenantId: 'tenant-ok' });

    expect(resultatJob.tenantsTraites).toBe(2);
    expect(resultatJob.tenantsEnErreur).toBe(1);
    expect(resultatJob.resultats[0]).toMatchObject({
      tenantId: 'tenant-en-echec',
      erreur: 'connexion refusée',
    });
    expect(resultatJob.resultats[1]).toMatchObject({
      tenantId: 'tenant-ok',
      planifCreees: 1,
      envoiEnvoyees: 1,
    });
  });

  it('un tenant dont l’ENVOI échoue est aussi isolé, sans perdre le compte de la planification déjà faite', async () => {
    const planifier = vi
      .fn<CollaborateursJobRelancesFacture['planifier']>()
      .mockResolvedValue(planif({ creees: 5 }));
    const envoyerPretes = vi
      .fn<CollaborateursJobRelancesFacture['envoyerPretes']>()
      .mockImplementationOnce(async () => {
        throw new Error('SMTP indisponible');
      });

    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a']),
      planifier,
      envoyerPretes,
    });

    const resultatJob = await executerJobRelancesFacture(c);

    expect(resultatJob.tenantsEnErreur).toBe(1);
    expect(resultatJob.resultats[0]).toMatchObject({
      tenantId: 'tenant-a',
      planifCreees: 5,
      envoiEnvoyees: 0,
      erreur: 'SMTP indisponible',
    });
  });
});

describe('executerJobRelancesFacture — drainage du lot borné par tenant', () => {
  it('encoreATraiter=true (planification) fait rappeler planifier pour le MÊME tenant jusqu’à épuisement', async () => {
    const planifier = vi
      .fn<CollaborateursJobRelancesFacture['planifier']>()
      .mockResolvedValueOnce(planif({ creees: 200, encoreATraiter: true }))
      .mockResolvedValueOnce(planif({ creees: 50, encoreATraiter: false }));
    const envoyerPretes = vi.fn(async () => envoi());

    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a']),
      planifier,
      envoyerPretes,
    });

    const resultatJob = await executerJobRelancesFacture(c);

    expect(planifier).toHaveBeenCalledTimes(2);
    expect(resultatJob.resultats[0]).toMatchObject({
      tenantId: 'tenant-a',
      planifCreees: 250,
      passagesPlanification: 2,
    });
  });

  it('encoreATraiter=true (envoi) fait rappeler envoyerPretes pour le MÊME tenant jusqu’à épuisement', async () => {
    const planifier = vi.fn(async () => planif());
    const envoyerPretes = vi
      .fn<CollaborateursJobRelancesFacture['envoyerPretes']>()
      .mockResolvedValueOnce(envoi({ envoyees: 100, encoreATraiter: true }))
      .mockResolvedValueOnce(envoi({ envoyees: 30, encoreATraiter: false }));

    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a']),
      planifier,
      envoyerPretes,
    });

    const resultatJob = await executerJobRelancesFacture(c);

    expect(envoyerPretes).toHaveBeenCalledTimes(2);
    expect(resultatJob.resultats[0]).toMatchObject({
      tenantId: 'tenant-a',
      envoiEnvoyees: 130,
      passagesEnvoi: 2,
    });
  });

  it('plafond de passages atteint (planification et envoi) -> s’arrête, journalise, ne boucle jamais indéfiniment', async () => {
    const planifier = vi.fn(async () => planif({ creees: 1, encoreATraiter: true }));
    const envoyerPretes = vi.fn(async () => envoi({ envoyees: 1, encoreATraiter: true }));
    const journaliser = vi.fn();
    const c = collaborateurs({
      chargerTenantsActifs: vi.fn(async () => ['tenant-a']),
      planifier,
      envoyerPretes,
      journaliser,
    });

    const resultatJob = await executerJobRelancesFacture(c);

    expect(resultatJob.resultats[0]).toMatchObject({
      passagesPlanification: 25,
      passagesEnvoi: 25,
    });
    expect(
      journaliser.mock.calls.some(([message]) =>
        String(message).includes('plafond de 25 passages de planification atteint'),
      ),
    ).toBe(true);
    expect(
      journaliser.mock.calls.some(([message]) =>
        String(message).includes("plafond de 25 passages d'envoi atteint"),
      ),
    ).toBe(true);
  });
});
