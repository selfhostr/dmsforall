import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { BoutonCopier } from './BoutonCopier';

/**
 * Preuve du défaut 4 corrigé :
 *  1. le `setTimeout` de retour à l'icône par défaut est nettoyé au démontage (`vi.getTimerCount()`
 *     retombe à 0) — avant correction, le timer survivait au démontage.
 *  2. `navigator.clipboard.writeText()` peut rejeter (contexte non sécurisé, permission refusée) —
 *     plus de rejet de promesse non capturé, l'UI reste dans son état par défaut, pas de crash.
 */
describe('BoutonCopier', () => {
  const clipboardOriginal = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboardOriginal,
      configurable: true,
    });
    vi.useRealTimers();
  });

  it('confirme visuellement une copie réussie (icône « copié »)', async () => {
    const ecrireTexte = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: ecrireTexte },
      configurable: true,
    });

    render(<BoutonCopier valeur="ABC123" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copier' }));

    expect(ecrireTexte).toHaveBeenCalledWith('ABC123');
    await waitFor(() => expect(document.querySelector('.text-statut-succes')).toBeTruthy());
  });

  it('nettoie le timer de confirmation au démontage (le timer en attente retombe à 0)', async () => {
    vi.useFakeTimers();
    const ecrireTexte = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: ecrireTexte },
      configurable: true,
    });

    const { unmount } = render(<BoutonCopier valeur="ABC123" />);
    const bouton = screen.getByRole('button', { name: 'Copier' });

    await act(async () => {
      fireEvent.click(bouton);
      // Laisse la promesse résolue de `writeText` se propager avant de poser le timer.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Le timer de retour à l'icône par défaut (1500ms) est bien posé...
    expect(vi.getTimerCount()).toBe(1);

    // ...et nettoyé au démontage, avant son expiration — sans ça, il survivrait au démontage et
    // appellerait `setCopie` sur un composant qui n'existe plus.
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gère l'échec de la copie (permission refusée / contexte non sécurisé) sans exception ni rejet non capturé, sans confirmation trompeuse", async () => {
    const ecrireTexte = vi.fn().mockRejectedValue(new Error('permission refusée'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: ecrireTexte },
      configurable: true,
    });

    render(<BoutonCopier valeur="ABC123" />);
    const bouton = screen.getByRole('button', { name: 'Copier' });

    await act(async () => {
      fireEvent.click(bouton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ecrireTexte).toHaveBeenCalledWith('ABC123');
    // Pas de confirmation visuelle trompeuse après un échec, et le bouton reste utilisable.
    expect(document.querySelector('.text-statut-succes')).toBeFalsy();
    expect(bouton).toBeInTheDocument();
  });
});
