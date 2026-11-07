import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseMotifRendezVous } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SectionMotifsRendezVous } from './SectionMotifsRendezVous';

const CHEMIN = '/api/v1/motifs-rendez-vous';

const REVISION: ReponseMotifRendezVous = {
  id: 'm1',
  code: 'REVISION',
  libelleFr: 'Révision',
  libelleDe: null,
  libelleIt: null,
  dureeDefautMinutes: 60,
  heuresAtelierDefautCentiemes: null,
  actif: true,
};

function rendre(peutEcrire = true) {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <SectionMotifsRendezVous peutEcrire={peutEcrire} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const t = (cle: string) => i18n.t(cle);

describe('SectionMotifsRendezVous', () => {
  it('liste vide : message et action de création', async () => {
    server.use(http.get(CHEMIN, () => HttpResponse.json([])));
    rendre();
    expect(await screen.findByText(t('parametrage:motifsRdv.vide.titre'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('parametrage:motifsRdv.nouveau') }),
    ).toBeInTheDocument();
  });

  it('affiche durée et état en mots, pas en couleur seule', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json([REVISION, { ...REVISION, id: 'm2', libelleFr: 'Vieux', actif: false }]),
      ),
    );
    rendre();
    expect(await screen.findByText('Révision')).toBeInTheDocument();
    expect(screen.getAllByText('60 min').length).toBeGreaterThan(0);
    expect(screen.getByText(t('parametrage:motifsRdv.statut.actif'))).toBeInTheDocument();
    expect(screen.getByText(t('parametrage:motifsRdv.statut.desactive'))).toBeInTheDocument();
  });

  it('crée un motif : code dérivé du nom, durée en nombre', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json([])),
      http.post(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json(REVISION, { status: 201 });
      }),
    );
    rendre();
    await userEvent.click(
      await screen.findByRole('button', { name: t('parametrage:motifsRdv.nouveau') }),
    );
    const dialogue = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialogue).getByLabelText(t('parametrage:motifsRdv.champs.libelleFr')),
      'Expertise MFK',
    );
    await userEvent.type(
      within(dialogue).getByLabelText(t('parametrage:motifsRdv.champs.dureeMinutes')),
      '45',
    );
    await userEvent.click(
      within(dialogue).getByRole('button', { name: t('commun:actions.enregistrer') }),
    );

    await screen.findByText(t('parametrage:motifsRdv.vide.titre'));
    expect(corps).toMatchObject({
      code: 'EXPERTISE-MFK',
      libelleFr: 'Expertise MFK',
      dureeDefautMinutes: 45,
    });
  });

  it('code déjà pris (409) : message sur le nom, saisie conservée', async () => {
    server.use(
      http.get(CHEMIN, () => HttpResponse.json([])),
      http.post(CHEMIN, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflit', status: 409, code: 'CONFLIT', instance: '/x' },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    await userEvent.click(
      await screen.findByRole('button', { name: t('parametrage:motifsRdv.nouveau') }),
    );
    const dialogue = await screen.findByRole('dialog');
    const champ = within(dialogue).getByLabelText(t('parametrage:motifsRdv.champs.libelleFr'));
    await userEvent.type(champ, 'Révision');
    await userEvent.click(
      within(dialogue).getByRole('button', { name: t('commun:actions.enregistrer') }),
    );

    expect(
      await within(dialogue).findByText(t('parametrage:motifsRdv.erreurs.dejaPris')),
    ).toBeInTheDocument();
    expect(champ).toHaveValue('Révision');
  });

  it('désactive un motif : PATCH actif:false (jamais de DELETE)', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json([REVISION])),
      http.patch(`${CHEMIN}/m1`, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ ...REVISION, actif: false });
      }),
    );
    rendre();
    await userEvent.click(
      await screen.findByRole('button', { name: t('parametrage:motifsRdv.actions.desactiver') }),
    );
    await screen.findByRole('button', { name: t('parametrage:motifsRdv.actions.desactiver') });
    expect(corps).toEqual({ actif: false });
  });

  it('sans droit d’écriture : liste seule, aucun bouton de modification', async () => {
    server.use(http.get(CHEMIN, () => HttpResponse.json([REVISION])));
    rendre(false);
    expect(await screen.findByText('Révision')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('erreur de chargement : message avec Réessayer', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'x', status: 500, code: 'ERREUR_INTERNE', instance: '/x' },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    expect(await screen.findByText(t('parametrage:motifsRdv.erreur.titre'))).toBeInTheDocument();
  });
});
