import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BoutonImprimerOr } from './BoutonImprimerOr';

/**
 * Issue #155 (rapport terrain, reproduit en navigateur réel) : deux tentatives fetch+blob
 * (URL d'objet, puis URL de données) laissaient l'onglet ouvert bloqué — la première parce
 * qu'une URL d'objet n'est résoluble que dans le contexte de navigation qui l'a créée (Safari), la
 * seconde parce que Chrome/Firefox refusent toute navigation de premier niveau vers une URL
 * `data:` (depuis Chrome 60). Repris sur le motif éprouvé de `EcranFicheFacture.tsx` : un lien
 * `<a>` SIMPLE vers l'URL réelle du PDF, target="_blank" — le navigateur gère l'ouverture et
 * l'authentification (cookie de session) lui-même, sans code JS entre les deux. Ce test vérifie
 * l'attribut `href` réellement posé, pas seulement qu'un clic ne lève pas d'exception.
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
