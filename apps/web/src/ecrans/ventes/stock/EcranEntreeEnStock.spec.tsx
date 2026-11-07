import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, VehiculeResume } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { enregistrerTraductionsTestVentes } from './_composants/traductions-test';
import { EcranEntreeEnStock } from './EcranEntreeEnStock';

beforeAll(() => {
  enregistrerTraductionsTestVentes();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const VEHICULE: VehiculeResume = {
  id: 'veh-2',
  plaque: 'VD 654321',
  canton: 'VD',
  designation: 'Skoda Octavia',
  vin: 'TMBJJ7NE5J0123456',
  premiereMiseEnCirculationLe: null,
  identificationIncomplete: false,
  emplacementLibre: null,
};

function pageDe(donnees: readonly VehiculeResume[]): PageCurseur<VehiculeResume> {
  return { donnees, curseurSuivant: null, limite: 20 };
}

/** `session` : override complet du corps de `GET /auth/moi` — posé par l'appelant AVANT `rendre`
 *  n'a aucun effet fiable, msw fait gagner le handler `server.use` le plus RÉCEMMENT posé : cette
 *  fonction est donc l'unique point qui enregistre `/auth/moi`, jamais un second `server.use`
 *  ajouté après coup par un test. */
function rendre(session: typeof SESSION_TEST = SESSION_TEST) {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(session)));
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/stock/nouveau']}>
        <Routes>
          <Route path="/ventes/stock/nouveau" element={<EcranEntreeEnStock />} />
          <Route path="/ventes/stock/:id" element={<div>Fiche stock ouverte</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranEntreeEnStock', () => {
  it('affiche l’écran de recherche avec le lien de création de véhicule', () => {
    rendre();

    expect(screen.getByText('Mettre un véhicule en stock')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Rechercher un véhicule (plaque, VIN, désignation)'),
    ).toBeInTheDocument();
    expect(screen.getByText("Créez-le d'abord")).toBeInTheDocument();
  });

  it('état vide : aucun véhicule trouvé pour la recherche', async () => {
    server.use(http.get('/api/v1/vehicules', () => HttpResponse.json(pageDe([]))));
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.type(
      screen.getByLabelText('Rechercher un véhicule (plaque, VIN, désignation)'),
      'introuvable',
    );

    expect(
      await screen.findByText('Aucun véhicule trouvé', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it('état erreur : la recherche échoue', async () => {
    server.use(
      http.get('/api/v1/vehicules', () =>
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

    const utilisateur = userEvent.setup();
    await utilisateur.type(
      screen.getByLabelText('Rechercher un véhicule (plaque, VIN, désignation)'),
      'skoda',
    );

    expect(
      await screen.findByText(
        "Un problème inattendu est survenu. Réessayez dans un instant ; s'il revient, prévenez le support en indiquant l'heure.",
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
  });

  it('choisit un véhicule, saisit la mise en stock et navigue vers la fiche stock', async () => {
    // `schemaMiseEnStock.siteId` (@dfa/shared) exige un UUID (`schemaIdentifiant`) — `SESSION_TEST`
    // (test/msw/handlers.ts) porte des identifiants lisibles (« site-1 ») qui ne passent PAS ce
    // format ; ce test surcharge la session avec un site au format UUID pour que le `safeParse`
    // côté formulaire (FormulaireEntreeEnStock.tsx) réussisse, comme le ferait un vrai serveur.
    const SITE_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    server.use(http.get('/api/v1/vehicules', () => HttpResponse.json(pageDe([VEHICULE]))));
    rendre({
      ...SESSION_TEST,
      sites: [
        {
          id: SITE_UUID,
          code: 'PRINCIPAL',
          codeCourt: 'PRINC',
          nom: 'Site principal',
          actif: true,
        },
      ],
    });

    const utilisateur = userEvent.setup();
    await utilisateur.type(
      screen.getByLabelText('Rechercher un véhicule (plaque, VIN, désignation)'),
      'octavia',
    );

    await utilisateur.click(
      await screen.findByRole('button', { name: 'Choisir' }, { timeout: 2000 }),
    );

    expect(await screen.findByText('Skoda Octavia')).toBeInTheDocument();

    server.use(
      http.post('/api/v1/vehicules/veh-2/stock', () =>
        HttpResponse.json(
          {
            donnees: {
              id: 'veh-2',
              siteId: SITE_UUID,
              vehicule: VEHICULE,
              provenance: 'achat_particulier',
              dateEntreeStock: '2026-08-03',
              prixAchatCentimes: 1_500_000,
              fraisRemiseEtatCumulesCentimes: 0,
              prixVenteAfficheCentimes: null,
              statutCommercial: 'disponible',
              typeVehicule: 'vo',
              vendeurPrecedentAssujetti: null,
              origineRepriseDossierVenteId: null,
              joursStock: 0,
              receptionneLe: null,
              reserveLe: null,
              venduLe: null,
              livreLe: null,
              actionsDisponibles: ['mettre_a_jour'],
              version: 1,
              creeLe: '2026-08-03T08:00:00.000Z',
              modifieLe: '2026-08-03T08:00:00.000Z',
              modifiePar: null,
            },
            avertissements: [],
          },
          { status: 201 },
        ),
      ),
    );

    // `ChampMontant` ajoute « *» au libellé pour un champ obligatoire (voir ChampMontant.tsx) —
    // `exact: false` pour matcher le sous-texte plutôt que l'intégralité de l'accessible name.
    const champPrix = screen.getByLabelText("Prix d'achat", { exact: false });
    await utilisateur.type(champPrix, '15000');

    await utilisateur.click(screen.getByRole('button', { name: 'Mettre en stock' }));

    expect(await screen.findByText('Fiche stock ouverte')).toBeInTheDocument();
  });
});
