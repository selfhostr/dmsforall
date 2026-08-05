import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ReponseContexteAtelier,
  ReponseTravailReporte,
  ReponseVehicule,
  ReponseVehiculeDetention,
  ReponseVehiculeKilometrage,
} from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFicheVehicule } from './EcranFicheVehicule';

// Radix Select (`@radix-ui/react-select`) appelle `hasPointerCapture`/`scrollIntoView`, absents de
// jsdom — même stub que `composants/comptoir/SelecteurTri.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const VEHICULE: ReponseVehicule = {
  id: 'v1',
  vin: 'WVGZZZ1TZ8W123456',
  marque: 'Volkswagen',
  modele: 'Touran',
  version: '2.0 TDI',
  finition: null,
  codeTypeCh: '1ZM431',
  premiereMiseEnCirculationLe: '2018-03-14',
  designation: 'VW Touran 2.0 TDI',
  plaque: '123456',
  canton: 'VD',
  carburant: 'diesel',
  cylindreeCm3: 1968,
  puissanceKw: 110,
  boite: 'manuelle',
  transmission: 'traction',
  normeEmission: 'euro6',
  couleur: 'gris',
  codeCouleur: null,
  poidsVideKg: 1500,
  poidsTotalKg: 2100,
  places: 5,
  pneusEte: '205/55 R16',
  pneusHiver: '205/55 R16',
  pressionPneus: '2.3 bar',
  huileType: '5W30',
  huileQuantiteDl: 45,
  batterie: 'Type X',
  codeRadio: '1234',
  codeCle: '5678',
  intervalleEntretienKm: 15000,
  intervalleEntretienMois: 12,
  importe: { estImporte: true, paysOrigine: 'DE', importeLe: '2019-02-01' },
  garantieConstructeur: {
    debutLe: '2024-01-01',
    finLe: '2027-01-01',
    plafondKm: 100000,
    active: true,
  },
  garantieGarage: null,
  proprietaireEconomiqueClientId: null,
  conducteurHabituel: null,
  identificationIncomplete: false,
  statut: 'actif',
  motifArchivage: null,
  fusionneVersVehiculeId: null,
  emplacementLibre: 'Devant, place 3',
  emplacementMajLe: '2026-07-20T09:15:00.000Z',
  creeLe: '2020-01-01T00:00:00.000Z',
  modifieLe: '2026-01-01T00:00:00.000Z',
};

// Reproduit le scénario du seed de démo mis en avant par la spécification (§brief) : expertise
// échue depuis 42 jours, deux travaux reportés dont un de sécurité.
const CONTEXTE: ReponseContexteAtelier = {
  vehicule: {
    id: 'v1',
    plaque: '123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    premiereMiseEnCirculationLe: '2018-03-14',
    vin: 'WVGZZZ1TZ8W123456',
    codeTypeCh: '1ZM431',
    importe: { estImporte: true, paysOrigine: 'DE', importeLe: '2019-02-01' },
    identificationIncomplete: false,
  },
  detenteurCourant: null,
  dernierKilometrage: {
    valeurKm: 90000,
    unite: 'km',
    releveLe: '2026-06-01T08:00:00.000Z',
    source: 'reception',
  },
  expertise: {
    derniereLe: '2022-05-01',
    prochaineLe: '2026-06-16',
    source: 'convocation',
    echue: true,
    joursDepuisEcheance: 42,
  },
  garantie: {
    constructeur: { debutLe: '2024-01-01', finLe: '2027-01-01', plafondKm: 100000, active: true },
    garage: null,
  },
  campagnesOuvertes: [],
  travauxReportes: {
    total: 2,
    elements: [
      {
        id: 't1',
        designation: 'Plaquettes de frein avant',
        urgence: 'urgent',
        montantEstimeCentimes: 24000,
        kilometrageAlors: 85000,
        constateLe: '2026-01-15',
        securite: true,
        statut: 'ouvert',
        ordreReparationOrigineId: null,
        ligneOrOrigineId: null,
        ordreReparationRepriseId: null,
        motifModification: null,
      },
      {
        id: 't2',
        designation: 'Amortisseur arrière gauche',
        urgence: 'a_surveiller',
        montantEstimeCentimes: 45000,
        kilometrageAlors: 80000,
        constateLe: '2025-11-02',
        securite: false,
        statut: 'ouvert',
        ordreReparationOrigineId: null,
        ligneOrOrigineId: null,
        ordreReparationRepriseId: null,
        motifModification: null,
      },
    ],
  },
  alertesClient: [],
  ordresReparationOuverts: [],
  depotPneus: null,
  avertissements: [],
};

