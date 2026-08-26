import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BoutonImprimerOr } from './BoutonImprimerOr';

/**
 * `BoutonImprimerOr` n'est plus qu'un appelant de `BoutonImprimerDocument`
 * (`composants/motifs/`, chantier d'unification inter-écrans, 25.08.2026) — le raisonnement
 * complet (issue #155, pourquoi un `<a href target="_blank">` plutôt qu'un fetch+blob) est
 * couvert par `BoutonImprimerDocument.spec.tsx`, pas répété ici. Ce fichier prouve UNIQUEMENT la
 * partie propre à l'OR : `orId` produit bien la bonne URL (`GET /ordres-reparation/{orId}/pdf`)
 * et le bon libellé traduit — la composition, pas le mécanisme sous-jacent.
 */
describe('BoutonImprimerOr', () => {
  it('propose un lien nommé « Imprimer l’OR », qui pointe directement vers le PDF réel (GET /ordres-reparation/{orId}/pdf), ouvert dans un nouvel onglet', () => {
    render(<BoutonImprimerOr orId="or-1" />);

    const lien = screen.getByRole('link', { name: "Imprimer l'OR" });
    expect(lien).toHaveAttribute('href', '/api/v1/ordres-reparation/or-1/pdf');
    expect(lien).toHaveAttribute('target', '_blank');
    // `noopener` : l'onglet ouvert ne doit jamais pouvoir agir sur `window.opener` (l'écran de
    // l'OR) — même règle que le lien d'impression de facture.
    expect(lien).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it("n'appelle jamais fetch — c'est une navigation native, pas un aller-retour JS", () => {
    const fetchOriginal = globalThis.fetch;
    let appele = false;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      appele = true;
      return fetchOriginal(...args);
    };

    try {
      render(<BoutonImprimerOr orId="or-1" />);
      expect(appele).toBe(false);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});
