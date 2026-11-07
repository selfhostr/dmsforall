import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FiltresDocumentsVente } from '@dfa/shared';

import '@/i18n';

import { creerQueryClientTest } from '@/test/utils';

import { EcranListeFactures } from './EcranListeFactures';

const { listerDocumentsVenteMock } = vi.hoisted(() => ({ listerDocumentsVenteMock: vi.fn() }));

vi.mock('@/hooks/facturation/documents-vente.api', () => ({
  listerDocumentsVente: listerDocumentsVenteMock,
}));

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <EcranListeFactures />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeFactures — onglet Devis', () => {
  beforeEach(() => {
    listerDocumentsVenteMock.mockReset();
    listerDocumentsVenteMock.mockResolvedValue({ donnees: [], curseurSuivant: null, limite: 50 });
  });

  it('liste les devis (typeDocument=devis) et montre un état vide actionnable', async () => {
    const utilisateur = userEvent.setup();
    rendre();
    await waitFor(() => expect(listerDocumentsVenteMock).toHaveBeenCalled());

    await utilisateur.click(await screen.findByRole('tab', { name: 'Devis' }));

    await waitFor(() => {
      const appel = listerDocumentsVenteMock.mock.calls.at(-1) as readonly [FiltresDocumentsVente];
      expect(appel[0].typeDocument).toEqual(['devis']);
      expect(appel[0].statutReglement).toBeUndefined();
    });
    expect(await screen.findByText('Aucun devis')).toBeInTheDocument();
  });
});
