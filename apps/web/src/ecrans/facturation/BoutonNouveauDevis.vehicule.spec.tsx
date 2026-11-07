import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { BoutonNouveauDevis } from './BoutonNouveauDevis';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('BoutonNouveauDevis — depuis la fiche véhicule', () => {
  it('crée le devis avec le véhicule déjà choisi (vehiculeId transmis sans le ressaisir)', async () => {
    const corps: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'receptionnaire' },
        }),
      ),
      http.get('/api/v1/clients/cl-1/vehicules', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
      http.post('/api/v1/documents-vente', async ({ request }) => {
        corps.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(
          { donnees: { id: 'doc-1', typeDocument: 'devis' }, avertissements: [] },
          { status: 201 },
        );
      }),
    );
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    renduAvecRoutes(
      [
        {
          path: '/',
          element: (
            <BoutonNouveauDevis
              client={{ id: 'cl-1', nomAffiche: 'Jean Dupont' }}
              vehiculeId="v-1"
            />
          ),
        },
      ],
      { routeInitiale: '/?site=site-1' },
    );

    await utilisateur.click(await screen.findByRole('button', { name: 'Nouveau devis' }));
    const dialogue = await screen.findByRole('dialog', { name: 'Nouveau devis' });
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Créer le devis' }));

    await waitFor(() => expect(corps).toHaveLength(1));
    expect(corps[0]).toMatchObject({ typeDocument: 'devis', clientId: 'cl-1', vehiculeId: 'v-1' });
  });
});
