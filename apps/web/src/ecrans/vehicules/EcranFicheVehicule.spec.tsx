import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ReponseContexteAtelier,
  ReponseDepotPneus,
  ReponseTravailReporte,
  ReponseVehicule,
  ReponseVehiculeDetention,
  ReponseVehiculeKilometrage,
} from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
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
        detail: null,
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
        detail: null,
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
    detail: null,
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
    detail: null,
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

const DEPOT_PNEUS: ReponseDepotPneus = {
  id: 'depot-1',
  vehiculeId: 'v1',
  siteId: 'site-1',
  saison: 'hiver',
  statut: 'en_depot',
  codeCase: 'H-014',
  dimension: '205/55 R16',
  etat: null,
  entreLe: '2026-01-01T08:00:00.000Z',
  dernierMouvementLe: '2026-01-01T08:00:00.000Z',
  motifSortie: null,
  ligneOrDernierChangementId: null,
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-01T08:00:00.000Z',
};

const DETENTIONS: readonly ReponseVehiculeDetention[] = [
  {
    id: 'd1',
    client: { id: 'c1', numeroClient: 'CLI-001', nomAffiche: 'Jean Dupont' },
    debutLe: '2020-01-01',
    finLe: null,
    motifFin: null,
  },
];

// `SESSION_TEST.utilisateur.role` = `chef_atelier` (a `vehicule.modifier`, voir `matrice-droits.ts`
// et `ecrans/vehicules/droits.ts`) : le rôle par défaut de ces tests doit voir le crayon d'édition
// de l'emplacement, cohérent avec le test d'intégration existant qui clique « Modifier ».
// Lot B (`docs/plan-refonte-navigation.md`) — quatre requêtes supplémentaires depuis cette fiche
// (« ses OR », « ses factures », « son jeu de pneus au dépôt », « dossier de vente ») —
// `server.listen({ onUnhandledRequest: 'error' })` (`test/setup.ts`) fait échouer toute requête
// non mockée, réponses vides par défaut ici plutôt que dans chaque test.
function installerHandlersLotB() {
  server.use(
    http.get('/api/v1/ordres-reparation', () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 }),
    ),
    http.get('/api/v1/documents-vente', () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 }),
    ),
    http.get('/api/v1/vehicules/v1/depots-pneus', () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 10 }),
    ),
    http.get('/api/v1/dossiers-vente', () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
    ),
  );
}

