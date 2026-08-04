import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import { ErreurMetier } from '../erreurs/erreur-metier';
import type { Horloge } from '../horloge/horloge';
import { ServiceIdempotenceImpl } from './service-idempotence';

const CTX: ContexteTenant = {
  tenantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  utilisateurId: null,
  requeteId: null,
};
const CLE = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

function horlogeFigee(): Horloge {
  return { maintenant: () => new Date('2026-07-28T10:00:00.000Z') } as Horloge;
}

/** Fausse `AccesBase` qui exécute directement `travail` avec un `tx` factice — pas de Postgres. */
function accesFactice(tx: { execute: ReturnType<typeof vi.fn> }): AccesBase {
  return {
    enTenant: async (_ctx, travail) => travail(tx as unknown as TransactionDfa),
    verifierConnexion: async () => undefined,
    verifierPostureRls: async () => undefined,
  };
}

function creerService(tx: { execute: ReturnType<typeof vi.fn> }): ServiceIdempotenceImpl {
  const service = new ServiceIdempotenceImpl(accesFactice(tx), horlogeFigee());
  return service;
}

describe('ServiceIdempotenceImpl.executer', () => {
  it('rejette une clé mal formée AVANT toute requête base', async () => {
    const execute = vi.fn();
    const service = creerService({ execute });

    await expect(
      service.executer(
        CTX,
        { methode: 'POST', chemin: '/clients', cle: 'pas-un-uuid', corps: {} },
        async () => ({
          statutHttp: 201,
          corps: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('clé neuve : insère, exécute le travail, mémorise, rejoue: false', async () => {
    const execute = vi
      .fn()
      // insert ... on conflict do nothing returning cle -> une ligne : on a gagné la course
      .mockResolvedValueOnce({ rows: [{ cle: CLE }] })
      // update de mémorisation
      .mockResolvedValueOnce({ rows: [] });
    const service = creerService({ execute });

    const travail = vi.fn(async () => ({ statutHttp: 201, corps: { id: 'C-2026-001' } }));

    const resultat = await service.executer(
      CTX,
      { methode: 'POST', chemin: '/clients', cle: CLE, corps: { nom: 'Dupont' } },
      travail,
    );

    expect(resultat).toEqual({
      reponse: { statutHttp: 201, corps: { id: 'C-2026-001' } },
      rejoue: false,
    });
    expect(travail).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('clé connue, même empreinte, exécution terminée : rejoue SANS ré-exécuter le travail', async () => {
    const { calculerEmpreinte } = await import('./empreinte');
    const corps = { nom: 'Dupont' };
    const empreinte = calculerEmpreinte(corps);

    const execute = vi
      .fn()
      // insert ... on conflict do nothing -> aucune ligne : conflit
      .mockResolvedValueOnce({ rows: [] })
      // select de relecture
      .mockResolvedValueOnce({
        rows: [
          {
            empreinte_requete: empreinte,
            statut: 'termine',
            statut_http: 201,
            reponse: { id: 'C-2026-001' },
          },
        ],
      });
    const service = creerService({ execute });

    const travail = vi.fn(async () => ({ statutHttp: 201, corps: { id: 'AUTRE' } }));

    const resultat = await service.executer(
      CTX,
      { methode: 'POST', chemin: '/clients', cle: CLE, corps },
      travail,
    );

    expect(resultat).toEqual({
      reponse: { statutHttp: 201, corps: { id: 'C-2026-001' } },
      rejoue: true,
    });
    expect(travail).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('clé connue, empreinte différente : IDEMPOTENCE_CONFLIT, travail jamais exécuté', async () => {
    const { calculerEmpreinte } = await import('./empreinte');
    const empreinteAutreCorps = calculerEmpreinte({ nom: 'Un autre client' });

    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            empreinte_requete: empreinteAutreCorps,
            statut: 'termine',
            statut_http: 201,
            reponse: {},
          },
        ],
      });
    const service = creerService({ execute });
    const travail = vi.fn(async () => ({ statutHttp: 201, corps: {} }));

    await expect(
      service.executer(
        CTX,
        { methode: 'POST', chemin: '/clients', cle: CLE, corps: { nom: 'Dupont' } },
        travail,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCE_CONFLIT' });
    expect(travail).not.toHaveBeenCalled();
  });

  it('clé connue, même empreinte, exécution encore en_cours : IDEMPOTENCE_CONFLIT avec Retry-After: 1', async () => {
    const { calculerEmpreinte } = await import('./empreinte');
    const corps = { nom: 'Dupont' };
    const empreinte = calculerEmpreinte(corps);

    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { empreinte_requete: empreinte, statut: 'en_cours', statut_http: null, reponse: null },
        ],
      });
    const service = creerService({ execute });
    const travail = vi.fn(async () => ({ statutHttp: 201, corps: {} }));

    let erreurCapturee: unknown;
    try {
      await service.executer(
        CTX,
        { methode: 'POST', chemin: '/clients', cle: CLE, corps },
        travail,
      );
    } catch (erreur) {
      erreurCapturee = erreur;
    }
    expect(erreurCapturee).toBeInstanceOf(ErreurMetier);
    const erreur = erreurCapturee as ErreurMetier;
    expect(erreur.code).toBe('IDEMPOTENCE_CONFLIT');
    expect(erreur.enTetes).toEqual({ 'Retry-After': '1' });
    expect(travail).not.toHaveBeenCalled();
  });

  it('anomalie (conflit puis ligne introuvable à la relecture) : ERREUR_INTERNE, jamais un succès silencieux', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const service = creerService({ execute });
    const travail = vi.fn(async () => ({ statutHttp: 201, corps: {} }));

    await expect(
      service.executer(CTX, { methode: 'POST', chemin: '/clients', cle: CLE, corps: {} }, travail),
    ).rejects.toMatchObject({ code: 'ERREUR_INTERNE' });
    expect(travail).not.toHaveBeenCalled();
  });

  it("si le travail échoue, aucune mise à jour de mémorisation n'est tentée", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ cle: CLE }] });
    const service = creerService({ execute });

    await expect(
      service.executer(
        CTX,
        { methode: 'POST', chemin: '/clients', cle: CLE, corps: {} },
        async () => {
          throw new Error('échec métier');
        },
      ),
    ).rejects.toThrow('échec métier');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
