import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { ChecklistDemarrage } from './ChecklistDemarrage';

const page = (donnees: unknown[]) => ({ donnees, curseurSuivant: null, limite: 50 });
const t = (cle: string, options?: Record<string, unknown>) => i18n.t(cle, options);

const CREANCIER_VIDE = {
  nom: null,
  rue: null,
  numero: null,
  npa: null,
  localite: null,
  pays: 'CH',
  iban: null,
  qrIban: null,
  version: 0,
};

function api(
  opts: {
    creancier?: object;
    tva?: string | null;
    taux?: unknown[];
    motifs?: unknown[];
    autres?: boolean;
  } = {},
) {
  const utilisateurMoi = {
    id: SESSION_TEST.utilisateur.id,
    prenom: 'J',
    nom: 'D',
    email: 'j@d.ch',
    role: 'direction',
    statut: 'actif',
    sites: [],
    derniereConnexionLe: null,
    creeLe: '2026-01-01T00:00:00.000Z',
  };
  server.use(
    http.get('/api/v1/parametres-facturation/creancier', () =>
      HttpResponse.json(opts.creancier ?? CREANCIER_VIDE),
    ),
    http.get('/api/v1/parametres-entreprise', () =>
      HttpResponse.json({ raisonSociale: 'G', numeroTva: opts.tva ?? null }),
    ),
    http.get('/api/v1/referentiels/taux-horaires', () => HttpResponse.json(page(opts.taux ?? []))),
    http.get('/api/v1/motifs-rendez-vous', () => HttpResponse.json(opts.motifs ?? [])),
    http.get('/api/v1/utilisateurs', () =>
      HttpResponse.json(
        page(opts.autres ? [utilisateurMoi, { ...utilisateurMoi, id: 'paul' }] : [utilisateurMoi]),
      ),
    ),
    http.get('/api/v1/bornes', () => HttpResponse.json(page([]))),
  );
}

function session(role: string) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <ChecklistDemarrage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ligne = (id: string) =>
  screen.getByText(t(`accueil:demarrage.etapes.${id}.titre`)).closest('li') as HTMLElement;

describe('ChecklistDemarrage', () => {
  beforeEach(() => window.localStorage.clear());

  it('garage neuf (direction) : sept lignes, toutes à faire, chacune avec son lien et sa raison', async () => {
    session('direction');
    api();
    rendre();

    const titre = await screen.findByRole('heading', {
      name: t('accueil:demarrage.checklist.titre'),
    });
    expect(titre).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getAllByText(t('accueil:demarrage.etat.aFaire'), { exact: false }),
      ).toHaveLength(7),
    );

    const motifs = ligne('motifs');
    expect(
      within(motifs).getByText(t('accueil:demarrage.etapes.motifs.pourquoi')),
    ).toBeInTheDocument();
    expect(within(motifs).getByRole('link')).toHaveAttribute(
      'href',
      '/parametrage/atelier#motifs-rendez-vous',
    );
    expect(within(ligne('tva')).getByRole('link')).toHaveAttribute(
      'href',
      '/parametrage/facturation',
    );
    expect(within(ligne('tauxHoraire')).getByRole('link')).toHaveAttribute(
      'href',
      '/parametrage/referentiels',
    );
    expect(
      within(ligne('borne')).getByText(t('accueil:demarrage.facultatif'), { exact: false }),
    ).toBeInTheDocument();
  });

  it('étapes calculées depuis les données : TVA et taux horaire faits, le reste à faire', async () => {
    session('direction');
    api({ tva: 'CHE-116.281.710 TVA', taux: [{ id: 't1' }] });
    rendre();

    await waitFor(() =>
      expect(
        within(ligne('tva')).getByText(t('accueil:demarrage.etat.fait'), { exact: false }),
      ).toBeInTheDocument(),
    );
    expect(
      within(ligne('tauxHoraire')).getByText(t('accueil:demarrage.etat.fait'), { exact: false }),
    ).toBeInTheDocument();
    expect(
      within(ligne('motifs')).getByText(t('accueil:demarrage.etat.aFaire'), { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t('accueil:demarrage.checklist.progression', { faites: 2, total: 6 })),
    ).toBeInTheDocument();
  });

  it('tout réglé : la liste disparaît d’elle-même', async () => {
    session('direction');
    api({
      creancier: {
        ...CREANCIER_VIDE,
        nom: 'G',
        rue: 'R',
        npa: '1000',
        localite: 'L',
        iban: 'CH9300762011623852957',
      },
      tva: 'CHE-116.281.710 TVA',
      taux: [{ id: 't1' }],
      motifs: [{ id: 'm', actif: true }],
      autres: true,
    });
    rendre();
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: t('accueil:demarrage.checklist.titre') }),
      ).not.toBeInTheDocument(),
    );
    // et pas seulement pendant le chargement
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByRole('heading', { name: t('accueil:demarrage.checklist.titre') }),
    ).not.toBeInTheDocument();
  });

  it('« Ne plus afficher » masque et persiste pour cet utilisateur', async () => {
    session('direction');
    api();
    const { unmount } = rendre();
    await userEvent.click(
      await screen.findByRole('button', { name: t('accueil:demarrage.checklist.masquer') }),
    );
    expect(
      screen.queryByRole('heading', { name: t('accueil:demarrage.checklist.titre') }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`dfa.demarrage.masque.${SESSION_TEST.utilisateur.id}`)).toBe(
      '1',
    );

    unmount();
    rendre();
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByRole('heading', { name: t('accueil:demarrage.checklist.titre') }),
    ).not.toBeInTheDocument();
  });

  it('autre rôle : rien n’est affiché ni demandé', async () => {
    session('technicien');
    rendre();
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByRole('heading', { name: t('accueil:demarrage.checklist.titre') }),
    ).not.toBeInTheDocument();
  });

  it('source en erreur : « À vérifier » (jamais « À faire ») et possibilité de réessayer', async () => {
    session('direction');
    api({ tva: 'CHE-116.281.710 TVA' });
    server.use(
      http.get('/api/v1/parametres-facturation/creancier', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'x',
            status: 403,
            code: 'DROIT_INSUFFISANT',
            instance: '/x',
          },
          { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    await waitFor(() =>
      expect(
        within(ligne('compte')).getByText(t('accueil:demarrage.etat.inconnu'), { exact: false }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: t('accueil:demarrage.checklist.reessayer') }),
    ).toBeInTheDocument();
  });
});