// `PanneauTravauxReportes` consomme la ressource DÉDIÉE (`GET .../travaux-reportes`), pas la
// projection bornée de `contexte-atelier` — mêmes deux éléments que `CONTEXTE.travauxReportes`
// ci-dessus (même scénario de démo, RM-73) pour que les deux surfaces restent cohérentes en test.
const TRAVAUX_REPORTES: readonly ReponseTravailReporte[] = [
  {
    id: 't1',
    designation: 'Plaquettes de frein avant',
    urgence: 'urgent',
    montantEstimeCentimes: 24000,
    kilometrageAlors: 85000,
    constateLe: '2026-01-15',
    securite: true,
    statut: 'ouvert',
    ordreReparationOrigineId: null,
    ligneOrOrigineId: null,
    ordreReparationRepriseId: null,
    motifModification: null,
  },
  {
    id: 't2',
    designation: 'Amortisseur arrière gauche',
    urgence: 'a_surveiller',
    montantEstimeCentimes: 45000,
    kilometrageAlors: 80000,
    constateLe: '2025-11-02',
    securite: false,
    statut: 'ouvert',
    ordreReparationOrigineId: null,
    ligneOrOrigineId: null,
    ordreReparationRepriseId: null,
    motifModification: null,
  },
];

const KILOMETRAGES: readonly ReponseVehiculeKilometrage[] = [
  {
    id: 'k1',
    valeur: 90000,
    unite: 'km',
    valeurKm: 90000,
    releveLe: '2026-06-01T08:00:00.000Z',
    source: 'reception',
    motifRegression: null,
    ordreReparationId: null,
  },
];

const DETENTIONS: readonly ReponseVehiculeDetention[] = [
  {
    id: 'd1',
    client: { id: 'c1', numeroClient: 'CLI-001', nomAffiche: 'Jean Dupont' },
    debutLe: '2020-01-01',
    finLe: null,
    motifFin: null,
  },
];

