import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import {
  demanderOuvertureAssistant,
  memoriserEtapeAssistant,
  reinitialiserEtatAssistant,
} from '@/hooks/assistant/etat-assistant';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerSessionTest } from '@/test/session';
import { creerQueryClientTest } from '@/test/utils';

import { ChecklistDemarrage } from './ChecklistDemarrage';

const t = (cle: string, options?: Record<string, unknown>) => i18n.t(cle, options);
const API = '/api/v1';
const CLE_FERMEE = `dfa.assistant-demarrage.ferme.${SESSION_TEST.tenant.id}.${SESSION_TEST.utilisateur.id}`;

const NEUF = {
  coordonnees: false,
  iban: false,
  numeroTva: false,
  tauxHoraire: false,
  motifsRdv: false,
  premierCollaborateur: false,
  borne: false,
};

function api(role: 'direction' | 'technicien', etapes: Partial<typeof NEUF> = {}) {
  server.use(
    http.get(`${API}/auth/moi`, () => HttpResponse.json(creerSessionTest(role))),
    http.get(`${API}/accueil/etat-demarrage`, () =>
      HttpResponse.json({ etapes: { ...NEUF, ...etapes } }),
    ),
    http.get(`${API}/parametres-entreprise`, () =>
      HttpResponse.json({ raisonSociale: 'G', numeroTva: null, delaiPaiementJoursDefaut: 30 }),
    ),
    http.get(`${API}/parametres-facturation/creancier`, () =>
      HttpResponse.json({
        nom: null,
        rue: null,
        numero: null,
        npa: null,
        localite: null,
        pays: 'CH',
        iban: null,
        qrIban: null,
        version: 0,
      }),
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

const assistant = () => screen.queryByRole('dialog', { name: t('assistant:titre') });

describe('ouverture de l’assistant de démarrage depuis l’accueil', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reinitialiserEtatAssistant();
  });

  it('garage neuf + droit : s’ouvre tout seul', async () => {
    api('direction');
    rendre();
    expect(await screen.findByRole('dialog', { name: t('assistant:titre') })).toBeInTheDocument();
  });

  it('sans le droit de gérer les paramètres : ne s’ouvre pas', async () => {
    api('technicien');
    rendre();
    await new Promise((r) => setTimeout(r, 80));
    expect(assistant()).toBeNull();
  });

  it('garage déjà configuré : ne s’ouvre pas', async () => {
    api('direction', {
      coordonnees: true,
      iban: true,
      tauxHoraire: true,
      motifsRdv: true,
      premierCollaborateur: true,
    });
    rendre();
    await new Promise((r) => setTimeout(r, 80));
    expect(assistant()).toBeNull();
  });

  it('état de démarrage indisponible : ne s’ouvre pas', async () => {
    api('direction');
    server.use(
      http.get(`${API}/accueil/etat-demarrage`, () =>
        HttpResponse.json({ code: 'ERREUR_INTERNE' }, { status: 500 }),
      ),
    );
    rendre();
    await new Promise((r) => setTimeout(r, 80));
    expect(assistant()).toBeNull();
  });

  it('déjà fermé par cette personne : ne s’ouvre pas, la carte propose la reprise', async () => {
    window.localStorage.setItem(CLE_FERMEE, '1');
    api('direction');
    rendre();
    const reprendre = await screen.findByRole('button', { name: t('assistant:reprise.bouton') });
    expect(assistant()).toBeNull();
    await userEvent.click(reprendre);
    expect(await screen.findByRole('dialog', { name: t('assistant:titre') })).toBeInTheDocument();
  });

  it('fermer mémorise localement par garage et utilisateur ; la reprise rouvre', async () => {
    api('direction');
    rendre();
    await screen.findByRole('dialog', { name: t('assistant:titre') });
    // Attendre la fin du chargement de l'étape : pendant celui-ci, « Quitter » est un bouton
    // provisoire (`PiedQuitterSeul`) que l'arrivée des données remplace par celui du formulaire.
    // Cliquer sur le provisoire détaché ne fermait rien (course, pas un défaut de l'assistant).
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: t('assistant:chargement') })).toBeNull(),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: t('assistant:actions.quitter') }),
    );
    expect(assistant()).toBeNull();
    expect(window.localStorage.getItem(CLE_FERMEE)).toBe('1');

    await userEvent.click(
      await screen.findByRole('button', { name: t('assistant:reprise.bouton') }),
    );
    expect(await screen.findByRole('dialog', { name: t('assistant:titre') })).toBeInTheDocument();
  });

  it('demande de la barre latérale : rouvre l’assistant à l’étape où il a été laissé', async () => {
    window.localStorage.setItem(CLE_FERMEE, '1');
    api('direction');
    memoriserEtapeAssistant('paiements');
    rendre();
    await screen.findByRole('button', { name: t('assistant:reprise.bouton') });
    expect(assistant()).toBeNull();

    act(() => demanderOuvertureAssistant());

    expect(await screen.findByRole('dialog', { name: t('assistant:titre') })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: t('assistant:etapes.paiements.titre'), level: 3 }),
    ).toBeInTheDocument();
  });

  it('une autre personne du même poste voit l’assistant (mémoire par utilisateur)', async () => {
    window.localStorage.setItem(
      `dfa.assistant-demarrage.ferme.${SESSION_TEST.tenant.id}.autre`,
      '1',
    );
    api('direction');
    rendre();
    expect(await screen.findByRole('dialog', { name: t('assistant:titre') })).toBeInTheDocument();
  });
});
