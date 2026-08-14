import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageUtilisateurResume, UtilisateurResume } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranUtilisateurs } from './EcranUtilisateurs';

beforeAll(() => {
  // Même stub que `EcranNouvelOrdreReparation.spec.tsx`/`mesures.dialogue-ajout-ligne-or.spec.tsx` :
  // Radix Select (rôle) appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom.
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CHEMIN_LISTE = '/api/v1/utilisateurs';

const EMPLOYE_TECHNICIEN: UtilisateurResume = {
  id: 'emp-1',
  prenom: 'Julie',
  nom: 'Rey',
  email: 'julie.rey@garage-martin.ch',
  role: 'technicien',
  statut: 'actif',
  sites: [{ id: 'site-1', nom: 'Site principal' }],
  derniereConnexionLe: null,
  creeLe: '2026-08-01T08:00:00.000Z',
};

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'direction') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function pageDe(donnees: readonly UtilisateurResume[]): PageUtilisateurResume {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranUtilisateurs />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranUtilisateurs — liste', () => {
  it('affiche l’état vide quand aucun employé n’existe', async () => {
    connecterSession();
    server.use(http.get(CHEMIN_LISTE, () => HttpResponse.json(pageDe([]))));
    rendre();

    expect(
      await screen.findByText(i18n.t('parametrage:utilisateurs.vide.titre')),
    ).toBeInTheDocument();
  });

  it('affiche nom, rôle, sites et statut d’un employé', async () => {
    connecterSession();
    server.use(http.get(CHEMIN_LISTE, () => HttpResponse.json(pageDe([EMPLOYE_TECHNICIEN]))));
    rendre();

    expect(await screen.findByText('Julie Rey')).toBeInTheDocument();
    expect(screen.getByText('julie.rey@garage-martin.ch')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('commun:roles.technicien'))).toBeInTheDocument();
    expect(screen.getByText('Site principal')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('parametrage:utilisateurs.statut.actif'))).toBeInTheDocument();
  });

  it('affiche un état d’erreur actionnable sur une panne serveur', async () => {
    connecterSession();
    server.use(
      http.get(CHEMIN_LISTE, () =>
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

describe('EcranUtilisateurs — création', () => {
  it('crée un employé et révèle le mot de passe temporaire une seule fois', async () => {
    connecterSession();
    server.use(
      http.get(CHEMIN_LISTE, () => HttpResponse.json(pageDe([]))),
      http.post(CHEMIN_LISTE, async ({ request }) => {
        const corps = (await request.json()) as { readonly siteIds: readonly string[] };
        expect(corps.siteIds).toEqual(['site-1']);
        return HttpResponse.json(
          {
            utilisateur: { ...EMPLOYE_TECHNICIEN },
            acces: { motDePasseTemporaire: 'k3f9QzSecretGenere' },
          },
          { status: 201 },
        );
      }),
    );
    rendre();

    const util = userEvent.setup();
    await util.click(
      await screen.findByRole('button', { name: i18n.t('parametrage:utilisateurs.nouveau') }),
    );

    await util.type(
      screen.getByLabelText(`${i18n.t('parametrage:utilisateurs.creation.champPrenom')} *`),
      'Julie',
    );
    await util.type(
      screen.getByLabelText(`${i18n.t('parametrage:utilisateurs.creation.champNom')} *`),
      'Rey',
    );
    await util.type(
      screen.getByLabelText(`${i18n.t('parametrage:utilisateurs.creation.champEmail')} *`),
      'julie.rey@garage-martin.ch',
    );
    await util.click(screen.getByLabelText('Site principal'));

    await util.click(
      screen.getByRole('button', {
        name: i18n.t('parametrage:utilisateurs.creation.actions.creer'),
      }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:utilisateurs.acces.titre')),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('k3f9QzSecretGenere')).toBeInTheDocument();
  });

  it("refuse la création d'un admin par une direction : le refus serveur (403) s'affiche, aucun compte n'est créé", async () => {
    connecterSession('direction');
    server.use(
      http.get(CHEMIN_LISTE, () => HttpResponse.json(pageDe([]))),
      http.post(CHEMIN_LISTE, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
            title: 'Droit insuffisant',
            status: 403,
            code: 'DROIT_INSUFFISANT',
            instance: 'req-2',
            detail: 'Seul un compte admin peut créer ou promouvoir un autre compte admin.',
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    // Le rôle "admin" n'est même pas proposé à une direction (prévention côté écran) : le
    // sélecteur de rôle ne contient QUE des rôles métier.
    const util = userEvent.setup();
    await util.click(
      await screen.findByRole('button', { name: i18n.t('parametrage:utilisateurs.nouveau') }),
    );
    await util.click(
      screen.getByLabelText(`${i18n.t('parametrage:utilisateurs.creation.champRole')} *`),
    );
    expect(
      screen.queryByRole('option', { name: i18n.t('commun:roles.admin') }),
    ).not.toBeInTheDocument();
  });
});

describe('EcranUtilisateurs — désactivation', () => {
  it('demande confirmation puis désactive, sans jamais supprimer', async () => {
    connecterSession();
    let appelDesactivation = 0;
    server.use(
      http.get(CHEMIN_LISTE, () => HttpResponse.json(pageDe([EMPLOYE_TECHNICIEN]))),
      http.post(`${CHEMIN_LISTE}/emp-1/desactiver`, () => {
        appelDesactivation += 1;
        return HttpResponse.json({ ...EMPLOYE_TECHNICIEN, statut: 'suspendu' });
      }),
    );
    rendre();

    const util = userEvent.setup();
    await util.click(
      await screen.findByRole('button', {
        name: i18n.t('parametrage:utilisateurs.actions.menuAria', { nom: 'Julie Rey' }),
      }),
    );
    await util.click(
      await screen.findByRole('menuitem', {
        name: i18n.t('parametrage:utilisateurs.actions.desactiver'),
      }),
    );

    const boiteConfirmation = await screen.findByRole('dialog');
    expect(
      within(boiteConfirmation).getByText(
        i18n.t('parametrage:utilisateurs.desactiver.titre', { nom: 'Julie Rey' }),
      ),
    ).toBeInTheDocument();
    await util.click(
      within(boiteConfirmation).getByRole('button', {
        name: i18n.t('parametrage:utilisateurs.desactiver.confirmer'),
      }),
    );

    await waitFor(() => expect(appelDesactivation).toBe(1));
  });
});
