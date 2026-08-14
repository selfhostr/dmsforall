import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { LimiteErreurEcran } from './LimiteErreurEcran';

vi.mock('@/observabilite/sentry', () => ({ signalerErreur: vi.fn() }));

function ComposantQuiPlante(): never {
  throw new Error('crash simulé');
}

function ComposantOk() {
  return <div>ÉCRAN_OK</div>;
}

describe('LimiteErreurEcran', () => {
  beforeEach(() => {
    // React journalise l'erreur captée sur `console.error` en plus de `componentDidCatch` —
    // silencieux ici pour ne pas polluer la sortie de test, le comportement lui-même est vérifié
    // via le rendu, pas via les logs.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rendu normal : affiche les enfants tels quels', () => {
    render(
      <LimiteErreurEcran>
        <ComposantOk />
      </LimiteErreurEcran>,
    );

    expect(screen.getByText('ÉCRAN_OK')).toBeInTheDocument();
  });

  it('un crash de rendu affiche un état d’erreur SCOPÉ (pas la page blanche entière)', () => {
    render(
      <LimiteErreurEcran>
        <ComposantQuiPlante />
      </LimiteErreurEcran>,
    );

    expect(screen.getByText("Une erreur s'est produite")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('« Réessayer » réinitialise la limite locale (jamais un rechargement de page)', async () => {
    const rechargerSpy = vi.fn();
    const emplacementOriginal = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...emplacementOriginal, reload: rechargerSpy },
    });

    const utilisateur = userEvent.setup();
    render(
      <LimiteErreurEcran>
        <ComposantQuiPlante />
      </LimiteErreurEcran>,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(rechargerSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: emplacementOriginal });
  });
});
