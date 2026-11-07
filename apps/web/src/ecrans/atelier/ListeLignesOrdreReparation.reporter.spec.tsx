import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseLigneOr } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { ListeLignesOrdreReparation } from './ListeLignesOrdreReparation';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const OR_ID = '3f8e2c1a-5b7d-4e9f-8a6b-1c2d3e4f5a6b';

const LIGNE_REFUSEE = {
  id: 'ligne-1',
  ordreReparationId: OR_ID,
  numeroOrdre: 1,
  type: 'forfait',
  origine: 'constatee',
  statut: 'refusee',
  payeur: 'client',
  payeurClientId: null,
  blocage: 'aucun',
  designation: 'Remplacement disques avant',
  quantiteMillieme: 1000,
  rabaisPourmille: 0,
  tauxTvaPourmille: 81,
  urgence: 'urgent',
  securite: true,
  motifAnnulation: null,
  factureId: null,
} as unknown as ReponseLigneOr;

function rendre(role: string, avecVehicule = true) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({
        ...SESSION_TEST,
        utilisateur: { ...SESSION_TEST.utilisateur, role },
      }),
    ),
  );
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <ListeLignesOrdreReparation
        orId={OR_ID}
        lignes={[LIGNE_REFUSEE]}
        lignesTronquees={false}
        vehiculeId={avecVehicule ? 'v-1' : undefined}
      />
    </QueryClientProvider>,
  );
}

describe('ListeLignesOrdreReparation — « Reporter ce travail »', () => {
  it('ouvre le dialogue prérempli avec la ligne et rattache le report à cet OR', async () => {
    const corps: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/v1/vehicules/v-1/travaux-reportes', async ({ request }) => {
        corps.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 't-1' }, { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre('chef_atelier');

    await utilisateur.click(await screen.findByRole('button', { name: /Reporter ce travail/ }));
    const dialogue = await screen.findByRole('dialog');
    expect(
      within(dialogue).getByRole('textbox', { name: /Travail à faire|Désignation/ }),
    ).toHaveValue('Remplacement disques avant');
    await utilisateur.click(within(dialogue).getByRole('button', { name: /Reporter|Enregistrer/ }));

    await waitFor(() => expect(corps).toHaveLength(1));
    expect(corps[0]).toMatchObject({
      designation: 'Remplacement disques avant',
      urgence: 'urgent',
      securite: true,
      ordreReparationOrigineId: OR_ID,
    });
  });

  it('n’apparaît pas sans véhicule connu ni pour un rôle sans droit', async () => {
    rendre('chef_atelier', false);
    await screen.findByText('Remplacement disques avant');
    expect(screen.queryByRole('button', { name: /Reporter ce travail/ })).not.toBeInTheDocument();
  });
});
