import { describe, expect, it, vi } from 'vitest';
import { STATUTS_OR_TABLEAU_BORD } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';

import { ServiceTableauBordActivite } from './service-tableau-bord-activite';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

const LIGNE_VIDE = {
  planifie: 0,
  ouvert: 0,
  en_cours: 0,
  controle: 0,
  termine: 0,
  facture: 0,
  ouvertsPeriode: 0,
  restituesPeriode: 0,
  delaiMoyenRestitutionMinutes: null,
  lignesEnAttenteValidation: 0,
  articlesSousSeuilReapprovisionnement: 0,
};

function accesFactice(ligne: Record<string, unknown> | null) {
  const execute = vi.fn(() => Promise.resolve({ rows: ligne ? [ligne] : [] }));
  const tx = { execute } as unknown as TransactionDfa;
  const enTenant = vi.fn((_ctx: ContexteTenant, travail: (tx: TransactionDfa) => unknown) =>
    Promise.resolve(travail(tx)),
  );
  const acces = { enTenant, verifierConnexion: vi.fn(), verifierPostureRls: vi.fn() } as AccesBase;
  return { acces, execute, enTenant };
}

/**
 * L'autorisation par rôle (`tableau_bord.activite.lire`, `auth/matrice-droits.ts` — tous les rôles
 * de personne SAUF `poste_atelier`) N'EST PLUS testée ici : elle est portée EXCLUSIVEMENT par
 * `@ExigerDroit('tableau_bord.activite.lire')` + `GardeDroit` sur `TableauBordActiviteController`
 * (bascule depuis le palliatif `tableau-bord/droits-provisoires.ts`, retiré — voir le commentaire
 * de tête de `service-tableau-bord-activite.ts`). Cette garantie est couverte par :
 *  - `auth/matrice-droits.spec.ts` (le rôle→action est correct, `poste_atelier` exclu) ;
 *  - `common/droits/garde-droit.spec.ts` (le guard refuse bien AVANT le handler quand l'action
 *    manque, générique à toute action) ;
 *  - `common/droits/toutes-les-actions-couvertes.spec.ts` (`@ExigerDroit('tableau_bord.activite.
 *    lire')` est bien posé sur une route réellement montée).
 * Ce service n'a donc plus de rôle à recevoir : il interroge la base pour tout appelant, l'appel
 * lui-même étant conditionné par le guard en amont.
 */
describe('ServiceTableauBordActivite.obtenir — interroge toujours la base (l’autorisation est au guard, pas ici)', () => {
  it('appelle bien la base (aucun filtrage par rôle en service)', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordActivite(acces);

    await service.obtenir(CTX, {});

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceTableauBordActivite.obtenir — période vide : zéro partout, null pour le délai, jamais une exception', () => {
  it('aucune ligne en base : tous les compteurs à 0, delaiMoyenRestitutionMinutes à null', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordActivite(acces);

    const resultat = await service.obtenir(CTX, {
      du: '2026-01-01',
      au: '2026-01-01',
    });

    expect(resultat.ordresReparationOuvertsPeriode).toBe(0);
    expect(resultat.ordresReparationRestituesPeriode).toBe(0);
    expect(resultat.delaiMoyenRestitutionMinutes).toBeNull();
    expect(resultat.lignesEnAttenteValidation).toBe(0);
    expect(resultat.articlesSousSeuilReapprovisionnement).toBe(0);
    for (const entree of resultat.ordresReparationParStatut) {
      expect(entree.nombre).toBe(0);
    }
  });
});

describe('ServiceTableauBordActivite.obtenir — arithmétique exacte, mapping fidèle', () => {
  it('recopie exactement les valeurs SQL, sans arrondi ni perte, dans l’ordre STATUTS_OR_TABLEAU_BORD', async () => {
    const ligne = {
      planifie: 2,
      ouvert: 5,
      en_cours: 7,
      controle: 1,
      termine: 3,
      facture: 4,
      ouvertsPeriode: 12,
      restituesPeriode: 9,
      delaiMoyenRestitutionMinutes: 1380,
      lignesEnAttenteValidation: 6,
      articlesSousSeuilReapprovisionnement: 11,
    };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordActivite(acces);

    const resultat = await service.obtenir(CTX, {
      du: '2026-08-01',
      au: '2026-08-04',
      siteId: 'site-1',
    });

    expect(resultat.periode).toEqual({ du: '2026-08-01', au: '2026-08-04' });
    expect(resultat.siteId).toBe('site-1');
    expect(resultat.ordresReparationOuvertsPeriode).toBe(12);
    expect(resultat.ordresReparationRestituesPeriode).toBe(9);
    expect(resultat.delaiMoyenRestitutionMinutes).toBe(1380);
    expect(resultat.lignesEnAttenteValidation).toBe(6);
    expect(resultat.articlesSousSeuilReapprovisionnement).toBe(11);

    expect(resultat.ordresReparationParStatut.map((e) => e.statut)).toEqual([
      ...STATUTS_OR_TABLEAU_BORD,
    ]);
    expect(resultat.ordresReparationParStatut).toEqual([
      { statut: 'planifie', nombre: 2 },
      { statut: 'ouvert', nombre: 5 },
      { statut: 'en_cours', nombre: 7 },
      { statut: 'controle', nombre: 1 },
      { statut: 'termine', nombre: 3 },
      { statut: 'facture', nombre: 4 },
    ]);
  });

  it('siteId absent de la requête : renvoyé null (agrégation tenant entier)', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordActivite(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.siteId).toBeNull();
  });
});
