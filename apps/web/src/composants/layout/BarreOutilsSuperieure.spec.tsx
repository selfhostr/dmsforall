import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { creerQueryClientTest } from '@/test/utils';

import { BarreOutilsSuperieure } from './BarreOutilsSuperieure';

/**
 * Lot « cadre applicatif » (19.08.2026) — ce bandeau remplace `EnTete.tsx` pour tout poste QUI A
 * une barre latérale. Il ne porte plus que ce que `BarreLaterale.tsx` ne pouvait pas reprendre :
 * la recherche permanente, reste atteignable sans ouvrir le tiroir mobile, et le déclencheur du
 * tiroir lui-même. Tenant, site, identité et déconnexion ont migré dans `BarreLaterale.spec.tsx`.
 */
function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Sheet>
          <BarreOutilsSuperieure />
          <SheetContent side="left">
            <SheetTitle>Navigation</SheetTitle>
          </SheetContent>
        </Sheet>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BarreOutilsSuperieure', () => {
  it('affiche le déclencheur du tiroir mobile et le bouton de recherche, rien d’autre', () => {
    rendre();

    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rechercher/i })).toBeInTheDocument();
    // Ancien contenu de `EnTete.tsx`, désormais dans `BarreLaterale.tsx` — absent d’ici.
    expect(screen.queryByRole('button', { name: /se déconnecter/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/garage/i)).not.toBeInTheDocument();
  });

  it('le déclencheur du tiroir ouvre le `Sheet` englobant', async () => {
    rendre();

    const declencheur = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(declencheur).toHaveAttribute('aria-haspopup', 'dialog');
    expect(declencheur).toHaveAttribute('aria-expanded', 'false');
  });
});
