import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { PanneauTravauxReportesOr } from './PanneauTravauxReportesOr';

const TRAVAIL = {
  id: 't1',
  designation: 'Plaquettes de frein avant',
  urgence: 'urgent',
  montantEstimeCentimes: 24000,
  kilometrageAlors: 85000,
  constateLe: '2026-01-15',
  securite: true,
  statut: 'ouvert',
  ordreReparationOrigineId: null,
  ligneOrOrigineId: null,
  ordreReparationRepriseId: null,
  motifModification: null,
  detail: null,
};

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <PanneauTravauxReportesOr orId="or-1" vehiculeId="v1" />
    </QueryClientProvider>,
  );
}

describe('PanneauTravauxReportesOr — « Reprendre dans cet OR »', () => {
  it('un seul appel : la ligne porte travailReporteId, plus de second PATCH', async () => {
    const lignes: Record<string, unknown>[] = [];
    let patchs = 0;
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL])),
      http.post('/api/v1/ordres-reparation/or-1/lignes', async ({ request }) => {
        lignes.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ donnees: { id: 'l-1' }, avertissements: [] }, { status: 201 });
      }),
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', () => {
        patchs += 1;
        return HttpResponse.json({ ...TRAVAIL, statut: 'repris' });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: /Reprendre dans cet OR/ }));

    await waitFor(() => expect(lignes).toHaveLength(1));
    expect(lignes[0]).toMatchObject({
      type: 'forfait',
      origine: 'commandee',
      travailReporteId: 't1',
    });
    expect(lignes[0]).not.toHaveProperty('designation');
    expect(patchs).toBe(0);
  });

  it('un échec de création de ligne est dit, sans second appel', async () => {
    let patch = 0;
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL])),
      http.post('/api/v1/ordres-reparation/or-1/lignes', () =>
        HttpResponse.json(
          { type: 'x', title: 'x', status: 500, code: 'ERREUR_INTERNE', instance: '' },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', () => {
        patch += 1;
        return HttpResponse.json(TRAVAIL);
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: /Reprendre dans cet OR/ }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(patch).toBe(0);
  });

  it('ne rend rien quand le véhicule n’a aucun travail reporté ouvert', async () => {
    server.use(http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([])));
    const { container } = rendre();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
