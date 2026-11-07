import { describe, expect, it } from 'vitest';

import { schemaCorrectionFacture } from './document';

/**
 * `POST /documents-vente/{id}/corriger` : le champ `mode` est RÉTROCOMPATIBLE (défaut
 * `remplacement` = comportement historique) et les deux modes ont des exigences opposées sur
 * `champsCorriges` (obligatoire / interdit).
 */
const ADRESSE = { rue: 'Rue du Marché 12', npa: '1000', localite: 'Lausanne', pays: 'CH' };

describe('schemaCorrectionFacture — mode', () => {
  it('rétrocompatible : un corps sans `mode` est lu en `remplacement`', () => {
    const lu = schemaCorrectionFacture.parse({
      motif: 'erreur_adresse',
      champsCorriges: { adresseFacturation: ADRESSE },
    });
    expect(lu.mode).toBe('remplacement');
    expect(lu.corrigerFicheClient).toBe(true);
  });

  it('`remplacement` sans champsCorriges est refusé (champsCorriges)', () => {
    const r = schemaCorrectionFacture.safeParse({ mode: 'remplacement', motif: 'erreur_adresse' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['champsCorriges']);
  });

  it('`remplacement` avec champsCorriges vide est toujours refusé', () => {
    const r = schemaCorrectionFacture.safeParse({
      motif: 'erreur_adresse',
      champsCorriges: {},
    });
    expect(r.success).toBe(false);
  });

  it('`brouillon` sans champsCorriges est accepté', () => {
    const lu = schemaCorrectionFacture.parse({ mode: 'brouillon', motif: 'erreur_montant' });
    expect(lu.mode).toBe('brouillon');
    expect(lu.champsCorriges).toBeUndefined();
  });

  it('`brouillon` avec champsCorriges est refusé (champsCorriges)', () => {
    const r = schemaCorrectionFacture.safeParse({
      mode: 'brouillon',
      motif: 'erreur_montant',
      champsCorriges: { adresseFacturation: ADRESSE },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['champsCorriges']);
  });

  it('un mode inconnu est refusé', () => {
    expect(
      schemaCorrectionFacture.safeParse({ mode: 'emission', motif: 'erreur_montant' }).success,
    ).toBe(false);
  });

  it("motif 'autre' sans texte libre reste refusé dans les deux modes", () => {
    expect(schemaCorrectionFacture.safeParse({ mode: 'brouillon', motif: 'autre' }).success).toBe(
      false,
    );
  });
});
