import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneConsigneEchangeStandard } from '../db/schema';
import { ServiceConsigne } from './service-consigne';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneConsigne(champs: Partial<LigneConsigneEchangeStandard> = {}): LigneConsigneEchangeStandard {
  return {
    id: 'c1',
    tenantId: 'tid-1',
    ligneOrId: 'lo1',
    ordreReparationId: 'or1',
    articleId: 'art-alternateur',
    siteId: 'site-1',
    statut: 'en_attente_retour_fournisseur',
    montantConsigneTtcCentimes: 16215,
    documentVenteLigneConsigneId: 'ldoc-1',
    mouvementEntreeId: 'mvt-entree-1',
    retourneeFournisseurLe: null,
    mouvementRetourId: null,
    avoirDocumentId: null,
    creeLe: new Date('2026-07-01T08:00:00.000Z'),
    ...champs,
  } as LigneConsigneEchangeStandard;
}

function txFactice(executes: ReadonlyArray<{ rows: readonly unknown[] }>) {
  const file = [...executes];
  const insertValuesArgs: unknown[] = [];
  const tx = {
    execute: vi.fn(() => Promise.resolve(file.shift() ?? { rows: [] })),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return { returning: () => Promise.resolve([{ id: 'mvt-retour-1', ...vals }]) };
      },
    }),
  };
  return { tx: tx as unknown as TransactionDfa, insertValuesArgs };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return { enTenant: vi.fn((_ctx, travail) => travail(tx)), verifierConnexion: vi.fn(), verifierPostureRls: vi.fn() };
}

describe('ServiceConsigne.marquerRetourFournisseur — RP-39/RP-40 : le client ramène la vieille pièce', () => {
  it('refuse (409 CONSIGNE_TRANSITION_INTERDITE) une consigne déjà retournée, sans générer de second mouvement', async () => {
    const { tx, insertValuesArgs } = txFactice([
      { rows: [{ ...ligneConsigne({ statut: 'retournee_fournisseur' }), quantiteLigneOrMillieme: 1000 }] },
    ]);
    const service = new ServiceConsigne(accesFactice(tx));

    await expect(service.marquerRetourFournisseur(CTX, 'c1')).rejects.toMatchObject({
      code: 'CONSIGNE_TRANSITION_INTERDITE',
      status: 409,
    });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('404 RESSOURCE_INTROUVABLE quand la consigne n’existe pas pour ce tenant', async () => {
    const { tx } = txFactice([{ rows: [] }]);
    const service = new ServiceConsigne(accesFactice(tx));

    await expect(service.marquerRetourFournisseur(CTX, 'inconnue')).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
  });

  it('en_attente_retour_fournisseur : insère un mouvement retour_consigne de quantité NÉGATIVE (celle de la ligne d’OR d’origine), marque la consigne terminale', async () => {
    const { tx, insertValuesArgs } = txFactice([
      { rows: [{ ...ligneConsigne(), quantiteLigneOrMillieme: 1000 }] }, // FOR UPDATE jointe à ligne_or
      { rows: [] }, // UPDATE consigne
      { rows: [ligneConsigne({ statut: 'retournee_fournisseur', retourneeFournisseurLe: new Date(), mouvementRetourId: 'mvt-retour-1' })] }, // reload
    ]);
    const service = new ServiceConsigne(accesFactice(tx));

    const resultat = await service.marquerRetourFournisseur(CTX, 'c1');

    expect(resultat.statut).toBe('retournee_fournisseur');
    expect(resultat.mouvementRetourId).toBe('mvt-retour-1');
    expect(insertValuesArgs[0]).toMatchObject({ type: 'retour_consigne', quantiteMillieme: -1000, articleId: 'art-alternateur', siteId: 'site-1' });
  });
});
