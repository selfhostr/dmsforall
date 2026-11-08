import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';

import { useFiltreSite } from '@/hooks/site/useFiltreSite';
import { server } from '@/test/msw/server';
import { creerSessionTest } from '@/test/session';
import { creerQueryClientTest } from '@/test/utils';

import { FiltreSite } from './FiltreSite';

const MART = { id: 'site-mart', code: 'MARTIGNY', codeCourt: 'MART', nom: 'Martigny', actif: true };
const SION = { id: 'site-sion', code: 'SION', codeCourt: 'SION', nom: 'Sion', actif: true };

function Harnais({ siteObligatoire = false }: { readonly siteObligatoire?: boolean }) {
  const filtre = useFiltreSite('test.ecran', { siteObligatoire });
  return (
    <>
      <FiltreSite filtre={filtre} />
      <output data-testid="site-effectif">{filtre.siteId ?? 'tous'}</output>
    </>
  );
}

function connecter(
  role: Parameters<typeof creerSessionTest>[0],
  sites: (typeof MART)[],
  sitePrincipalId: string | null,
) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json(creerSessionTest(role, { sites, sitePrincipalId })),
    ),
  );
}

function rendre(route = '/ecran', props: { siteObligatoire?: boolean } = {}) {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter initialEntries={[route]}>
        <Harnais {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => window.localStorage.clear());

const NOM_LISTE = 'Site';

async function ouvrir(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.click(await screen.findByRole('combobox', { name: NOM_LISTE }));
}

describe('FiltreSite', () => {
  it('un seul site : aucun filtre, mais le site est celui du garage', async () => {
    connecter('direction', [MART], 'site-mart');
    rendre();
    await waitFor(() => expect(screen.getByTestId('site-effectif')).toHaveTextContent('site-mart'));
    expect(screen.queryByTestId('filtre-site')).not.toBeInTheDocument();
  });

  it('deux sites : liste déroulante affichant le code court, défaut = site principal', async () => {
    connecter('magasinier', [MART, SION], 'site-sion');
    const utilisateur = userEvent.setup();
    rendre();
    const liste = await screen.findByRole('combobox', { name: NOM_LISTE });
    expect(liste).toHaveTextContent('SION');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('site-effectif')).toHaveTextContent('site-sion');
    await utilisateur.click(liste);
    expect(screen.getByRole('option', { name: 'MART' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SION' })).toBeInTheDocument();
  });

  it('une liste compacte, quel que soit le nombre de sites (largeur au contenu)', async () => {
    connecter('direction', [MART, SION], 'site-mart');
    rendre();
    const liste = await screen.findByRole('combobox', { name: NOM_LISTE });
    expect(liste.className).toContain('w-auto');
    expect(liste.className).not.toContain('w-full');
  });

  it('« Tous » proposé à la direction, absent pour un magasinier', async () => {
    connecter('direction', [MART, SION], 'site-mart');
    const utilisateur = userEvent.setup();
    const { unmount } = rendre();
    await ouvrir(utilisateur);
    expect(screen.getByRole('option', { name: 'Tous' })).toBeInTheDocument();
    unmount();

    connecter('magasinier', [MART, SION], 'site-mart');
    rendre();
    await ouvrir(utilisateur);
    expect(screen.queryByRole('option', { name: 'Tous' })).not.toBeInTheDocument();
  });

  it('« Tous » jamais proposé quand l’écran exige un site', async () => {
    connecter('direction', [MART, SION], 'site-mart');
    const utilisateur = userEvent.setup();
    rendre('/ecran', { siteObligatoire: true });
    await ouvrir(utilisateur);
    expect(screen.queryByRole('option', { name: 'Tous' })).not.toBeInTheDocument();
  });

  it('le choix est mémorisé pour cet écran seulement et retrouvé au remontage', async () => {
    connecter('direction', [MART, SION], 'site-mart');
    const utilisateur = userEvent.setup();
    const { unmount } = rendre();
    await ouvrir(utilisateur);
    await utilisateur.click(screen.getByRole('option', { name: 'Tous' }));
    expect(screen.getByTestId('site-effectif')).toHaveTextContent('tous');
    expect(window.localStorage.getItem('dfa.filtre-site.tenant-1.utilisateur-1.test.ecran')).toBe(
      'tous',
    );
    unmount();

    rendre();
    expect(await screen.findByRole('combobox', { name: NOM_LISTE })).toHaveTextContent('Tous');
    expect(screen.getByTestId('site-effectif')).toHaveTextContent('tous');
  });

  it('un lien profond ?site= prime puis cède au premier choix de la personne', async () => {
    connecter('direction', [MART, SION], 'site-mart');
    const utilisateur = userEvent.setup();
    rendre('/ecran?site=site-sion');
    expect(await screen.findByRole('combobox', { name: NOM_LISTE })).toHaveTextContent('SION');
    expect(screen.getByTestId('site-effectif')).toHaveTextContent('site-sion');

    await ouvrir(utilisateur);
    await utilisateur.click(screen.getByRole('option', { name: 'MART' }));
    expect(screen.getByTestId('site-effectif')).toHaveTextContent('site-mart');
  });
});
