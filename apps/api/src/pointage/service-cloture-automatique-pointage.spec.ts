/**
 * `ServiceClotureAutomatiquePointage` — tests d'ORCHESTRATION, dépendances entièrement simulées
 * (même patron que `service-pointage.spec.ts`, en-tête : la logique de calcul pure est déjà
 * verrouillée par `regles-pointage.spec.ts::determinerDecisionClotureAutomatique`, ce fichier
 * prouve seulement que le SERVICE relie correctement `ctx` -> requêtes -> écritures).
 *
 * `chargerCandidatsClotureAutomatique`/`appliquerClotureAutomatique` (`./pointage-requetes`) sont
 * simulées via `vi.mock` : ce que ces tests prouvent, c'est que le SERVICE fait toujours transiter
 * le MÊME `ctx` reçu en paramètre vers CES DEUX fonctions, sans jamais le mélanger avec un autre
 * tenant — PAS que la requête SQL réelle isole correctement les tenants (ça, c'est une propriété
 * de `enTenant`/RLS, prouvée par ailleurs, et qu'un test qui mocke `tx.execute` ne prouve jamais
 * — voir CONTRIBUTING.md, « pièges vérifiés »). Une preuve en exécution réelle (Postgres, RLS) reste à
 * faire en intégration — signalé dans le rapport de livraison, pas fait ici (pas d'accès Docker
 * dans cette session).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant } from '../db';

import type { CandidatClotureAutomatique, DecisionClotureAutomatique } from './regles-pointage';
import { ServiceClotureAutomatiquePointage } from './service-cloture-automatique-pointage';

vi.mock('./pointage-requetes', () => ({
  chargerCandidatsClotureAutomatique: vi.fn(),
  appliquerClotureAutomatique: vi.fn(),
}));
import {
  appliquerClotureAutomatique,
  chargerCandidatsClotureAutomatique,
} from './pointage-requetes';

const chargerCandidatsMock = vi.mocked(chargerCandidatsClotureAutomatique);
const appliquerMock = vi.mocked(appliquerClotureAutomatique);

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const CTX_A = { tenantId: TENANT_A, utilisateurId: null, requeteId: null } satisfies ContexteTenant;
const CTX_B = { tenantId: TENANT_B, utilisateurId: null, requeteId: null } satisfies ContexteTenant;

const MAINTENANT = new Date('2026-06-10T17:00:00.000Z');

function candidat(surcharge: Partial<CandidatClotureAutomatique> = {}): CandidatClotureAutomatique {
  return {
    id: 'p1',
    debutLe: new Date('2026-06-10T06:00:00.000Z'), // 08:00 heure suisse -> clôture 18:00 due à 17:00Z
    heureCloturePointage: '18:00',
    arrondiPointage: 'quart',
    anomalieMotif: null,
    anomalieDetecteeLe: null,
    ...surcharge,
  };
}

/** Fabrique un `AccesBase` factice dont `enTenant` appelle directement le callback avec une
 *  transaction sentinelle — même patron que `accesStub` de `service-pointage.spec.ts`. */
function accesFactice(): ConstructorParameters<typeof ServiceClotureAutomatiquePointage>[0] {
  return {
    enTenant: vi.fn(async (ctx: ContexteTenant, travail: (tx: unknown) => Promise<unknown>) =>
      travail({ sentinelle: `tx-${ctx.tenantId}` }),
    ),
  } as unknown as ConstructorParameters<typeof ServiceClotureAutomatiquePointage>[0];
}

