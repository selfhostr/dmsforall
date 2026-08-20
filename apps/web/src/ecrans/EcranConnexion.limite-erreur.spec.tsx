import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { creerQueryClientTest } from '@/test/utils';

import { EcranConnexion } from './EcranConnexion';

// Fichier séparé du reste de `EcranConnexion.spec.tsx` : `vi.mock` s'applique à tout le fichier
// (et Vitest le hisse de toute façon au-dessus des imports). `Label` est rendu DANS la carte,
// sous `LimiteErreurEcran` (contrairement à `SelecteurLangue`, rendu au-dessus, hors de la
// limite) — le faire planter prouve précisément que la limite posée AUTOUR de la carte rattrape
// un crash DANS la carte.
vi.mock('@/components/ui/label', () => ({
  Label: () => {
    throw new Error('crash simulé dans un composant enfant de la carte de connexion');
  },
}));

vi.mock('@/observabilite/sentry', () => ({ signalerErreur: vi.fn() }));

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<EcranConnexion />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranConnexion — crash de rendu', () => {
  beforeEach(() => {
    // React journalise l'erreur captée sur `console.error` en plus de `componentDidCatch` — le
    // comportement est vérifié via le rendu, pas via les logs (mais `console.error` reste
    // explicitement autorisé par la config ESLint du dépôt, règle `no-console` : rien n'est
    // avalé, voir l'assertion `expect(console.error)` plus bas).
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('un crash de rendu dans la carte n’efface jamais l’écran (jamais de #root vide)', () => {
    rendre();

    // Preuve directe contre l'écran blanc : du texte reste affiché, l'utilisateur a un message
    // et un moyen de réessayer — jamais un `#root` vidé de tout contenu.
    expect(document.getElementById('root')?.textContent ?? document.body.textContent).not.toBe('');
    expect(screen.getByText("Une erreur s'est produite")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();

    // La trace reste visible pour qui développe (console), jamais affichée telle quelle au
    // garagiste : aucun message technique (nom de l'erreur, stack) dans le texte rendu.
    expect(console.error).toHaveBeenCalled();
    expect(screen.queryByText(/crash simulé/)).not.toBeInTheDocument();
  });
});
