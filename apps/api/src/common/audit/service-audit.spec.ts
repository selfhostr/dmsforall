import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import { ServiceAuditImpl } from './service-audit';

const CTX: ContexteTenant = {
  tenantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  utilisateurId: null,
  requeteId: null,
};

function accesFactice(tx: { execute: ReturnType<typeof vi.fn> }): AccesBase {
  return {
    enTenant: async (_ctx, travail) => travail(tx as unknown as TransactionDfa),
    verifierConnexion: async () => undefined,
    verifierPostureRls: async () => undefined,
  };
}

describe('ServiceAuditImpl.pourEntite', () => {
  it('projette les colonnes snake_case brutes vers EntreeAudit (camelCase)', async () => {
    const creeLe = new Date('2026-07-28T09:00:00.000Z');
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'audit-1',
          entite: 'ordre_reparation',
          entite_id: 'or-1',
          action: 'transition',
          champ: null,
          valeur_avant: { statut: 'ouvert' },
          valeur_apres: { statut: 'en_cours' },
          utilisateur_id: 'u-1',
          requete_id: 'req-1',
          cree_le: creeLe,
        },
      ],
    });
    const service = new ServiceAuditImpl(accesFactice({ execute }));

    const entrees = await service.pourEntite(CTX, 'ordre_reparation', 'or-1');

    expect(entrees).toEqual([
      {
        id: 'audit-1',
        entite: 'ordre_reparation',
        entiteId: 'or-1',
        action: 'transition',
        champ: null,
        valeurAvant: { statut: 'ouvert' },
        valeurApres: { statut: 'en_cours' },
        utilisateurId: 'u-1',
        requeteId: 'req-1',
        creeLe,
      },
    ]);
  });

  it('rend un tableau vide quand aucune ligne ne correspond, sans lever', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const service = new ServiceAuditImpl(accesFactice({ execute }));

    await expect(service.pourEntite(CTX, 'ligne_or', 'inconnue')).resolves.toEqual([]);
  });

  it('interroge la base via enTenant (contexte tenant posé), pas un accès direct', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const acces = accesFactice({ execute });
    const enTenantEspion = vi.spyOn(acces, 'enTenant');
    const service = new ServiceAuditImpl(acces);

    await service.pourEntite(CTX, 'ordre_reparation', 'or-1');

    expect(enTenantEspion).toHaveBeenCalledWith(CTX, expect.any(Function));
  });
});

/**
 * Correctif N+1 / non-atomicité (`atelier/service-or.ts` `journal()`) : `pourEntite` ouvre SA
 * PROPRE transaction à CHAQUE appel — bouclé sur N entités (jusqu'à ~19 pour un OR), ça fait N
 * connexions supplémentaires prises sur le pool partagé, ET une lecture qui n'est plus atomique
 * avec la transaction applicative appelante. `pourEntiteTx`/`pourEntitesTx` lisent DANS le `tx`
 * fourni par l'appelant, sans jamais rouvrir `AccesBase.enTenant`.
 */
describe('ServiceAuditImpl.pourEntiteTx / pourEntitesTx', () => {
  /** Fausse transaction directe (jamais `AccesBase.enTenant`) — ces méthodes ne doivent JAMAIS
   *  ouvrir de transaction elles-mêmes : le test échouerait si elles le faisaient, faute de
   *  `enTenant` disponible sur cet objet. */
  function txFactice(execute: ReturnType<typeof vi.fn>): TransactionDfa {
    return { execute } as unknown as TransactionDfa;
  }

  it('pourEntiteTx lit DANS le tx fourni — un seul tx.execute, aucune transaction imbriquée', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const tx = txFactice(execute);
    const service = new ServiceAuditImpl({} as never);

    await service.pourEntiteTx(tx, CTX, 'ordre_reparation', 'or-1');

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('pourEntitesTx charge PLUSIEURS entités en UN SEUL aller-retour SQL — pas une requête par entité (le défaut corrigé)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const tx = txFactice(execute);
    const service = new ServiceAuditImpl({} as never);

    await service.pourEntitesTx(tx, CTX, [
      { entite: 'ordre_reparation', entiteId: 'or-1' },
      { entite: 'ligne_or', entiteId: 'ligne-1' },
      { entite: 'ligne_or', entiteId: 'ligne-2' },
      { entite: 'devis_complementaire', entiteId: 'devis-1' },
    ]);

    // Le point précis de la régression : quel que soit le nombre d'entités demandées, UN SEUL
    // aller-retour. Un test qui se contenterait de vérifier le CONTENU du résultat resterait vert
    // si on réintroduisait une boucle de N `tx.execute` — celui-ci rougirait immédiatement.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('pourEntitesTx rescope explicitement sur tenant_id et apparie (entite, entite_id) via unnest — jamais une requête par entité', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const tx = txFactice(execute);
    const service = new ServiceAuditImpl({} as never);

    await service.pourEntitesTx(tx, CTX, [
      { entite: 'ordre_reparation', entiteId: 'or-1' },
      { entite: 'ligne_or', entiteId: 'ligne-1' },
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    const firstCall = execute.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requete = firstCall![0] as { queryChunks: unknown[] };
    const texte = JSON.stringify(requete);
    expect(texte).toContain('tenant_id');
    expect(texte).toContain('unnest');
    expect(texte).toContain(CTX.tenantId);
  });

  it('pourEntitesTx rend un tableau vide sans interroger la base quand la liste est vide', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const tx = txFactice(execute);
    const service = new ServiceAuditImpl({} as never);

    await expect(service.pourEntitesTx(tx, CTX, [])).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('pourEntite (variante publique, hors transaction appelante) délègue à pourEntiteTx sous enTenant — compatibilité ascendante des appelants existants', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const acces = accesFactice({ execute });
    const service = new ServiceAuditImpl(acces);
    const pourEntiteTxEspion = vi.spyOn(service, 'pourEntiteTx');

    await service.pourEntite(CTX, 'ordre_reparation', 'or-1');

    expect(pourEntiteTxEspion).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      'ordre_reparation',
      'or-1',
    );
  });
});
