import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { ErreurMetier } from '../common/erreurs';

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

describe('ServiceTableauBordFinancier.obtenir — filtrage par droit AVANT tout accès base (le piège principal de ce lot)', () => {
  it.each([
    'admin',
    'vendeur',
    'receptionnaire',
    'chef_atelier',
    'technicien',
    'magasinier',
    'poste_atelier',
  ] as const)(
    '%s : 403 DROIT_INSUFFISANT, AUCUN appel à enTenant/execute — aucun montant ne fuit',
    async (role) => {
      const { acces, enTenant, execute } = accesFactice(LIGNE_VIDE);
      const service = new ServiceTableauBordFinancier(acces);

      let capturee: unknown;
      try {
        await service.obtenir(CTX, role, {});
      } catch (erreur) {
        capturee = erreur;
      }

      expect(capturee).toBeInstanceOf(ErreurMetier);
      expect((capturee as ErreurMetier).code).toBe('DROIT_INSUFFISANT');
      expect((capturee as ErreurMetier).status).toBe(403);
      expect(enTenant).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each(['direction', 'comptable'] as const)(
    '%s : accepté, la base est bien interrogée',
    async (role) => {
      const { acces, execute } = accesFactice(LIGNE_VIDE);
      const service = new ServiceTableauBordFinancier(acces);

      await service.obtenir(CTX, role, {});

      expect(execute).toHaveBeenCalledTimes(1);
    },
  );
});

describe('ServiceTableauBordFinancier.obtenir — période vide : zéro partout, jamais une exception', () => {
  it('aucun document/paiement sur la période : tous les montants à 0', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, 'direction', {
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

    const resultat = await service.obtenir(CTX, 'comptable', {
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

    const resultat = await service.obtenir(CTX, 'direction', {});

    expect(resultat.chiffreAffaires.totalHtCentimes).toBe(-500);
    expect(resultat.chiffreAffaires.totalTtcCentimes).toBe(-540);
  });

  it('siteId transmis : renvoyé tel quel dans la réponse', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, 'direction', { siteId: 'site-42' });

    expect(resultat.siteId).toBe('site-42');
  });
});
