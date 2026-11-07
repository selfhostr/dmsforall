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
  it('crée la ligne sur l’OR (désignation, urgence, sécurité, estimation) puis marque le travail repris', async () => {
    const lignes: Record<string, unknown>[] = [];
    const patchs: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json([TRAVAIL])),
      http.post('/api/v1/ordres-reparation/or-1/lignes', async ({ request }) => {
        lignes.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ donnees: { id: 'l-1' }, avertissements: [] }, { status: 201 });
      }),
      http.patch('/api/v1/vehicules/v1/travaux-reportes/t1', async ({ request }) => {
        patchs.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...TRAVAIL, statut: 'repris' });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: /Reprendre dans cet OR/ }));

    await waitFor(() => expect(patchs).toHaveLength(1));
    expect(lignes[0]).toMatchObject({
      designation: 'Plaquettes de frein avant',
      urgence: 'urgent',
      securite: true,
      prixUnitaireCentimes: 24000,
    });
    expect(patchs[0]).toEqual({ statut: 'repris' });
  });

  it('un échec de création de ligne ne marque PAS le travail repris, et le dit', async () => {
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
