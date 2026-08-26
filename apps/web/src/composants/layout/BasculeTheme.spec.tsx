import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { BasculeTheme } from './BasculeTheme';

/**
 * Refonte visuelle, mode sombre — voir DESIGN.md. Ce test exerce le VRAI `<ThemeProvider>` de
 * `next-themes` (pas un mock) : c'est le point du lot « Vérifie qu'il fonctionne bien hors
 * Next.js » — la preuve en exécution que ce composant pose réellement `class="dark"`/`"light"`
 * sur `<html>` et que `useTheme()` s'y synchronise, dans une app React + Vite pure (jsdom ici,
 * navigateur réel vérifié séparément lors de ce lot).
 */
function installerMatchMedia(systemeSombre: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? systemeSombre : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia,
  );
}

function rendre() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="dfa-theme">
      <BasculeTheme />
    </ThemeProvider>,
  );
}

describe('BasculeTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark', 'light');
    installerMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark', 'light');
  });

  it('démarre en clair quand le système est en clair (defaultTheme="system")', async () => {
    rendre();
    const bouton = await screen.findByRole('button', {
      name: 'Passer en thème sombre',
    });
    expect(bouton).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('démarre en sombre quand le système est en sombre (defaultTheme="system")', async () => {
    installerMatchMedia(true);
    rendre();
    expect(
      await screen.findByRole('button', { name: 'Passer en thème clair' }),
    ).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('un clic bascule le thème ET pose/retire la classe .dark sur <html>', async () => {
    const utilisateur = userEvent.setup();
    rendre();

    const bouton = await screen.findByRole('button', { name: 'Passer en thème sombre' });
    await utilisateur.click(bouton);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(
      await screen.findByRole('button', { name: 'Passer en thème clair' }),
    ).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Passer en thème clair' }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(
      await screen.findByRole('button', { name: 'Passer en thème sombre' }),
    ).toBeInTheDocument();
  });

  it('persiste le choix dans localStorage sous la clé dfa-theme, synchronisée avec index.html', async () => {
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Passer en thème sombre' }));

    expect(window.localStorage.getItem('dfa-theme')).toBe('dark');
  });
});
