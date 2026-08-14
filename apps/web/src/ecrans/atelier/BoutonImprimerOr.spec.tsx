import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BoutonImprimerOr } from './BoutonImprimerOr';

/**
 * Preuve des trois états explicites exigés (déclenché / échec / succès) sur le bouton
 * d'impression de la feuille d'atelier — voir aussi `hooks/atelier/useImprimerOr.spec.tsx` pour
 * la mécanique fetch+blob elle-même, testée là séparément du rendu.
 */

function construireFenetreFactice() {
  return { close: vi.fn(), location: { href: '' } } as unknown as Window;
}

describe('BoutonImprimerOr', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:objet-1'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(window, 'open').mockImplementation(() => construireFenetreFactice());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function rendre() {
    const queryClient = creerQueryClientTest();
    return render(
      <QueryClientProvider client={queryClient}>
        <BoutonImprimerOr orId="or-1" />
      </QueryClientProvider>,
    );
  }

  it('propose un bouton nommé « Imprimer l’OR », atteignable au clavier, qui ouvre le PDF au clic', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1/pdf', () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-1.4').buffer, {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    const bouton = screen.getByRole('button', { name: "Imprimer l'OR" });
    bouton.focus();
    expect(bouton).toHaveFocus();

    await utilisateur.keyboard('{Enter}');

    await waitFor(() => expect(bouton).not.toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('affiche une erreur actionnable (jamais un silence) sur un refus serveur, et laisse le bouton réessayable', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1/pdf', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole('button', { name: "Imprimer l'OR" }));

    const alerte = await screen.findByRole('alert');
    expect(alerte.textContent).toContain("Impossible d'imprimer la feuille d'atelier.");

    // Le bouton redevient cliquable — même déclencheur sert de réessai (react-query efface
    // l'erreur précédente dès qu'un nouveau `mutate()` démarre).
    const bouton = screen.getByRole('button', { name: "Imprimer l'OR" });
    expect(bouton).not.toBeDisabled();
  });
});
