import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
} from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { afficherToastSuccesMutation } from '@/api/toast-succes-mutation';
import '@/i18n';

import { ToastsSucces } from './ToastsSucces';
import { DUREE_TOAST_SUCCES_MS, reinitialiserToastsSucces } from './toast-succes';

function Declencheur({ meta }: { readonly meta?: Record<string, unknown> }) {
  const mutation = useMutation({ mutationFn: () => Promise.resolve('ok'), meta });
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      go
    </button>
  );
}

function rendre(meta?: Record<string, unknown>) {
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (donnees, variables, _contexte, mutation) =>
        afficherToastSuccesMutation(donnees, variables, mutation),
    }),
  });
  return render(
    <QueryClientProvider client={client}>
      <Declencheur meta={meta} />
      <ToastsSucces />
    </QueryClientProvider>,
  );
}

describe('toast de succès déclaré par meta', () => {
  afterEach(() => {
    vi.useRealTimers();
    act(() => reinitialiserToastsSucces());
  });

  it('affiche le message traduit d’une mutation qui déclare meta.succes', async () => {
    rendre({ succes: 'commun:toasts.clientCree' });
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('Client créé')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });

  it('n’affiche rien sans meta (pas de bruit)', async () => {
    rendre();
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'go' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull();
  });

  it('propose « Annuler » quand meta.annuler existe, l’appelle et ferme le toast', async () => {
    const annuler = vi.fn().mockResolvedValue(undefined);
    rendre({ succes: 'commun:toasts.orTermine', annuler });
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('OR terminé')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    await waitFor(() => expect(annuler).toHaveBeenCalledWith('ok', undefined));
    await waitFor(() => expect(screen.queryByText('OR terminé')).toBeNull());
  });

  it('se ferme seul après 8 secondes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    rendre({ succes: 'commun:toasts.factureEmise' });
    await utilisateur.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('Facture émise')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(DUREE_TOAST_SUCCES_MS + 50);
    });

    await waitFor(() => expect(screen.queryByText('Facture émise')).toBeNull());
  });
});
