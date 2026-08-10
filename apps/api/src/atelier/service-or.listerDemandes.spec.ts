import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneOrdreReparation, LigneOrdreReparationDemande } from '../db/schema';

/**
 * Correctif N+1 sur `ServiceOr.listerDemandes()` (audit backend, `GET
 * /ordres-reparation/{orId}/demandes`) : la version précédente appelait
 * `chargerResumeUtilisateur(tx, ctx, l.saisiParId)` une fois PAR DEMANDE de la liste — un OR à N
 * demandes ouvrait N requêtes sur `utilisateur`, même quand plusieurs demandes ont été saisies par
 * la même personne. Ce fichier prouve que la version corrigée n'ouvre plus qu'UN SEUL aller-retour
 * (`chargerResumesUtilisateurs`, `./references`), dédoublonné, quel que soit le nombre de
 * demandes — même doctrine de preuve que `service-or.journal.spec.ts`.
 */
vi.mock('./or-requetes', () => ({
  chargerOr: vi.fn(),
  listerDemandesOr: vi.fn(),
}));
vi.mock('./references', () => ({
  chargerResumesUtilisateurs: vi.fn().mockResolvedValue(new Map()),
}));

import { ServiceOr } from './service-or';
import * as orRequetes from './or-requetes';
import * as references from './references';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';

function accesBaseFactice() {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail({} as TransactionDfa),
    ),
  };
}

function serviceFactice(acces: ReturnType<typeof accesBaseFactice>): ServiceOr {
  return new ServiceOr(
    acces as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function demandeFixture(
  id: string,
  ordre: number,
  saisiParId: string | null,
): LigneOrdreReparationDemande {
  return {
    id,
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    ordre,
    verbatim: `Demande ${ordre}`,
    saisiLe: new Date('2026-08-01T08:00:00.000Z'),
    saisiParId,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
  } as LigneOrdreReparationDemande;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceOr.listerDemandes — résumés utilisateur par lot (correctif N+1)', () => {
  it("4 demandes (2 auteurs distincts, doublons compris, 1 sans auteur) ne déclenchent qu'UN SEUL appel à chargerResumesUtilisateurs — jamais un par demande", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerDemandesOr).mockResolvedValue([
      demandeFixture('d-1', 1, 'user-a'),
      demandeFixture('d-2', 2, 'user-a'),
      demandeFixture('d-3', 3, 'user-b'),
      demandeFixture('d-4', 4, null),
    ]);
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(
      new Map([
        ['user-a', { utilisateurId: 'user-a', nomAffiche: 'Alice Un' }],
        ['user-b', { utilisateurId: 'user-b', nomAffiche: 'Bruno Deux' }],
      ]),
    );
    const service = serviceFactice(accesBaseFactice());

    const resultat = await service.listerDemandes(CTX, OR_ID);

    // Le cœur du correctif : un seul appel, quel que soit le nombre de demandes (4 ici, 2
    // auteurs distincts) — un test qui vérifierait seulement le CONTENU du résultat resterait
    // vert même si la boucle par demande était réintroduite sous la nouvelle API.
    expect(references.chargerResumesUtilisateurs).toHaveBeenCalledTimes(1);

    expect(resultat.find((d) => d.id === 'd-1')?.saisiPar).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(resultat.find((d) => d.id === 'd-2')?.saisiPar).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(resultat.find((d) => d.id === 'd-3')?.saisiPar).toEqual({
      utilisateurId: 'user-b',
      nomAffiche: 'Bruno Deux',
    });
  });

  it('saisiParId null ne tente jamais de résolution ; saisiParId renseigné mais ABSENT du lot (utilisateur supprimé) retombe sur saisiPar: null — jamais un nom vide, jamais la demande écartée', async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerDemandesOr).mockResolvedValue([
      demandeFixture('d-1', 1, null),
      demandeFixture('d-2', 2, 'user-introuvable'),
    ]);
    // Le lot ne contient NI null (jamais interrogé) NI 'user-introuvable' (supprimé/autre tenant).
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(new Map());
    const service = serviceFactice(accesBaseFactice());

    const resultat = await service.listerDemandes(CTX, OR_ID);

    expect(resultat).toHaveLength(2);
    expect(resultat.find((d) => d.id === 'd-1')?.saisiPar).toBeNull();
    expect(resultat.find((d) => d.id === 'd-2')?.saisiPar).toBeNull();
  });
});
