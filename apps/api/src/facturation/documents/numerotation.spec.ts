import { describe, expect, it, vi } from 'vitest';
import type { TransactionDfa } from '../../db';

import { genererNumeroDocument } from './numerotation';

/**
 * Bug #104 (CRITIQUE, production de démo) : une facture, un avoir et un bon de commande émis pour
 * le premier document de leur série respective produisaient tous la chaîne AFFICHÉE `2026-00001`
 * — la contrainte d'unicité base (`document_vente_numero_uk`, scopée par `type_document`) n'était
 * jamais violée, mais le numéro imprimé/affiché était indiscernable d'un doublon. Ces tests
 * prouvent que `genererNumeroDocument` compose désormais un préfixe visible par type, avec des
 * valeurs EXACTES (jamais `toBeCloseTo`, sans objet ici puisque ce sont des chaînes/entiers).
 */
describe('genererNumeroDocument', () => {
  const ctx = { tenantId: 'tenant-a' } as never;
  const tx = {} as TransactionDfa;

  function compteursRendant(numeroSequence: number): {
    prochainNumero: ReturnType<typeof vi.fn>;
  } {
    return { prochainNumero: vi.fn(async () => numeroSequence) };
  }

  it('compose facture : préfixe FAC, exercice, séquence sur 5 chiffres', async () => {
    const compteurs = compteursRendant(318);
    const resultat = await genererNumeroDocument(
      tx,
      ctx,
      compteurs,
      'facture',
      new Date('2026-03-15T00:00:00.000Z'),
    );
    expect(resultat).toEqual({ numero: 'FAC-2026-00318', numeroSequence: 318, exercice: 2026 });
  });

  it('compose avoir : préfixe AVO, distinct de facture au même rang', async () => {
    const compteurs = compteursRendant(1);
    const resultat = await genererNumeroDocument(
      tx,
      ctx,
      compteurs,
      'avoir',
      new Date('2026-01-05T00:00:00.000Z'),
    );
    expect(resultat.numero).toBe('AVO-2026-00001');
  });

  it('compose bon_commande : préfixe BDC', async () => {
    const compteurs = compteursRendant(412);
    const resultat = await genererNumeroDocument(
      tx,
      ctx,
      compteurs,
      'bon_commande',
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect(resultat.numero).toBe('BDC-2026-00412');
  });

  it('compose devis : préfixe DEV', async () => {
    const compteurs = compteursRendant(7);
    const resultat = await genererNumeroDocument(
      tx,
      ctx,
      compteurs,
      'devis',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(resultat.numero).toBe('DEV-2026-00007');
  });

  it('QUATRE TYPES au même rang de séquence (1) le même exercice produisent quatre chaînes numero VISIBLEMENT DIFFÉRENTES — le cœur du bug #104', async () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const devis = await genererNumeroDocument(tx, ctx, compteursRendant(1), 'devis', date);
    const bonCommande = await genererNumeroDocument(
      tx,
      ctx,
      compteursRendant(1),
      'bon_commande',
      date,
    );
    const facture = await genererNumeroDocument(tx, ctx, compteursRendant(1), 'facture', date);
    const avoir = await genererNumeroDocument(tx, ctx, compteursRendant(1), 'avoir', date);

    const numeros = [devis.numero, bonCommande.numero, facture.numero, avoir.numero];
    expect(numeros).toEqual([
      'DEV-2026-00001',
      'BDC-2026-00001',
      'FAC-2026-00001',
      'AVO-2026-00001',
    ]);
    expect(new Set(numeros).size).toBe(4);
  });

  it('la clé de compteur passée à `prochainNumero` reste scopée par type et exercice, portée tenant (siteId null)', async () => {
    const compteurs = compteursRendant(1);
    await genererNumeroDocument(
      tx,
      ctx,
      compteurs,
      'facture',
      new Date('2026-09-01T00:00:00.000Z'),
    );
    expect(compteurs.prochainNumero).toHaveBeenCalledWith(tx, {
      tenantId: 'tenant-a',
      typeDocument: 'document_vente:facture',
      annee: 2026,
      siteId: null,
    });
  });

  it('exercice dérivé de `dateDocument` en UTC (pas de la date système)', async () => {
    const compteurs = compteursRendant(1);
    const resultat = await genererNumeroDocument(
      tx,
      ctx,
      compteurs,
      'facture',
      new Date('2027-12-31T23:59:59.000Z'),
    );
    expect(resultat.exercice).toBe(2027);
    expect(resultat.numero).toBe('FAC-2027-00001');
  });

  it('séquence à 5 chiffres et au-delà (99999 -> 100000) : padding uniquement en dessous, jamais de troncature', async () => {
    const compteurs = compteursRendant(100000);
    const resultat = await genererNumeroDocument(
      tx,
      ctx,
      compteurs,
      'facture',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(resultat.numero).toBe('FAC-2026-100000');
  });
});
