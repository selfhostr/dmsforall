import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { DetailCollisionPlaqueVehicule, ReponseVehicule } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { DialogueModifierIdentiteVehicule } from './DialogueModifierIdentiteVehicule';

const VEHICULE: Pick<ReponseVehicule, 'id' | 'vin' | 'plaque'> = {
  id: 'v1',
  vin: null,
  plaque: null,
};

const DETAIL_COLLISION: DetailCollisionPlaqueVehicule = {
  vehiculeId: 'v-fautif',
  marque: 'Volkswagen',
  modele: 'Golf',
  version: 'VII',
  plaque: 'VD 999999',
  canton: 'VD',
  debutLe: '2024-05-01',
  finLe: null,
};

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DialogueModifierIdentiteVehicule
          vehicule={VEHICULE}
          peutGererPlaque
          ouvert
          onOuvertChange={() => {}}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** 409 VEHICULE_PLAQUE_COLLISION avec ou sans `blocages[0].donnees` — même forme que celle posée
 *  par `ServiceVehiculePlaque.creer` (`service-vehicule-plaque.ts:113-121`), reproduite ici plutôt
 *  qu'importée pour ne pas dépendre du code serveur dans un test front. */
function reponseCollision(avecDetail: boolean) {
  return HttpResponse.json(
    {
      type: 'https://docs.dmsforall.example/erreurs/VEHICULE_PLAQUE_COLLISION',
      title: 'Plaque déjà attribuée',
      status: 409,
      code: 'VEHICULE_PLAQUE_COLLISION',
      instance: 'req-1',
      ...(avecDetail
        ? {
            blocages: [
              {
                type: 'champ',
                id: 'valeur',
                libelle: 'Plaque en conflit',
                donnees: DETAIL_COLLISION,
              },
            ],
          }
        : {}),
    },
    { status: 409, headers: { 'content-type': 'application/problem+json' } },
  );
}

async function saisirEtSoumettrePlaque(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.type(screen.getByLabelText('Plaque'), 'VD 999999');
  await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));
}

describe('DialogueModifierIdentiteVehicule — collision de plaque (409 VEHICULE_PLAQUE_COLLISION)', () => {
  it('nomme le véhicule fautif et propose un lien vers sa fiche quand le détail est présent', async () => {
    server.use(http.post('/api/v1/vehicules/v1/plaques', () => reponseCollision(true)));
    const utilisateur = userEvent.setup();
    rendre();

    await saisirEtSoumettrePlaque(utilisateur);

    const messageErreur = await screen.findByText(
      'Plaque VD 999999 déjà portée par Volkswagen Golf VII depuis le 01.05.2024.',
    );
    expect(messageErreur).toBeInTheDocument();

    const lien = screen.getByRole('link', { name: 'Voir ce véhicule' });
    expect(lien).toHaveAttribute('href', '/vehicules/v-fautif');

    // Le champ plaque porte l'erreur pour le lecteur d'écran, sans dupliquer le message dans le
    // bandeau générique d'écran.
    const champPlaque = screen.getByLabelText('Plaque');
    expect(champPlaque).toHaveAttribute('aria-invalid', 'true');
    expect(champPlaque).toHaveAttribute('aria-describedby', 'modifier-plaque-collision-erreur');
    expect(screen.queryByText('Erreur inattendue')).not.toBeInTheDocument();
  });

  it('affiche un message sobre sans libellé à trous quand le détail est absent (course concurrente)', async () => {
    server.use(http.post('/api/v1/vehicules/v1/plaques', () => reponseCollision(false)));
    const utilisateur = userEvent.setup();
    rendre();

    await saisirEtSoumettrePlaque(utilisateur);

    expect(
      await screen.findByText('Cette plaque est déjà attribuée à un autre véhicule.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voir ce véhicule' })).not.toBeInTheDocument();
    // Ni "posée sur la  de " ni aucun fragment de libellé partiel.
    expect(screen.queryByText(/déjà portée par/)).not.toBeInTheDocument();
  });

  it('garde le bandeau générique existant pour les erreurs de plaque autres qu’une collision', async () => {
    server.use(
      http.post('/api/v1/vehicules/v1/plaques', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-2',
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await saisirEtSoumettrePlaque(utilisateur);

    await waitFor(() => {
      expect(screen.getByText(/Plaque\s*:/)).toBeInTheDocument();
    });
    expect(
      screen.queryByText('Cette plaque est déjà attribuée à un autre véhicule.'),
    ).not.toBeInTheDocument();
  });
});
