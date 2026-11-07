import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { DialogueNouveauDevis } from './DialogueNouveauDevis';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('DialogueNouveauDevis', () => {
  it('crée un devis (typeDocument devis, sans véhicule, sans ligne) pour le client donné, puis propose l’OR prérempli', async () => {
    const corps: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/v1/auth/session', () =>
        HttpResponse.json({
          utilisateur: { id: 'u1', role: 'receptionnaire' },
          sites: [{ id: 'site-1', nom: 'Lausanne', actif: true }],
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
            <DialogueNouveauDevis
              ouvert
              onOuvertChange={() => undefined}
              client={{ id: 'cl-1', nomAffiche: 'Jean Dupont' }}
            />
          ),
        },
      ],
      { routeInitiale: '/?site=site-1' },
    );

    const dialogue = await screen.findByRole('dialog', { name: 'Nouveau devis' });
    expect(within(dialogue).getByText('Jean Dupont')).toBeInTheDocument();
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Créer le devis' }));

    await waitFor(() => expect(corps).toHaveLength(1));
    expect(corps[0]).toMatchObject({
      typeDocument: 'devis',
      clientId: 'cl-1',
      siteId: 'site-1',
      vehiculeId: null,
      devise: 'CHF',
      lignes: [],
    });
    // Un devis neuf est vide : l'OR s'ouvre depuis le devis une fois envoyé et accepté, jamais
    // depuis un formulaire d'OR vierge.
    expect(await screen.findByRole('button', { name: 'Ouvrir le devis' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: "Créer l'OR à partir de ce devis" }),
    ).not.toBeInTheDocument();
  });
});
