import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BoutonImprimerDocument } from './BoutonImprimerDocument';

/**
 * Même contrat de test que `ecrans/atelier/BoutonImprimerOr.spec.tsx` (référence dont ce composant
 * est extrait, chantier d'unification inter-écrans, 25.08.2026) — vérifie l'attribut `href`
 * réellement posé, pas seulement qu'un clic ne lève pas d'exception, et l'absence de tout appel
 * `fetch` (issue #155 : la version fetch+blob laissait l'onglet ouvert bloqué, voir l'en-tête du
 * composant).
 */
describe('BoutonImprimerDocument', () => {
  it('propose un lien nommé selon `libelle`, qui pointe directement vers `url`, ouvert dans un nouvel onglet', () => {
    render(
      <BoutonImprimerDocument
        url="/api/v1/documents-vente/facture-1/pdf"
        libelle="Imprimer / télécharger le PDF"
      />,
    );

    const lien = screen.getByRole('link', { name: 'Imprimer / télécharger le PDF' });
    expect(lien).toHaveAttribute('href', '/api/v1/documents-vente/facture-1/pdf');
    expect(lien).toHaveAttribute('target', '_blank');
    // `noopener` : l'onglet ouvert ne doit jamais pouvoir agir sur `window.opener`.
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
      render(
        <BoutonImprimerDocument url="/api/v1/ordres-reparation/or-1/pdf" libelle="Imprimer l'OR" />,
      );
      expect(appele).toBe(false);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  it('générique : le libellé affiché est exactement celui fourni par l’appelant, jamais un texte codé en dur', () => {
    render(
      <BoutonImprimerDocument
        url="/api/v1/pieces/commandes/cmd-1/pdf"
        libelle="Voir le bon de commande"
      />,
    );

    expect(screen.getByRole('link', { name: 'Voir le bon de commande' })).toBeInTheDocument();
  });
});
