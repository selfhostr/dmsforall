import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { UtilisateurResume } from '@dfa/shared';

import i18n from '@/i18n';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { DialogueModifierEmploye } from './DialogueModifierEmploye';

// Rattaché à un site actif ET à un site inactif (absent de la liste des sites actifs).
const EMPLOYE: UtilisateurResume = {
  id: 'emp-1',
  prenom: 'Julie',
  nom: 'Rey',
  email: 'julie.rey@garage-martin.ch',
  role: 'technicien',
  statut: 'actif',
  sites: [
    { id: 'site-1', nom: 'Site principal' },
    { id: 'site-ferme', nom: 'Ancien site' },
  ],
  derniereConnexionLe: null,
  creeLe: '2026-08-01T08:00:00.000Z',
};

describe('DialogueModifierEmploye — garage mono-site', () => {
  it('ne touche pas aux rattachements : le PATCH ne porte pas siteIds (le site inactif est conservé)', async () => {
    const corps: { valeur: Record<string, unknown> | null } = { valeur: null };
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.patch('/api/v1/utilisateurs/emp-1', async ({ request }) => {
        corps.valeur = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...EMPLOYE });
      }),
    );
    const onFerme = vi.fn();
    render(
      <QueryClientProvider client={creerQueryClientTest()}>
        <DialogueModifierEmploye employe={EMPLOYE} onFerme={onFerme} />
      </QueryClientProvider>,
    );

    const enregistrer = await screen.findByRole('button', {
      name: i18n.t('parametrage:utilisateurs.modification.actions.enregistrer'),
    });
    // Session chargée : le bouton s'active (jamais avant, voir le cas suivant).
    await waitFor(() => expect(enregistrer).toBeEnabled());
    await userEvent.click(enregistrer);

    await waitFor(() => expect(onFerme).toHaveBeenCalled());
    expect(corps.valeur).toEqual({ role: 'technicien' });
    expect(corps.valeur).not.toHaveProperty('siteIds');
  });

  it('pendant le chargement de la session : enregistrer est impossible, aucun PATCH ne part', async () => {
    let patchRecu = false;
    server.use(
      http.get('/api/v1/auth/moi', async () => {
        await delay('infinite');
        return HttpResponse.json(null);
      }),
      http.patch('/api/v1/utilisateurs/emp-1', () => {
        patchRecu = true;
        return HttpResponse.json({ ...EMPLOYE });
      }),
    );
    render(
      <QueryClientProvider client={creerQueryClientTest()}>
        <DialogueModifierEmploye employe={EMPLOYE} onFerme={vi.fn()} />
      </QueryClientProvider>,
    );

    const enregistrer = await screen.findByRole('button', {
      name: i18n.t('parametrage:utilisateurs.modification.actions.enregistrer'),
    });
    expect(enregistrer).toBeDisabled();
    await userEvent.click(enregistrer);
    expect(patchRecu).toBe(false);
  });
});