function horlogeFactice(): ConstructorParameters<typeof ServiceClotureAutomatiquePointage>[1] {
  return { maintenant: () => MAINTENANT } as ConstructorParameters<
    typeof ServiceClotureAutomatiquePointage
  >[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceClotureAutomatiquePointage — isolation tenant', () => {
  it('interroge et écrit avec le tenant du CTX REÇU, jamais un autre — deux tenants traités séparément ne se mélangent jamais', async () => {
    // Chaque tenant a son propre candidat, sa propre heure de clôture de site.
    chargerCandidatsMock.mockImplementation(async (_tx, ctx) =>
      ctx.tenantId === TENANT_A
        ? [candidat({ id: 'pointage-a', heureCloturePointage: '18:00' })]
        : [candidat({ id: 'pointage-b', heureCloturePointage: '17:00' })],
    );
    appliquerMock.mockResolvedValue(true);

    const acces = accesFactice();
    const service = new ServiceClotureAutomatiquePointage(acces, horlogeFactice());

    await service.executerPourTenant(CTX_A);
    await service.executerPourTenant(CTX_B);

    // `enTenant` a bien été appelé une fois par tenant, avec CE tenant précisément.
    expect(acces.enTenant).toHaveBeenCalledTimes(2);
    expect((acces.enTenant as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual(CTX_A);
    expect((acces.enTenant as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toEqual(CTX_B);

    // `chargerCandidatsClotureAutomatique` a reçu le ctx correspondant à CHAQUE appel — jamais
    // le ctx de l'autre tenant.
    expect(chargerCandidatsMock).toHaveBeenCalledTimes(2);
    expect(chargerCandidatsMock.mock.calls[0]?.[1]).toEqual(CTX_A);
    expect(chargerCandidatsMock.mock.calls[1]?.[1]).toEqual(CTX_B);

    // La clôture appliquée pour A porte le pointage DE A, avec le ctx DE A — jamais celui de B,
    // même chose pour B. C'est la preuve qu'aucune donnée du tenant A n'a pu être écrite sous le
    // ctx du tenant B ou inversement.
    expect(appliquerMock).toHaveBeenCalledTimes(2);
    const [, ctxAppelA, decisionA] = appliquerMock.mock.calls[0] as [
      unknown,
      ContexteTenant,
      DecisionClotureAutomatique,
    ];
    const [, ctxAppelB, decisionB] = appliquerMock.mock.calls[1] as [
      unknown,
      ContexteTenant,
      DecisionClotureAutomatique,
    ];
    expect(ctxAppelA).toEqual(CTX_A);
    expect(decisionA.pointageId).toBe('pointage-a');
    expect(ctxAppelB).toEqual(CTX_B);
    expect(decisionB.pointageId).toBe('pointage-b');
  });
});

describe('ServiceClotureAutomatiquePointage — idempotence', () => {
  it('un pointage déjà arrêté (jamais candidat) n’est pas touché : chargerCandidats ne le rend plus, aucune écriture', async () => {
    chargerCandidatsMock.mockResolvedValue([]); // filtré côté requête, statut != en_cours.
    const acces = accesFactice();
    const service = new ServiceClotureAutomatiquePointage(acces, horlogeFactice());

    const resultat = await service.executerPourTenant(CTX_A);

    expect(appliquerMock).not.toHaveBeenCalled();
    expect(resultat).toEqual({ clotures: 0, examines: 0, ignores: 0, encoreATraiter: false });
  });

  it('rejouer deux fois ne change rien la seconde fois : la réclamation conditionnelle rend `false`, comptée en `ignores`, jamais en erreur', async () => {
    chargerCandidatsMock.mockResolvedValue([candidat()]);
    // Simule ce que fait `appliquerClotureAutomatique` en réalité (WHERE statut = 'en_cours') si
    // le pointage a déjà été clos par le passage précédent ou corrigé entre-temps : 0 ligne
    // affectée -> `false`.
    appliquerMock.mockResolvedValue(false);

    const acces = accesFactice();
    const service = new ServiceClotureAutomatiquePointage(acces, horlogeFactice());
    const resultat = await service.executerPourTenant(CTX_A);

    expect(resultat.clotures).toBe(0);
    expect(resultat.ignores).toBe(1);
    expect(resultat.examines).toBe(1);
  });

  it("un pointage corrigé à la main par le chef d'atelier (statut != 'en_cours') n'est plus jamais candidat — même garantie que « déjà arrêté »", async () => {
    // `chargerCandidatsClotureAutomatique` filtre déjà `statut = 'en_cours'` côté SQL (voir son
    // en-tête) : un pointage corrigé (toujours `termine`, `ServicePointage.corriger` ne repasse
    // jamais un pointage à `en_cours`) n'apparaît simplement plus dans la liste — même chemin que
    // le test précédent, aucune décision n'est jamais calculée pour lui.
    chargerCandidatsMock.mockResolvedValue([]);
    const acces = accesFactice();
    const service = new ServiceClotureAutomatiquePointage(acces, horlogeFactice());

    await service.executerPourTenant(CTX_A);

    expect(appliquerMock).not.toHaveBeenCalled();
  });
});

describe('ServiceClotureAutomatiquePointage — lot borné', () => {
  it('un candidat dont l’heure de clôture n’est pas encore atteinte est examiné mais jamais appliqué', async () => {
    // maintenant = 15:00Z (17:00 local), AVANT la clôture 18:00 locale (16:00Z) — rien à clore.
    chargerCandidatsMock.mockResolvedValue([candidat()]);
    const acces = accesFactice();
    const horloge = {
      maintenant: () => new Date('2026-06-10T15:00:00.000Z'),
    } as ConstructorParameters<typeof ServiceClotureAutomatiquePointage>[1];
    const service = new ServiceClotureAutomatiquePointage(acces, horloge);

    const resultat = await service.executerPourTenant(CTX_A);

    expect(appliquerMock).not.toHaveBeenCalled();
    expect(resultat).toEqual({ clotures: 0, examines: 1, ignores: 0, encoreATraiter: false });
  });

  it('signale encoreATraiter quand le lot chargé dépasse la limite (LOT + 1 rendu par le mock)', async () => {
    // Le service demande `limite + 1` = 201 ; on simule 201 candidats rendus par la requête.
    chargerCandidatsMock.mockResolvedValue(
      Array.from({ length: 201 }, (_v, i) => candidat({ id: `p${String(i)}` })),
    );
    appliquerMock.mockResolvedValue(true);
    const acces = accesFactice();
    const service = new ServiceClotureAutomatiquePointage(acces, horlogeFactice());

    const resultat = await service.executerPourTenant(CTX_A);

    expect(resultat.examines).toBe(200);
    expect(resultat.encoreATraiter).toBe(true);
  });
});
