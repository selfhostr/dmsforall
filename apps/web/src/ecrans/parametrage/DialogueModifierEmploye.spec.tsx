import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { UtilisateurResume } from '@dfa/shared';

import i18n from '@/i18n';
import { capacitesDuPrereglage, modeleCapacitesDeTest } from '@/composants/capacites/modele-test';
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
  capacites: capacitesDuPrereglage('technicien'),
  statut: 'actif',
  sites: [
    { id: 'site-1', nom: 'Site principal' },
    { id: 'site-ferme', nom: 'Ancien site' },
  ],
  sitePrincipalId: 'site-1',
  derniereConnexionLe: null,
  creeLe: '2026-08-01T08:00:00.000Z',
};

const SESSION_DIRECTION = {
  ...SESSION_TEST,
  utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' as const },
  capacites: capacitesDuPrereglage('direction'),
};
const HANDLER_MODELE = http.get('/api/v1/capacites/modele', () =>
  HttpResponse.json(modeleCapacitesDeTest()),
);

function groupe(domaine: string) {
  return screen.getByRole('radiogroup', {
    name: i18n.t('capacites:editeur.domaineAria', {
      domaine: i18n.t(`capacites:domaines.${domaine}.libelle`),
    }),
  });
}

describe('DialogueModifierEmploye — garage mono-site', () => {
  it('sans changement de poste : aucun PATCH /utilisateurs (la grille personnalisée n’est pas réinitialisée)', async () => {
    let patchUtilisateur = false;
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_DIRECTION)),
      HANDLER_MODELE,
      http.patch('/api/v1/utilisateurs/emp-1', () => {
        patchUtilisateur = true;
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
    expect(patchUtilisateur).toBe(false);
  });

  it('personnaliser la grille : PATCH …/capacites avec les seuls écarts, badge Personnalisé', async () => {
    const corps: { valeur: Record<string, unknown> | null } = { valeur: null };
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_DIRECTION)),
      HANDLER_MODELE,
      http.patch('/api/v1/utilisateurs/emp-1/capacites', async ({ request }) => {
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

    await userEvent.click(
      await within(await screen.findByRole('radiogroup', { name: /Pièces/ })).findByRole('radio', {
        name: 'Faire',
      }),
    );
    expect(screen.getByText(i18n.t('capacites:editeur.personnalise'))).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: i18n.t('parametrage:utilisateurs.modification.actions.enregistrer'),
      }),
    );

    await waitFor(() => expect(onFerme).toHaveBeenCalled());
    expect(corps.valeur).toEqual({ niveaux: { pieces: 'faire' } });
  });

  it('403 du serveur : message sous le champ nommé, dialogue ouvert, saisie conservée', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_DIRECTION)),
      HANDLER_MODELE,
      http.patch('/api/v1/utilisateurs/emp-1/capacites', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
            title: 'Droit insuffisant',
            status: 403,
            code: 'DROIT_INSUFFISANT',
            instance: 'req-3',
            erreurs: [
              {
                champ: 'niveaux.pieces',
                code: 'depassement',
                message: 'Vous ne pouvez pas accorder Pièces : Faire.',
              },
            ],
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const onFerme = vi.fn();
    render(
      <QueryClientProvider client={creerQueryClientTest()}>
        <DialogueModifierEmploye employe={EMPLOYE} onFerme={onFerme} />
      </QueryClientProvider>,
    );

    await screen.findByRole('radiogroup', { name: /Pièces/ });
    await userEvent.click(within(groupe('pieces')).getByRole('radio', { name: 'Faire' }));
    await userEvent.click(
      screen.getByRole('button', {
        name: i18n.t('parametrage:utilisateurs.modification.actions.enregistrer'),
      }),
    );

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Vous ne pouvez pas accorder Pièces : Faire.');
    expect(groupe('pieces')).toHaveAccessibleDescription(
      'Vous ne pouvez pas accorder Pièces : Faire.',
    );
    expect(within(groupe('pieces')).getByRole('radio', { name: 'Faire' })).toBeChecked();
    expect(onFerme).not.toHaveBeenCalled();
  });

  it('pendant le chargement de la session : enregistrer est impossible, aucun PATCH ne part', async () => {
    let patchRecu = false;
    server.use(
      HANDLER_MODELE,
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
