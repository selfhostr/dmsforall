import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ReponseTravailReporte } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BoutonReprendreDansOr } from './BoutonReprendreDansOr';

const TRAVAIL = {
  id: 't1',
  designation: 'Amortisseur arrière',
  urgence: 'a_faire',
  statut: 'ouvert',
  securite: false,
} as unknown as ReponseTravailReporte;

function contexte(ors: readonly { id: string; numero: string; statut: string }[]) {
  server.use(
    http.get('/api/v1/vehicules/v1/contexte-atelier', () =>
      HttpResponse.json({ ordresReparationOuverts: ors }),
    ),
  );
}

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <BoutonReprendreDansOr vehiculeId="v1" travail={TRAVAIL} />
    </QueryClientProvider>,
  );
}

describe('BoutonReprendreDansOr (fiche véhicule)', () => {
  it('un seul OR ouvert : un clic crée la ligne sur cet OR', async () => {
    const lignes: string[] = [];
    contexte([{ id: 'or-1', numero: 'OR-2026-001', statut: 'en_cours' }]);
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/lignes', () => {
        lignes.push('or-1');
        return HttpResponse.json({ donnees: { id: 'l-1' }, avertissements: [] }, { status: 201 });
      }),
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', () => HttpResponse.json(TRAVAIL)),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(
      await screen.findByRole('button', { name: 'Reprendre dans OR-2026-001' }),
    );
    await waitFor(() => expect(lignes).toEqual(['or-1']));
  });

  it('aucun OR ouvert (ou seulement terminé) : rien à proposer', async () => {
    contexte([{ id: 'or-2', numero: 'OR-2026-002', statut: 'termine' }]);
    const { container } = rendre();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