function installerHandlersOk() {
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
    http.get('/api/v1/vehicules/v1', () => HttpResponse.json(VEHICULE)),
    http.get('/api/v1/vehicules/v1/contexte-atelier', () => HttpResponse.json(CONTEXTE)),
    http.get('/api/v1/vehicules/v1/kilometrages', () => HttpResponse.json(KILOMETRAGES)),
    http.get('/api/v1/vehicules/v1/detentions', () => HttpResponse.json(DETENTIONS)),
    http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json(TRAVAUX_REPORTES)),
  );
  installerHandlersLotB();
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

  // Chantier « titres doublés & espacements » (17.08.2026) — `GabaritEcran` force ce h1 en
  // `sr-only` (contenu déjà affiché en gros caractères par `EnTeteFicheVehicule`, voir le
  // commentaire de `EcranFicheVehicule.tsx`) : présent dans le DOM pour un lecteur d'écran, jamais
  // retiré, mais masqué visuellement. `getByRole('heading', ...)` le trouve malgré tout (un élément
  // `sr-only` reste dans l'arbre d'accessibilité) — mesuré : `toBeVisible()` (jest-dom) ne teste que
  // `display`/`visibility`/`opacity`/`hidden`, jamais la technique `position: absolute; clip: …`
  // utilisée par `.sr-only`, et aucune feuille de style n'est chargée dans ces tests (jsdom) — cette
  // assertion resterait donc verte même si le masquage disparaissait. La classe posée par
  // `GabaritEcran` (`cn('texte-titre-page', !titreVisible && 'sr-only')`) est la preuve fiable ici.
  it('garde un h1 accessible « Fiche véhicule » dans le DOM, masqué via `sr-only`', async () => {
    installerHandlersOk();
    rendre();

    const titre = await screen.findByRole('heading', { level: 1, name: 'Fiche véhicule' });
    expect(titre).toBeInTheDocument();
    expect(titre.className).toMatch(/\bsr-only\b/);
  });

  it('affiche une erreur actionnable si le véhicule est introuvable, avec un bouton réessayer', async () => {
    // Lot B — `vehiculeId` vient du paramètre de route (toujours défini ici, `v1`), pas de la
    // résolution de `requeteVehicule` : les requêtes secondaires de ce lot (OR, factures, pneus,
    // dossiers de vente) partent donc MÊME quand la ressource primaire échoue en 404.
    installerHandlersLotB();
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
    expect(
      screen.getByText(
        "Cet élément n'existe plus ou a été supprimé. Revenez à la liste et recherchez-le de nouveau.",
      ),
    ).toBeInTheDocument();
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
    // Convergence patron de fiche (24.08.2026) : « Jean Dupont » apparaît désormais aussi dans le
    // fil d'Ariane (`FilAriane`, ancêtre « client ») en plus de `FriseDetentions` — `getAllByText`
    // plutôt qu'un match unique, sans affaiblir l'assertion.
    expect(screen.getAllByText('Jean Dupont').length).toBeGreaterThan(0);
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
    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier' }));
    const champ = screen.getByLabelText('Emplacement');
    await utilisateur.clear(champ);
    await utilisateur.type(champ, 'Atelier, pont 2');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corpsRecu).toEqual({ emplacementLibre: 'Atelier, pont 2' }));
    expect(await screen.findByText('Atelier, pont 2')).toBeInTheDocument();
  });

  // DÉFAUT AUDIT — LE PLUS GRAVE : une action proposée à qui ne peut pas l'accomplir. `technicien`
  // n'a que `vehicule.lire` côté API (`matrice-droits.ts`), PAS `vehicule.modifier` — sans cette
  // garde, il verrait le crayon, taperait un emplacement, et recevrait un refus serveur après
  // coup. Preuve bout en bout depuis la session réelle (au-dessus de la preuve unitaire sur
  // `ChampEmplacementVehicule.spec.tsx`, qui pilote `peutModifier` directement en prop).
  it("ne propose pas l'édition de l'emplacement à un rôle sans vehicule.modifier (technicien)", async () => {
    installerHandlersLotB();
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
        }),
      ),
      http.get('/api/v1/vehicules/v1', () => HttpResponse.json(VEHICULE)),
      http.get('/api/v1/vehicules/v1/contexte-atelier', () => HttpResponse.json(CONTEXTE)),
      http.get('/api/v1/vehicules/v1/kilometrages', () => HttpResponse.json(KILOMETRAGES)),
      http.get('/api/v1/vehicules/v1/detentions', () => HttpResponse.json(DETENTIONS)),
      http.get('/api/v1/vehicules/v1/travaux-reportes', () => HttpResponse.json(TRAVAUX_REPORTES)),
    );
    rendre();

    expect(await screen.findByText('Devant, place 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
  });

  // Défaut mesuré en test d'utilisabilité (`DialogueModifierIdentiteVehicule.tsx`) : un véhicule
  // créé sans VIN ni plaque après un refus de saisie silencieux n'avait ENSUITE aucun moyen d'en
  // recevoir une — pas de bouton « Modifier » sur la fiche, l'étiquette « Identification
  // incomplète » ne menant nulle part. Preuve bout en bout depuis la session réelle que
  // « Modifier l'identité du véhicule » (en-tête) ouvre le dialogue, que les deux mutations
  // indépendantes (VIN, plaque) partent avec les valeurs saisies, et que le dialogue se ferme
  // seulement une fois les deux réussies.
  it(
    "répare une identification incomplète (VIN + plaque) depuis le crayon de l'en-tête, " +
      'et fait disparaître le badge « Numéro de châssis manquant »',
    async () => {
      // GET /vehicules/v1 avec ÉTAT MUABLE : les deux mutations (VIN, plaque) invalident cette
      // ressource — pour prouver que le badge disparaît RÉELLEMENT après coup (pas seulement que
      // les corps envoyés sont corrects), le handler doit refléter ce que les mutations ont écrit,
      // comme le ferait le vrai serveur.
      let vehiculeActuel: ReponseVehicule = {
        ...VEHICULE,
        vin: null,
        plaque: null,
        canton: null,
        identificationIncomplete: true,
      };
      installerHandlersLotB();
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/vehicules/v1', () => HttpResponse.json(vehiculeActuel)),
        http.get('/api/v1/vehicules/v1/contexte-atelier', () =>
          HttpResponse.json({
            ...CONTEXTE,
            vehicule: { ...CONTEXTE.vehicule, vin: null, plaque: null, canton: null },
          }),
        ),
        http.get('/api/v1/vehicules/v1/kilometrages', () => HttpResponse.json(KILOMETRAGES)),
        http.get('/api/v1/vehicules/v1/detentions', () => HttpResponse.json(DETENTIONS)),
        http.get('/api/v1/vehicules/v1/travaux-reportes', () =>
          HttpResponse.json(TRAVAUX_REPORTES),
        ),
      );
      let corpsVin: Record<string, unknown> | null = null;
      let corpsPlaque: Record<string, unknown> | null = null;
      server.use(
        http.patch('/api/v1/vehicules/v1', async ({ request }) => {
          corpsVin = (await request.json()) as Record<string, unknown>;
          vehiculeActuel = { ...vehiculeActuel, vin: 'WVGZZZ1TZ8W123456' };
          return HttpResponse.json({ donnees: vehiculeActuel, avertissements: [] });
        }),
        http.post('/api/v1/vehicules/v1/plaques', async ({ request }) => {
          corpsPlaque = (await request.json()) as Record<string, unknown>;
          vehiculeActuel = {
            ...vehiculeActuel,
            plaque: 'VS 123456',
            canton: 'VS',
            identificationIncomplete: false,
          };
          return HttpResponse.json(
            { id: 'p1', valeur: 'VS 123456', canton: 'VS' },
            { status: 201 },
          );
        }),
      );
      const utilisateur = userEvent.setup();
      rendre();

      expect(await screen.findByText('Numéro de châssis manquant')).toBeInTheDocument();
      await utilisateur.click(
        screen.getByRole('button', { name: "Modifier l'identité du véhicule" }),
      );
      const dialogue = await screen.findByRole('dialog');
      await utilisateur.type(within(dialogue).getByLabelText('VIN'), 'WVGZZZ1TZ8W123456');
      await utilisateur.type(within(dialogue).getByLabelText('Plaque'), 'VS 123456');
      await utilisateur.type(within(dialogue).getByLabelText('Canton'), 'VS');
      await utilisateur.click(within(dialogue).getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => expect(corpsVin).toEqual({ vin: 'WVGZZZ1TZ8W123456' }));
      await waitFor(() =>
        expect(corpsPlaque).toEqual({
          valeur: 'VS 123456',
          canton: 'VS',
          pays: 'CH',
          debutLe: expect.any(String),
          interchangeable: false,
          professionnelle: false,
        }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.queryByText('Numéro de châssis manquant')).not.toBeInTheDocument(),
      );
    },
  );

  // Défaut corrigé (« le lien qui n'aboutit qu'à moitié ») : « Voir dans le hangar à pneus » menait
  // à `/pneus` sans jamais désigner LEQUEL des jeux du véhicule regarder — le magasinier devait
  // refaire une recherche visuelle dans le local pour retrouver la case H-014. Le lien transmet
  // désormais `?depot=<id>`, lu par `EcranHangarPneus` (même mécanique que `?site=`/`?onglet=`)
  // pour mettre la bonne carte en évidence.
  it('« Voir dans le hangar à pneus » transmet le dépôt concerné à l’écran du hangar', async () => {
    installerHandlersOk();
    server.use(
      http.get('/api/v1/vehicules/v1/depots-pneus', () =>
        HttpResponse.json({ donnees: [DEPOT_PNEUS], curseurSuivant: null, limite: 10 }),
      ),
    );
    rendre();

    // Convergence patron de fiche (24.08.2026) : « Pneus au dépôt » a rejoint le groupe
    // d'onglets dossier de vente/pneus/OR/factures — plus une carte toujours visible.
    await userEvent.click(await screen.findByRole('tab', { name: 'Pneus au dépôt' }));
    expect(await screen.findByText('H-014', { exact: false })).toBeInTheDocument();
    const lien = screen.getByRole('link', { name: 'Voir dans le hangar à pneus' });
    expect(lien).toHaveAttribute('href', '/pneus?depot=depot-1');
  });

  // Défaut corrigé (mesuré en navigateur, connecté `admin` — rôle SANS `ventes.dossier.lire`,
  // RF-115) : la requête `GET /dossiers-vente` partait sans garde de droits ni politique de
  // réessai — martèlement en boucle sur des 403, puis la section « Dossier de vente » disparaissait
  // en silence (un refus de droit rendu comme une absence de donnée, ce que la règle du dépôt
  // interdit explicitement). AUCUN handler `/api/v1/dossiers-vente` n'est enregistré ci-dessous :
  // `onUnhandledRequest: 'error'` (`test/setup.ts`) fait échouer ce test si l'écran émettait malgré
  // tout cette requête — la preuve la plus forte de « zéro requête », plus robuste qu'un compteur.
  it(
    'ne demande jamais les dossiers de vente à un rôle sans droit (admin) : zéro requête, ' +
      "message honnête plutôt qu'un vide fabriqué",
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () =>
          HttpResponse.json({
            ...SESSION_TEST,
            utilisateur: { ...SESSION_TEST.utilisateur, role: 'admin' },
          }),
        ),
        http.get('/api/v1/vehicules/v1', () => HttpResponse.json(VEHICULE)),
        http.get('/api/v1/vehicules/v1/contexte-atelier', () => HttpResponse.json(CONTEXTE)),
        http.get('/api/v1/vehicules/v1/kilometrages', () => HttpResponse.json(KILOMETRAGES)),
        http.get('/api/v1/vehicules/v1/detentions', () => HttpResponse.json(DETENTIONS)),
        http.get('/api/v1/vehicules/v1/travaux-reportes', () =>
          HttpResponse.json(TRAVAUX_REPORTES),
        ),
        http.get('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 }),
        ),
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 }),
        ),
        http.get('/api/v1/vehicules/v1/depots-pneus', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 10 }),
        ),
      );
      rendre();

      expect(
        await screen.findByText("Vous n'avez pas le droit de consulter les ventes de ce véhicule."),
      ).toBeInTheDocument();
    },
  );

  // Issue #97 : les rendez-vous d'un véhicule étaient filtrés par son DÉTENTEUR (`clientId`),
  // faute de filtre serveur `vehiculeId` — un véhicule SANS détenteur courant n'affichait ALORS
  // rien, cas désormais couvert par `GET /rendez-vous?vehiculeId=...` (filtre appliqué au SQL,
  // `service-rendez-vous.ts`). Ce test reproduit PRÉCISÉMENT le cas qui était impossible avant
  // correctif : `DETENTIONS` vide (aucun détenteur, contrairement à la fixture par défaut « Jean
  // Dupont ») et pourtant les rendez-vous du véhicule s'affichent.
  it(
    "affiche les rendez-vous d'un véhicule SANS détenteur courant (issue #97, filtre serveur " +
      'vehiculeId — cas auparavant impossible)',
    async () => {
      installerHandlersOk();
      const capture: { parametres: URLSearchParams | null } = { parametres: null };
      server.use(
        http.get('/api/v1/vehicules/v1/detentions', () => HttpResponse.json([])),
        http.get('/api/v1/rendez-vous', ({ request }) => {
          capture.parametres = new URL(request.url).searchParams;
          return HttpResponse.json({
            donnees: [
              {
                id: 'rdv-1',
                siteId: 'site-1',
                client: { id: 'c9', numeroClient: 'CLI-009', nomAffiche: 'Client Sans Lien' },
                vehicule: {
                  id: 'v1',
                  plaque: '123456',
                  canton: 'VD',
                  designation: 'VW Touran 2.0 TDI',
                  vin: 'WVGZZZ1TZ8W123456',
                  premiereMiseEnCirculationLe: '2018-03-14',
                  identificationIncomplete: false,
                  emplacementLibre: 'Devant, place 3',
                },
                type: 'service',
                motif: {
                  id: 'm1',
                  code: 'PNEUS',
                  libelleFr: 'Changement de pneus',
                  libelleDe: 'Reifenwechsel',
                  libelleIt: 'Cambio pneumatici',
                  dureeDefautMinutes: 45,
                  heuresAtelierDefautCentiemes: null,
                  actif: true,
                },
                commentaire: null,
                dateLe: '2026-09-01',
                moment: 'matin',
                heureSouhaitee: null,
                dureeEstimeeMinutes: 45,
                statut: 'confirme',
                motifAnnulation: null,
                origine: 'reservation',
                confirmeLe: '2026-08-01T08:00:00.000Z',
                honoreLe: null,
                absentConstateLe: null,
                annuleLe: null,
                ordreReparationId: null,
                creeParId: null,
                creeLe: '2026-08-01T08:00:00.000Z',
                modifieLe: '2026-08-01T08:00:00.000Z',
              },
            ],
            curseurSuivant: null,
            limite: 50,
          });
        }),
        http.get('/api/v1/motifs-rendez-vous', () => HttpResponse.json([])),
      );
      rendre();

      // `CarteRendezVous` (composant partagé, hors périmètre ici) affiche le créneau
      // (moment/heure) et le client, jamais `dateLe` directement — voir `libelleCreneau`.
      expect(await screen.findByText('Matin')).toBeInTheDocument();
      // Chaque ligne dit AUSSI quel jour et quel site (« jj.mm.aaaa · nom du site »), pas seulement
      // « Matin Confirmé ».
      expect(screen.getByText('01.09.2026 · Site principal')).toBeInTheDocument();
      expect(screen.getByText('Client Sans Lien', { exact: false })).toBeInTheDocument();
      // Le filtre serveur porte sur `vehiculeId`, plus jamais sur `clientId` (l'ancien
      // contournement, désormais retiré).
      expect(capture.parametres?.get('vehiculeId')).toBe('v1');
      expect(capture.parametres?.has('clientId')).toBe(false);
      // Le propriétaire de la fiche reste absent (règle « absence de donnée ≠ valeur ») — seule la
      // liste des rendez-vous ne dépend plus de lui.
      expect(screen.getByText('Aucun détenteur enregistré', { exact: false })).toBeInTheDocument();
    },
  );

  // Issue #59 : la carte « Factures » remontait devis/bon de commande/facture indifférenciés —
  // deux séries de numérotation DISTINCTES affichées ensemble fabriquaient l'illusion d'un doublon
  // de numéro (numéros adjacents `2026-00001` devis / `2026-00002` facture, vérifié en exécution
  // réelle). `typeDocument: ['facture']` — même convention que `EcranListeFactures.tsx`,
  // `useFacturesOuvertesClient.ts`, `TableauBordComptable.tsx` — plutôt qu'inventer un second
  // filtre ad hoc. Un devis en cours reste visible ailleurs (carte « Dossier de vente »), donc pas
  // reproduit ici.
  // DÉFAUT CORRIGÉ (issue #162, 16.08.2026, testé en navigateur avec vendeur@garage-martin.ch) :
  // les blocs « Ordres de réparation » et « Prochains rendez-vous » restaient en squelette de
  // chargement INDÉFINIMENT pour un rôle sans `atelier.or.lire`/`rendez_vous.lire` — les requêtes
  // partaient sans garde de droits ni politique de réessai, un 403 stable jamais transformé en état
  // affichable. AUCUN handler `/api/v1/ordres-reparation` ni `/api/v1/rendez-vous` n'est enregistré
  // ci-dessous : `onUnhandledRequest: 'error'` (`test/setup.ts`) fait échouer ce test si l'écran
  // émettait malgré tout l'une de ces deux requêtes — la preuve la plus forte de « zéro requête »,
  // plus robuste qu'un compteur.
  it(
    'ne demande ni les OR ni les rendez-vous à un rôle sans droit (vendeur) : zéro requête, ' +
      'message honnête plutôt qu’un chargement perpétuel',
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () =>
          HttpResponse.json({
            ...SESSION_TEST,
            utilisateur: { ...SESSION_TEST.utilisateur, role: 'vendeur' },
          }),
        ),
        http.get('/api/v1/vehicules/v1', () => HttpResponse.json(VEHICULE)),
        http.get('/api/v1/vehicules/v1/contexte-atelier', () => HttpResponse.json(CONTEXTE)),
        http.get('/api/v1/vehicules/v1/kilometrages', () => HttpResponse.json(KILOMETRAGES)),
        http.get('/api/v1/vehicules/v1/detentions', () => HttpResponse.json(DETENTIONS)),
        http.get('/api/v1/vehicules/v1/travaux-reportes', () =>
          HttpResponse.json(TRAVAUX_REPORTES),
        ),
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 }),
        ),
        http.get('/api/v1/vehicules/v1/depots-pneus', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 10 }),
        ),
        // `vendeur` ∈ `ROLES_LECTURE_DOSSIER_VENTE` (`ecrans/ventes/dossiers/droits.ts`) : cette
        // requête part normalement, contrairement aux deux gardées ci-dessus.
        http.get('/api/v1/dossiers-vente', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
        ),
        // `SectionRendezVousVehicule` lit ce référentiel sans garde de rôle (nécessaire même sans
        // droit de LECTURE, pour le dialogue de création) — sans rapport avec ce défaut.
        http.get('/api/v1/motifs-rendez-vous', () => HttpResponse.json([])),
      );
      rendre();

      // Convergence patron de fiche (24.08.2026) : « Ordres de réparation » a rejoint le groupe
      // d'onglets dossier de vente/pneus/OR/factures — plus une carte toujours visible. Les
      // rendez-vous, eux, restent une carte hors onglets (doctrine « SANS CLIQUER »).
      await userEvent.click(await screen.findByRole('tab', { name: 'Ordres de réparation' }));
      expect(
        await screen.findByText(
          "Vous n'avez pas le droit de consulter les ordres de réparation de ce véhicule.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Vous n'avez pas le droit de consulter les rendez-vous de ce véhicule."),
      ).toBeInTheDocument();
    },
  );

  it('ne demande que les factures (typeDocument=facture), jamais les devis/bons de commande, à « ses factures »', async () => {
    installerHandlersOk();
    const capture: { parametres: URLSearchParams | null } = { parametres: null };
    server.use(
      http.get('/api/v1/documents-vente', ({ request }) => {
        capture.parametres = new URL(request.url).searchParams;
        return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 });
      }),
    );
    rendre();

    // Convergence patron de fiche (24.08.2026) : « Factures » a rejoint le groupe d'onglets
    // dossier de vente/pneus/OR/factures — plus une carte toujours visible.
    await userEvent.click(await screen.findByRole('tab', { name: 'Factures' }));
    await screen.findByText('Aucune facture pour ce véhicule.');
    expect(capture.parametres?.getAll('typeDocument')).toEqual(['facture']);
  });
});
