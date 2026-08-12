import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import {
  construireMotifPrefixe,
  ServiceReferentielVehiculesCh,
} from './service-referentiel-vehicules-ch';

/** Style de mock aligné sur `pneus/service-depot-pneus.spec.ts` / `recherche/service-recherche.spec.ts`
 *  (seul patron de mock de `AccesBase`/`TransactionDfa` de ce dépôt). */
const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function txFactice(lignes: readonly unknown[]): TransactionDfa {
  return { execute: vi.fn(() => Promise.resolve({ rows: lignes })) } as unknown as TransactionDfa;
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail(tx),
    ),
  } as unknown as AccesBase;
}

describe('construireMotifPrefixe', () => {
  it('recherche absente -> null (pas de filtre, cas "les plus fréquents")', () => {
    expect(construireMotifPrefixe(undefined)).toBeNull();
  });

  it('recherche vide (déjà trim par le schéma zod) -> null, jamais un motif "%" qui matcherait tout', () => {
    expect(construireMotifPrefixe('')).toBeNull();
  });

  it('recherche non vide -> motif ancré au préfixe uniquement, jamais entouré de "%"', () => {
    expect(construireMotifPrefixe('vol')).toBe('vol%');
  });
});

describe('ServiceReferentielVehiculesCh.rechercherMarques', () => {
  it('mappe marque -> nom et convertit le bigint pg (chaîne) en number', async () => {
    const tx = txFactice([
      { marque: 'VOLKSWAGEN', nombreModeles: '187', aliasTrouve: null },
      { marque: 'VOLVO', nombreModeles: '42', aliasTrouve: null },
    ]);
    const service = new ServiceReferentielVehiculesCh(accesFactice(tx));

    const reponse = await service.rechercherMarques(CTX, { recherche: 'vol', limite: 20 });

    expect(reponse).toEqual({
      marques: [
        { nom: 'VOLKSWAGEN', nombreModeles: 187, aliasTrouve: null },
        { nom: 'VOLVO', nombreModeles: 42, aliasTrouve: null },
      ],
    });
  });

  /**
   * Migration 0051 (`type_approbation_ch_marque_alias`) : une marque trouvée par un alias plutôt
   * que par son nom canonique porte `aliasTrouve` renseigné — ce que rend la requête (CTE
   * `candidats_via_alias`) quand une ligne provient de cette branche plutôt que de
   * `candidats_directs`. Le service ne fait ici que relayer telle quelle la colonne SQL.
   */
  it("relaie aliasTrouve quand la ligne vient d'une résolution par alias (ex. VW trouvé via « Volkswagen »)", async () => {
    const tx = txFactice([{ marque: 'VW', nombreModeles: '959', aliasTrouve: 'Volkswagen' }]);
    const service = new ServiceReferentielVehiculesCh(accesFactice(tx));

    const reponse = await service.rechercherMarques(CTX, { recherche: 'volkswagen', limite: 20 });

    expect(reponse).toEqual({
      marques: [{ nom: 'VW', nombreModeles: 959, aliasTrouve: 'Volkswagen' }],
    });
  });

  /**
   * Le test décisif de ce dépôt (CONTRIBUTING.md « Pièges vérifiés ») : un filtre accepté par le
   * contrat mais jamais appliqué au SQL renverrait la liste complète pour une marque inexistante.
   * Ici, la preuve en exécution réelle (base vivante) est le test qui compte — celui-ci ne fait
   * que verrouiller la couche de mapping : quand la base ne rend AUCUNE ligne (ce que produirait
   * un filtre correctement appliqué sur un motif qui ne matche rien), le service rend bien une
   * liste vide, pas une valeur par défaut ni une erreur.
   */
  it('aucune ligne rendue par la base -> liste vide, jamais la liste complète par défaut', async () => {
    const tx = txFactice([]);
    const service = new ServiceReferentielVehiculesCh(accesFactice(tx));

    const reponse = await service.rechercherMarques(CTX, {
      recherche: 'marque-totalement-inexistante-zzz',
      limite: 20,
    });

    expect(reponse).toEqual({ marques: [] });
  });
});

describe('ServiceReferentielVehiculesCh.rechercherModeles', () => {
  it('codeTypeCh renseigné quand un seul code type correspond au modèle', async () => {
    const tx = txFactice([{ modele: 'GOLF', codeTypeCh: '1AA101' }]);
    const service = new ServiceReferentielVehiculesCh(accesFactice(tx));

    const reponse = await service.rechercherModeles(CTX, {
      marque: 'VOLKSWAGEN',
      recherche: 'gol',
      limite: 20,
    });

    expect(reponse).toEqual({ modeles: [{ nom: 'GOLF', codeTypeCh: '1AA101' }] });
  });

  it('codeTypeCh à null quand plusieurs codes types partagent le même nom de modèle', async () => {
    // Reproduit ce que rend la base (CASE ... END) quand count(distinct code_type_ch) > 1 :
    // la ligne SQL porte déjà `codeTypeCh: null`, le service ne fait que la relayer telle quelle.
    const tx = txFactice([{ modele: 'GOLF', codeTypeCh: null }]);
    const service = new ServiceReferentielVehiculesCh(accesFactice(tx));

    const reponse = await service.rechercherModeles(CTX, {
      marque: 'VOLKSWAGEN',
      recherche: 'gol',
      limite: 20,
    });

    expect(reponse).toEqual({ modeles: [{ nom: 'GOLF', codeTypeCh: null }] });
  });

  it('marque inexistante -> liste vide (même garde-fou que rechercherMarques)', async () => {
    const tx = txFactice([]);
    const service = new ServiceReferentielVehiculesCh(accesFactice(tx));

    const reponse = await service.rechercherModeles(CTX, {
      marque: 'marque-totalement-inexistante-zzz',
      limite: 20,
    });

    expect(reponse).toEqual({ modeles: [] });
  });
});
