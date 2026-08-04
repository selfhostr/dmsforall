import { describe, expect, it, vi } from 'vitest';
import { STATUTS_OR_TABLEAU_BORD } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { ErreurMetier } from '../common/erreurs';

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

describe('ServiceTableauBordActivite.obtenir — filtrage par droit AVANT tout accès base', () => {
  it('poste_atelier (borne murale) : 403 DROIT_INSUFFISANT, AUCUN appel à enTenant/execute', async () => {
    const { acces, enTenant } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordActivite(acces);

    await expect(service.obtenir(CTX, 'poste_atelier', {})).rejects.toBeInstanceOf(ErreurMetier);
    expect(enTenant).not.toHaveBeenCalled();
  });

  it.each([
    'technicien',
    'magasinier',
    'vendeur',
    'receptionnaire',
    'chef_atelier',
    'comptable',
    'direction',
    'admin',
  ] as const)('%s : accepté, la base est bien interrogée', async (role) => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordActivite(acces);

    await service.obtenir(CTX, role, {});

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceTableauBordActivite.obtenir — période vide : zéro partout, null pour le délai, jamais une exception', () => {
  it('aucune ligne en base : tous les compteurs à 0, delaiMoyenRestitutionMinutes à null', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordActivite(acces);

    const resultat = await service.obtenir(CTX, 'direction', {
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

    const resultat = await service.obtenir(CTX, 'direction', {
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

    const resultat = await service.obtenir(CTX, 'direction', {});

    expect(resultat.siteId).toBeNull();
  });
});
