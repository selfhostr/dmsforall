import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseEnvoiCourriel, RoleUtilisateur } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerSessionTest } from '@/test/session';
import { creerQueryClientTest } from '@/test/utils';

import { EcranEnvoiCourriel } from './EcranEnvoiCourriel';

const CHEMIN = '/api/v1/parametres-entreprise/envoi-courriel';
const t = (cle: string, options?: Record<string, unknown>) => i18n.t(cle, options);

const NON_CONFIGURE: ReponseEnvoiCourriel = {
  reglage: null,
  source: 'aucune',
  configure: false,
  modeCapture: false,
  instanceDisponible: false,
  chiffrementDisponible: true,
};

const CONFIGURE: ReponseEnvoiCourriel = {
  ...NON_CONFIGURE,
  source: 'garage',
  configure: true,
  reglage: {
    hote: 'mail.infomaniak.com',
    port: 587,
    securite: 'starttls',
    utilisateur: 'atelier@garage-martin.ch',
    motDePasseDefini: true,
    adresseExpediteur: 'atelier@garage-martin.ch',
    nomAffiche: 'Garage Martin',
    adresseReponse: null,
    dernierTest: { le: '2026-11-08T09:30:00.000Z', succes: true, cause: null },
  },
};

function simuler(etat: ReponseEnvoiCourriel, role: RoleUtilisateur = 'direction') {
  const ecritures: Record<string, unknown>[] = [];
  const essais: Record<string, unknown>[] = [];
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(creerSessionTest(role))),
    http.get(CHEMIN, () => HttpResponse.json(etat)),
    http.patch(CHEMIN, async ({ request }) => {
      ecritures.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(CONFIGURE);
    }),
    http.post(`${CHEMIN}/test`, async ({ request }) => {
      essais.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ envoyeLe: '2026-11-08T10:00:00.000Z' });
    }),
  );
  return { ecritures, essais };
}

/** Champ par identifiant : le libellé accessible est aussi porté par le bouton « ? » voisin. */
async function champ(id: string): Promise<HTMLInputElement> {
  return waitFor(() => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) throw new Error(`champ ${id} absent`);
    return el;
  });
}

function rendre() {
  render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <EcranEnvoiCourriel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranEnvoiCourriel', () => {
  it('non configuré : état explicite en mot + icône, pas de bloc d’essai', async () => {
    simuler(NON_CONFIGURE);
    rendre();
    expect(await screen.findByText(t('parametrage:envoiCourriel.etat.nonConfigure'))).toBeVisible();
    expect(
      screen.queryByRole('button', { name: t('parametrage:envoiCourriel.essai.envoyer') }),
    ).toBeNull();
  });

  it('sans réglage, Infomaniak est proposé d’office (serveur, port, sécurité), puis l’enregistrement n’envoie pas de mot de passe vide', async () => {
    const { ecritures } = simuler(NON_CONFIGURE);
    const user = userEvent.setup();
    rendre();
    const hote = await champ('env-hote');
    expect(hote).toHaveValue('mail.infomaniak.com');
    await user.type(await champ('env-adresse-expediteur'), 'atelier@garage-martin.ch');
    await user.click(
      screen.getByRole('button', { name: t('parametrage:envoiCourriel.enregistrer') }),
    );
    await waitFor(() => expect(ecritures).toHaveLength(1));
    expect(ecritures[0]).toMatchObject({
      hote: 'mail.infomaniak.com',
      port: 587,
      securite: 'starttls',
      adresseExpediteur: 'atelier@garage-martin.ch',
      utilisateur: null,
    });
    expect('motDePasse' in (ecritures[0] ?? {})).toBe(false);
  });

  it('adresse d’expédition invalide : message sous le champ, rien n’est envoyé', async () => {
    const { ecritures } = simuler(NON_CONFIGURE);
    const user = userEvent.setup();
    rendre();
    await user.type(await champ('env-adresse-expediteur'), 'pas-une-adresse');
    await user.click(
      screen.getByRole('button', { name: t('parametrage:envoiCourriel.enregistrer') }),
    );
    expect(
      await screen.findByText(t('parametrage:envoiCourriel.champs.adresseExpediteur.erreur')),
    ).toBeVisible();
    expect(ecritures).toHaveLength(0);
  });

  it('configuré : le mot de passe n’est jamais affiché, seulement « enregistré » ; dernier essai visible', async () => {
    simuler(CONFIGURE);
    rendre();
    const motDePasse = await champ('env-mot-de-passe');
    expect(motDePasse).toHaveValue('');
    expect(motDePasse).toHaveAttribute(
      'placeholder',
      t('parametrage:envoiCourriel.champs.motDePasse.enregistre'),
    );
    expect(screen.getAllByText(/Dernier essai réussi/).length).toBeGreaterThan(0);
  });

  it('e-mail d’essai : envoie l’adresse saisie et confirme', async () => {
    const { essais } = simuler(CONFIGURE);
    const user = userEvent.setup();
    rendre();
    await user.type(await champ('env-essai-destinataire'), 'direction@garage-martin.ch');
    await user.click(
      screen.getByRole('button', { name: t('parametrage:envoiCourriel.essai.envoyer') }),
    );
    await waitFor(() => expect(essais).toEqual([{ destinataire: 'direction@garage-martin.ch' }]));
    expect(await screen.findByText(t('parametrage:envoiCourriel.essai.reussi'))).toBeVisible();
  });

  it('échec du test : le message du garagiste correspondant au code est affiché', async () => {
    simuler(CONFIGURE);
    server.use(
      http.post(`${CHEMIN}/test`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'x',
            status: 422,
            code: 'COURRIEL_AUTHENTIFICATION_ECHEC',
            instance: 'req-1',
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const user = userEvent.setup();
    rendre();
    await user.type(await champ('env-essai-destinataire'), 'direction@garage-martin.ch');
    await user.click(
      screen.getByRole('button', { name: t('parametrage:envoiCourriel.essai.envoyer') }),
    );
    expect(
      (await screen.findAllByText(t('erreurs:codes.COURRIEL_AUTHENTIFICATION_ECHEC'))).length,
    ).toBeGreaterThan(0);
  });

  it('mode capture : avertissement affiché', async () => {
    simuler({ ...NON_CONFIGURE, modeCapture: true });
    rendre();
    expect(await screen.findByText(t('parametrage:envoiCourriel.etat.modeCapture'))).toBeVisible();
  });
});
