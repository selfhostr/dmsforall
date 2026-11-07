import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BoutonVehiculeCourtoisieOr } from './BoutonVehiculeCourtoisieOr';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function parc(vehicules: readonly Record<string, unknown>[]) {
  server.use(
    http.get('/api/v1/courtoisie/vehicules', () =>
      HttpResponse.json({ du: 'a', au: 'b', vehicules }),
    ),
  );
}

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <BoutonVehiculeCourtoisieOr orId="or-1" clientId="cl-1" />
    </QueryClientProvider>,
  );
}

describe('BoutonVehiculeCourtoisieOr', () => {
  it('propose les véhicules libres puis ouvre le prêt (dialogue « Prêter ») pour ce véhicule', async () => {
    parc([
      {
        id: 'c1',
        designation: 'Fiat Panda',
        plaque: 'VS 111',
        etat: 'en_service',
        disponibilite: 'libre',
      },
      {
        id: 'c2',
        designation: 'Opel Corsa',
        plaque: 'VS 222',
        etat: 'en_service',
        disponibilite: 'occupe',
      },
    ]);
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre();

    await utilisateur.click(screen.getByRole('button', { name: 'Véhicule de courtoisie' }));
    expect(await screen.findByRole('button', { name: /Fiat Panda/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Opel Corsa/ })).not.toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: /Fiat Panda/ }));
    expect(await screen.findByText(/Fiat Panda · VS 111/)).toBeInTheDocument();
  });

  it('dit clairement quand aucun véhicule n’est libre', async () => {
    parc([]);
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre();

    await utilisateur.click(screen.getByRole('button', { name: 'Véhicule de courtoisie' }));
    expect(
      await screen.findByText('Aucun véhicule de courtoisie n’est libre aujourd’hui.'),
    ).toBeInTheDocument();
  });
});
