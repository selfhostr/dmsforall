import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { MODULES_APP, modulesActifsDepuis, type ModuleApp } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerSessionTest } from '@/test/session';
import { creerQueryClientTest } from '@/test/utils';

import { EcranModules } from './EcranModules';

const CHEMIN = '/api/v1/parametres-entreprise/modules';
const t = (cle: string, options?: Record<string, unknown>) => i18n.t(cle, options);
const nom = (id: ModuleApp) => t(`parametrage:modules.items.${id}.nom`);

function simuler(desactivesInitiaux: ModuleApp[] = []) {
  const ecritures: unknown[] = [];
  let desactives = desactivesInitiaux;
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(creerSessionTest('direction'))),
    http.get(CHEMIN, () =>
      HttpResponse.json({
        modulesDesactives: desactives,
        modulesActifs: modulesActifsDepuis(desactives),
      }),
    ),
    http.patch(CHEMIN, async ({ request }) => {
      const corps = (await request.json()) as { modulesDesactives: ModuleApp[] };
      ecritures.push(corps);
      desactives = corps.modulesDesactives;
      return HttpResponse.json({
        modulesDesactives: desactives,
        modulesActifs: modulesActifsDepuis(desactives),
      });
    }),
  );
  return ecritures;
}

function rendre() {
  render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <EcranModules />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranModules', () => {
  it('liste tous les modules du produit, un interrupteur chacun, tous activés par défaut', async () => {
    simuler();
    rendre();
    for (const id of MODULES_APP) {
      expect(await screen.findByRole('switch', { name: nom(id) })).toBeChecked();
    }
    expect(screen.getByText(t('parametrage:modules.socle'))).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /facturation/i })).toBeNull();
  });

  it('annonce la dépendance sur la ligne du module qui en dépend', async () => {
    simuler();
    rendre();
    await screen.findByRole('switch', { name: nom('pointage') });
    expect(
      screen.getByText(t('parametrage:modules.necessite', { modules: nom('atelier') })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        t('parametrage:modules.retireAussi', { modules: `${nom('pointage')}, ${nom('tablettes')}` }),
      ),
    ).toBeInTheDocument();
  });

  it('retirer un module enregistre la liste complète des modules retirés', async () => {
    const ecritures = simuler();
    rendre();
    await userEvent.click(await screen.findByRole('switch', { name: nom('pneus') }));
    await waitFor(() => expect(ecritures).toEqual([{ modulesDesactives: ['pneus'] }]));
    expect(await screen.findByText(t('parametrage:modules.etat.retire'))).toBeInTheDocument();
  });

  it('retirer atelier bloque pointage et tablettes en disant pourquoi ; réactiver restaure', async () => {
    const ecritures = simuler();
    rendre();
    await userEvent.click(await screen.findByRole('switch', { name: nom('atelier') }));
    await waitFor(() => expect(screen.getByRole('switch', { name: nom('pointage') })).toBeDisabled());
    expect(screen.getByRole('switch', { name: nom('tablettes') })).toBeDisabled();
    expect(screen.getByRole('switch', { name: nom('pointage') })).not.toBeChecked();
    expect(
      screen.getAllByText(t('parametrage:modules.bloque', { modules: nom('atelier') })).length,
    ).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('switch', { name: nom('atelier') }));
    await waitFor(() => expect(ecritures.at(-1)).toEqual({ modulesDesactives: [] }));
    await waitFor(() => expect(screen.getByRole('switch', { name: nom('pointage') })).toBeChecked());
  });

  it('erreur de chargement : message et bouton Réessayer', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(creerSessionTest('direction'))),
      http.get(CHEMIN, () => HttpResponse.error()),
    );
    rendre();
    expect(await screen.findByText(t('parametrage:modules.erreur.titre'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('commun:actions.reessayer') })).toBeInTheDocument();
  });
});
