import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';

import { ServiceTableauBordFinancier } from './service-tableau-bord-financier';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

const LIGNE_VIDE = {
  totalHtCentimes: '0',
  totalTvaCentimes: '0',
  totalTtcCentimes: '0',
  nombreDocuments: 0,
  encaissementsCentimes: '0',
  encoursClientsCentimes: '0',
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
 * L'autorisation par rôle (`tableau_bord.financier.lire`, `auth/matrice-droits.ts` — `direction`/
 * `comptable` SEULS, `admin` explicitement exclu, RF-115) N'EST PLUS testée ici : elle est portée
 * EXCLUSIVEMENT par `@ExigerDroit('tableau_bord.financier.lire')` + `GardeDroit` sur
 * `TableauBordFinancierController` (bascule depuis le palliatif `tableau-bord/droits-provisoires.ts`,
 * retiré — voir le commentaire de tête de `service-tableau-bord-financier.ts`). Le guard refuse
 * `403 DROIT_INSUFFISANT` en `canActivate()`, AVANT que ce handler (donc `service.obtenir()`, donc
 * la moindre requête d'agrégation financière) ne s'exécute — structurellement, pas par un test de ce
 * service. Cette garantie est couverte par :
 *  - `auth/matrice-droits.spec.ts` (le rôle→action est correct : direction/comptable seuls, admin
 *    explicitement exclu par un test dédié RF-115) ;
 *  - `common/droits/garde-droit.spec.ts` (le guard refuse bien AVANT le handler quand l'action
 *    manque, générique à toute action) ;
 *  - `common/droits/toutes-les-actions-couvertes.spec.ts` (`@ExigerDroit('tableau_bord.financier.
 *    lire')` est bien posé sur une route réellement montée).
 * Ce service n'a donc plus de rôle à recevoir : il interroge la base pour tout appelant, l'appel
 * lui-même étant conditionné par le guard en amont.
 */
describe('ServiceTableauBordFinancier.obtenir — interroge toujours la base (l’autorisation est au guard, pas ici)', () => {
  it('appelle bien la base (aucun filtrage par rôle en service)', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, {});

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceTableauBordFinancier.obtenir — période vide : zéro partout, jamais une exception', () => {
  it('aucun document/paiement sur la période : tous les montants à 0', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {
      du: '2026-01-01',
      au: '2026-01-01',
    });

    expect(resultat.chiffreAffaires).toEqual({
      totalHtCentimes: 0,
      totalTvaCentimes: 0,
      totalTtcCentimes: 0,
      nombreDocuments: 0,
    });
    expect(resultat.encaissementsCentimes).toBe(0);
    expect(resultat.encoursClientsCentimes).toBe(0);
  });
});

describe('ServiceTableauBordFinancier.obtenir — arithmétique exacte (bigint texte → number, jamais un flottant)', () => {
  it('convertit les sommes SQL (texte, précision arbitraire côté pilote pg) en number EXACT, sans arrondi', async () => {
    const ligne = {
      // Valeurs volontairement non rondes et non ambiguës en flottant IEEE754, pour prouver
      // l'absence d'arrondi (12345678.90 CHF en centimes → un entier qui n'a AUCUNE représentation
      // flottante approximative à surveiller ici, contrairement à un calcul en francs).
      totalHtCentimes: '1234567890',
      totalTvaCentimes: '99999999',
      totalTtcCentimes: '1334567889',
      nombreDocuments: 42,
      encaissementsCentimes: '1000000000',
      encoursClientsCentimes: '334567889',
    };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {
      du: '2026-08-01',
      au: '2026-08-04',
    });

    expect(resultat.chiffreAffaires).toEqual({
      totalHtCentimes: 1_234_567_890,
      totalTvaCentimes: 99_999_999,
      totalTtcCentimes: 1_334_567_889,
      nombreDocuments: 42,
    });
    expect(resultat.encaissementsCentimes).toBe(1_000_000_000);
    expect(resultat.encoursClientsCentimes).toBe(334_567_889);
    // HT + TVA = TTC, exactement (pas de `toBeCloseTo` sur de l'argent, CONTRIBUTING.md).
    expect(
      resultat.chiffreAffaires.totalHtCentimes + resultat.chiffreAffaires.totalTvaCentimes,
    ).toBe(resultat.chiffreAffaires.totalTtcCentimes);
  });

  it('net des avoirs (déjà négatifs en base) : une somme négative traverse exactement, sans être redressée à 0', async () => {
    const ligne = {
      ...LIGNE_VIDE,
      // Un mois où les avoirs émis dépassent les factures émises : net négatif, cas réel et
      // légitime (RF-11→18) — ne doit JAMAIS être silencieusement plafonné à 0.
      totalHtCentimes: '-500',
      totalTvaCentimes: '-40',
      totalTtcCentimes: '-540',
      nombreDocuments: 3,
    };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.chiffreAffaires.totalHtCentimes).toBe(-500);
    expect(resultat.chiffreAffaires.totalTtcCentimes).toBe(-540);
  });

  it('siteId transmis : renvoyé tel quel dans la réponse', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, { siteId: 'site-42' });

    expect(resultat.siteId).toBe('site-42');
  });
});