function installerHandlersOk() {
  server.use(
    http.get('/api/v1/vehicules/v1', () => HttpResponse.json(VEHICULE)),
    http.get('/api/v1/vehicules/v1/contexte-atelier', () => HttpResponse.json(CONTEXTE)),
    http.get('/api/v1/vehicules/v1/kilometrages', () => HttpResponse.json(KILOMETRAGES)),
    http.get('/api/v1/vehicules/v1/detentions', () => HttpResponse.json(DETENTIONS)),
    http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json(TRAVAUX_REPORTES)),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/vehicules/v1']}>
        <Routes>
          <Route path="/vehicules/:vehiculeId" element={<EcranFicheVehicule />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFicheVehicule', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche le squelette de chargement avant la résolution des requêtes primaires', () => {
    installerHandlersOk();
    rendre();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable si le véhicule est introuvable, avec un bouton réessayer', async () => {
    server.use(
      http.get('/api/v1/vehicules/v1', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/RESSOURCE_INTROUVABLE',
            title: 'Introuvable',
            status: 404,
            code: 'RESSOURCE_INTROUVABLE',
            instance: 'req-1',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
      http.get('/api/v1/vehicules/v1/contexte-atelier', () => HttpResponse.json(CONTEXTE)),
    );
    rendre();

    expect(await screen.findByText('Impossible de charger le véhicule')).toBeInTheDocument();
    expect(screen.getByText('Cet élément est introuvable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it("affiche l'expertise échue et les travaux reportés SANS action supplémentaire (contexte-atelier)", async () => {
    installerHandlersOk();
    rendre();

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();
    expect(screen.getByText('Amortisseur arrière gauche')).toBeInTheDocument();
    // Expertise MFK échue (42 jours), visible SANS CLIQUER — la valeur du produit.
    expect(screen.getByText('16.06.2026')).toBeInTheDocument();
    expect(screen.getAllByText('Échue').length).toBeGreaterThan(0);
    // Identité, données d'atelier et historiques rendus depuis les fixtures dédiées.
    expect(screen.getByText('WVGZZZ1TZ8W123456')).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument(); // code radio (BlocDonneesAtelier)
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument(); // FriseDetentions
  });

  it('relève un kilométrage en progression sans confirmation supplémentaire', async () => {
    installerHandlersOk();
    server.use(
      http.post('/api/v1/vehicules/v1/kilometrages', async ({ request }) => {
        const corps = (await request.json()) as { readonly valeur: number };
        expect(corps.valeur).toBe(95000);
        return HttpResponse.json(
          { donnees: { ...KILOMETRAGES[0], valeur: 95000, valeurKm: 95000 }, avertissements: [] },
          { status: 201 },
        );
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Relever le kilométrage' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(within(dialogue).getByLabelText('Km', { exact: false }), '95000');
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: 'Relever le kilométrage' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('demande un motif puis confirme explicitement avant de rejouer une régression (RM-23/24/25)', async () => {
    installerHandlersOk();
    let tentatives = 0;
    server.use(
      http.post('/api/v1/vehicules/v1/kilometrages', async ({ request }) => {
        tentatives += 1;
        const corps = (await request.json()) as {
          readonly valeur: number;
          readonly motifRegression: string | null;
        };
        if (corps.motifRegression === null) {
          return HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/VEHICULE_KILOMETRAGE_REGRESSIF',
              title: 'Régression',
              status: 409,
              code: 'VEHICULE_KILOMETRAGE_REGRESSIF',
              instance: 'req-1',
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        expect(corps.motifRegression).toBe('compteur_remplace');
        return HttpResponse.json(
          {
            donnees: {
              ...KILOMETRAGES[0],
              id: 'k2',
              valeur: 100,
              valeurKm: 100,
              motifRegression: 'compteur_remplace',
            },
            avertissements: [],
          },
          { status: 201 },
        );
      }),
    );
    // `pointerEventsCheck: 0` : Radix Select + Dialog imbriqués laissent `pointer-events: none`
    // sur `<body>` un court instant après la fermeture du menu (verrou de scroll en cascade) —
    // sans ce contournement, le clic suivant sur « Continuer quand même » est silencieusement
    // ignoré par `user-event`, alors qu'il fonctionne réellement dans un navigateur.
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Relever le kilométrage' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(within(dialogue).getByLabelText('Km', { exact: false }), '100');
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: 'Relever le kilométrage' }),
    );

    // Motif redemandé, PAS de resoumission silencieuse.
    expect(
      await within(dialogue).findByText(
        'Le kilométrage saisi est inférieur au précédent. Indiquez un motif pour continuer.',
      ),
    ).toBeInTheDocument();
    const boutonContinuer = within(dialogue).getByRole('button', { name: 'Continuer quand même' });
    expect(boutonContinuer).toBeDisabled();

    await utilisateur.click(
      within(dialogue).getByRole('combobox', { name: 'Motif de la régression' }),
    );
    const listeMotifs = await screen.findByRole('listbox');
    await utilisateur.click(within(listeMotifs).getByText('Compteur remplacé'));
    expect(boutonContinuer).toBeEnabled();
    await utilisateur.click(boutonContinuer);

    // `AvertissementConfirmable` (confirmation en deux temps, invariant n°8) avant le rejeu : le
    // formulaire reste ouvert derrière lui mais Radix le marque `aria-hidden` tant que la
    // confirmation est au-dessus — un seul dialogue reste donc accessible à la requête.
    const dialogueConfirmation = await screen.findByRole('dialog');
    expect(within(dialogueConfirmation).getByText(/motif pour continuer/)).toBeInTheDocument();
    await utilisateur.click(
      within(dialogueConfirmation).getByRole('button', { name: 'Continuer quand même' }),
    );

    await waitFor(() => expect(tentatives).toBe(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('traduit le titre de la fiche en allemand', async () => {
    await i18n.changeLanguage('de');
    installerHandlersOk();
    rendre();
    expect(await screen.findByText('Werkstattdaten')).toBeInTheDocument();
    expect(screen.getByText('Halter')).toBeInTheDocument();
  });

  // Preuve d'intégration bout en bout (migration 0044, Lot C du plan du parc) : l'en-tête
  // (`EnTeteFicheVehicule` -> `ChampEmplacementVehicule` -> `useModifierEmplacementVehicule` ->
  // `PATCH /vehicules/{id}`) — au-delà de la couverture unitaire déjà faite sur le composant seul
  // (`composants/vehicule/ChampEmplacementVehicule.spec.tsx`), qui ne prouve pas que le fil est
  // réellement câblé depuis la fiche.
  it("modifie l'emplacement du véhicule en place depuis l'en-tête, sans quitter la fiche", async () => {
    installerHandlersOk();
    let corpsRecu: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/v1/vehicules/v1', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          donnees: {
            ...VEHICULE,
            emplacementLibre: 'Atelier, pont 2',
            emplacementMajLe: '2026-08-05T10:00:00.000Z',
          },
          avertissements: [],
        });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('Devant, place 3')).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    const champ = screen.getByLabelText('Emplacement');
    await utilisateur.clear(champ);
    await utilisateur.type(champ, 'Atelier, pont 2');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corpsRecu).toEqual({ emplacementLibre: 'Atelier, pont 2' }));
    expect(await screen.findByText('Atelier, pont 2')).toBeInTheDocument();
  });
});
