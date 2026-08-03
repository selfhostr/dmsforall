import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import type { PageCurseur, ReponsePrestation, ReponseTauxHoraire } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranReferentiels } from './EcranReferentiels';

// Radix Select appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CHEMIN_TAUX_HORAIRES = '/api/v1/referentiels/taux-horaires';
const CHEMIN_PRESTATIONS = '/api/v1/referentiels/prestations';

const TAUX_HORAIRE: ReponseTauxHoraire = {
  id: 'th-1',
  code: 'MEC',
  libelle: 'Mécanique générale',
  montantCentimes: 14500,
  valideDuLe: '2026-01-01',
  valideAuLe: null,
};

const PRESTATION: ReponsePrestation = {
  id: 'pr-1',
  code: 'VIDANGE-STD',
  designation: { fr: 'Vidange standard', de: 'Standard-Ölwechsel', it: 'Cambio olio standard' },
  typeLigne: 'forfait',
  tempsBaremeCentiemes: 50,
  tauxHoraireCode: 'MEC',
  tauxTvaPourmille: 81,
  prixCentimes: 9500,
  actif: true,
};

function pageVide<T>(): PageCurseur<T> {
  return { donnees: [], curseurSuivant: null, limite: 100 };
}

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'chef_atelier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranReferentiels />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranReferentiels — taux horaires', () => {
  it('affiche un état vide avec action de création quand le catalogue est vide (rôle habilité)', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    expect(
      await screen.findByText(i18n.t('parametrage:referentiels.tauxHoraires.vide.titre')),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', {
        name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
      }).length,
    ).toBeGreaterThan(0);
  });

  it('affiche la liste des taux horaires chargés', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () =>
        HttpResponse.json({
          donnees: [TAUX_HORAIRE],
          curseurSuivant: null,
          limite: 100,
        } satisfies PageCurseur<ReponseTauxHoraire>),
      ),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    expect(await screen.findByText('MEC')).toBeInTheDocument();
    expect(screen.getByText('Mécanique générale')).toBeInTheDocument();
    expect(screen.getByText('145.00')).toBeInTheDocument();
  });

  it('crée un nouveau taux horaire et l’envoie au serveur avec le corps attendu', async () => {
    connecterSession('chef_atelier');
    let corpsRecu: unknown;
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
      http.post(CHEMIN_TAUX_HORAIRES, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ ...TAUX_HORAIRE, id: 'th-2', code: 'CARR' }, { status: 201 });
      }),
    );
    rendre();

    const utilisateur = userEvent.setup();
    // Deux boutons portent le même intitulé (en-tête + état vide) : le premier suffit ici.
    const boutonsNouveau = await screen.findAllByRole('button', {
      name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
    });
    await utilisateur.click(boutonsNouveau[0]!);

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(
      within(dialogue).getByLabelText(i18n.t('parametrage:referentiels.tauxHoraires.champs.code')),
      'CARR',
    );
    await utilisateur.type(
      within(dialogue).getByLabelText(
        i18n.t('parametrage:referentiels.tauxHoraires.champs.libelle'),
      ),
      'Carrosserie',
    );
    // `ChampMontant` marque ce champ obligatoire d'un « * » ajouté au libellé — correspondance
    // partielle, pas le texte traduit exact. Le champ affiche déjà « 0.00 » (valeur par défaut de
    // création) : il faut le vider avant de taper, sinon la saisie s'ajoute au texte existant.
    const champMontant = within(dialogue).getByLabelText(
      i18n.t('parametrage:referentiels.tauxHoraires.champs.montant'),
      {
        exact: false,
      },
    );
    await utilisateur.clear(champMontant);
    await utilisateur.type(champMontant, '150.00');

    await utilisateur.click(
      within(dialogue).getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    await waitFor(() =>
      expect(corpsRecu).toMatchObject({
        code: 'CARR',
        libelle: 'Carrosserie',
        montantCentimes: 15000,
      }),
    );
  });

  it('grise les actions d’écriture pour un rôle sans droit de gouvernance du paramétrage (technicien)', async () => {
    connecterSession('technicien');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () =>
        HttpResponse.json({
          donnees: [TAUX_HORAIRE],
          curseurSuivant: null,
          limite: 100,
        } satisfies PageCurseur<ReponseTauxHoraire>),
      ),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    await screen.findByText('MEC');
    expect(
      screen.queryByRole('button', {
        name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('commun:actions.modifier') }),
    ).not.toBeInTheDocument();
  });

  it('affiche un état d’erreur avec bouton réessayer sur une panne serveur', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () =>
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
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    expect(
      await screen.findByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    ).toBeInTheDocument();
  });
});

describe('EcranReferentiels — catalogue de prestations', () => {
  it('bascule vers l’onglet prestations et affiche le catalogue chargé', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () =>
        HttpResponse.json({
          donnees: [PRESTATION],
          curseurSuivant: null,
          limite: 100,
        } satisfies PageCurseur<ReponsePrestation>),
      ),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );

    expect(await screen.findByText('VIDANGE-STD')).toBeInTheDocument();
    expect(screen.getByText('Vidange standard')).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('parametrage:referentiels.prestations.statutActif')),
    ).toBeInTheDocument();
  });

  it('affiche l’état vide « première utilisation » du catalogue de prestations', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:referentiels.prestations.vide.titre')),
    ).toBeInTheDocument();
  });
});
