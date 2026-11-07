import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseParametresSite } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranSites } from './EcranSites';

const CHEMIN = (siteId: string) => `/api/v1/sites/${siteId}/parametres-atelier`;

const PARAMETRES_SITE_1: ReponseParametresSite = {
  siteId: 'site-1',
  heureOuverture: '07:30',
  heureFermeture: '18:00',
  heureCloturePointage: '18:30',
  capaciteHeuresJourCentiemes: 4800,
  joursFermeture: ['2026-12-25'],
  version: 1_700_000_000_000,
};

function connecterSession(
  sites: (typeof SESSION_TEST)['sites'] = SESSION_TEST.sites,
  role: (typeof SESSION_TEST)['utilisateur']['role'] = 'chef_atelier',
) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({
        ...SESSION_TEST,
        sites,
        utilisateur: { ...SESSION_TEST.utilisateur, role },
      }),
    ),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranSites />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranSites — garage mono-site', () => {
  it('présélectionne l’unique site et affiche ses paramètres', async () => {
    connecterSession([
      { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
    ]);
    server.use(http.get(CHEMIN('site-1'), () => HttpResponse.json(PARAMETRES_SITE_1)));
    rendre();

    expect(
      await screen.findByLabelText(i18n.t('parametrage:sites.horaires.ouverture')),
    ).toHaveValue('07:30');
    expect(screen.getByLabelText(i18n.t('parametrage:sites.horaires.fermeture'))).toHaveValue(
      '18:00',
    );
    expect(screen.getByText('25.12.2026')).toBeInTheDocument();
    // Un seul site : pas de liste de navigation à afficher.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('enregistre une modification des horaires', async () => {
    connecterSession([
      { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
    ]);
    let corpsRecu: unknown;
    server.use(
      http.get(CHEMIN('site-1'), () => HttpResponse.json(PARAMETRES_SITE_1)),
      http.patch(CHEMIN('site-1'), async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          ...PARAMETRES_SITE_1,
          heureOuverture: '08:00',
          version: PARAMETRES_SITE_1.version + 1,
        });
      }),
    );
    rendre();

    const champOuverture = await screen.findByLabelText(
      i18n.t('parametrage:sites.horaires.ouverture'),
    );
    const utilisateur = userEvent.setup();
    await utilisateur.clear(champOuverture);
    await utilisateur.type(champOuverture, '08:00');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:sites.enregistrementReussi')),
    ).toBeInTheDocument();
    await waitFor(() => expect(corpsRecu).toMatchObject({ heureOuverture: '08:00' }));
  });

  it("affiche un bandeau lecture seule pour un rôle sans droit d'écriture (technicien)", async () => {
    connecterSession(
      [{ id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true }],
      'technicien',
    );
    server.use(http.get(CHEMIN('site-1'), () => HttpResponse.json(PARAMETRES_SITE_1)));
    rendre();

    expect(await screen.findByText(i18n.t('parametrage:atelier.lectureSeule'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    ).not.toBeInTheDocument();
  });

  it('affiche un état d’erreur actionnable sur une panne serveur', async () => {
    connecterSession([
      { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
    ]);
    server.use(
      http.get(CHEMIN('site-1'), () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(
      await screen.findByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    ).toBeInTheDocument();
  });
});

describe('EcranSites — garage multi-sites', () => {
  it('affiche la liste des sites et bascule entre eux', async () => {
    connecterSession([
      { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
      { id: 'site-2', code: 'ANNEXE', codeCourt: 'ANNEX', nom: 'Site annexe', actif: true },
    ]);
    server.use(
      http.get(CHEMIN('site-1'), () => HttpResponse.json(PARAMETRES_SITE_1)),
      http.get(CHEMIN('site-2'), () =>
        HttpResponse.json({
          ...PARAMETRES_SITE_1,
          siteId: 'site-2',
          heureOuverture: '09:00',
          joursFermeture: [],
        }),
      ),
    );
    rendre();

    expect(
      await screen.findByLabelText(i18n.t('parametrage:sites.horaires.ouverture')),
    ).toHaveValue('07:30');
    expect(screen.getByRole('navigation')).toBeInTheDocument();

    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole('button', { name: 'Site annexe' }));

    expect(
      await screen.findByLabelText(i18n.t('parametrage:sites.horaires.ouverture')),
    ).toHaveValue('09:00');
  });

  it('affiche l’état vide quand aucun site n’est rattaché au garage', async () => {
    connecterSession([]);
    rendre();

    expect(await screen.findByText(i18n.t('parametrage:sites.vide.titre'))).toBeInTheDocument();
  });
});

describe('EcranSites — code court du site', () => {
  const UN_SITE = [
    { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
  ];

  it('affiche le code court actuel et l’enregistre en majuscules (PATCH /sites/{id})', async () => {
    connecterSession(UN_SITE, 'direction');
    let corps: unknown;
    server.use(
      http.get(CHEMIN('site-1'), () => HttpResponse.json(PARAMETRES_SITE_1)),
      http.patch('/api/v1/sites/site-1', async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ ...UN_SITE[0], codeCourt: 'MART' });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    const champ = await screen.findByLabelText(i18n.t('parametrage:sites.codeCourt.champ'));
    expect(champ).toHaveValue('PRINC');
    await utilisateur.clear(champ);
    await utilisateur.type(champ, 'mart');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('parametrage:sites.codeCourt.enregistrer') }),
    );

    await waitFor(() => expect(corps).toEqual({ codeCourt: 'MART' }));
    expect(
      await screen.findByText(i18n.t('parametrage:sites.codeCourt.enregistre')),
    ).toBeInTheDocument();
  });

  it('refuse un code hors format, champ par champ, sans rien envoyer', async () => {
    connecterSession(UN_SITE, 'direction');
    let appels = 0;
    server.use(
      http.get(CHEMIN('site-1'), () => HttpResponse.json(PARAMETRES_SITE_1)),
      http.patch('/api/v1/sites/site-1', () => {
        appels += 1;
        return HttpResponse.json(UN_SITE[0]);
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    const champ = await screen.findByLabelText(i18n.t('parametrage:sites.codeCourt.champ'));
    await utilisateur.clear(champ);
    await utilisateur.type(champ, 'a-b');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('parametrage:sites.codeCourt.enregistrer') }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('parametrage:sites.codeCourt.format'),
    );
    expect(appels).toBe(0);
    expect(champ).toHaveValue('a-b');
  });

  it('doublon dans le garage (409) : message actionnable, saisie conservée', async () => {
    connecterSession(UN_SITE, 'direction');
    server.use(
      http.get(CHEMIN('site-1'), () => HttpResponse.json(PARAMETRES_SITE_1)),
      http.patch('/api/v1/sites/site-1', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/CONFLIT',
            title: 'Conflit',
            status: 409,
            instance: '/api/v1/sites/site-1',
            code: 'CONFLIT',
            detail: 'Ce code court est déjà utilisé par un autre site.',
            erreurs: [
              { champ: 'codeCourt', code: 'code_court_deja_utilise', message: 'déjà pris' },
            ],
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    const champ = await screen.findByLabelText(i18n.t('parametrage:sites.codeCourt.champ'));
    await utilisateur.clear(champ);
    await utilisateur.type(champ, 'SION');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('parametrage:sites.codeCourt.enregistrer') }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('parametrage:sites.codeCourt.dejaPris'),
    );
    expect(champ).toHaveValue('SION');
  });
});
