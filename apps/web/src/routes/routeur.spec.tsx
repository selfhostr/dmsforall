import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ReponseOrdreReparation } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { routesConfig } from './routeur';

// jsdom (26.1, `src/test/environnementJsdomFetch.ts`) n'implémente PAS `ResizeObserver` — un vrai
// navigateur si. `/vehicules/nouveau` (`EcranNouveauVehicule`) monte une case à cocher
// `@radix-ui/react-checkbox` qui l'utilise inconditionnellement au montage
// (`CheckboxBubbleInput`, `useSize(control)`). Stub scopé à ce fichier (hors périmètre de cet
// agent : `src/test/setup.ts`, infrastructure de test partagée) — voir le même commentaire dans
// `ecrans/vehicules/EcranNouveauVehicule.spec.tsx`.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
  }
});

/** OR minimal mais complet (tous les champs requis du contrat) pour la fiche — voir
 *  `packages/shared/src/contrats/atelier/ordre-reparation.ts`. `actionsDisponibles: []` pour
 *  garder `PanneauActionsOr` sur son rendu le plus simple (« aucune action disponible »), le but
 *  du test ci-dessous n'étant pas de couvrir la machine à états mais le CÂBLAGE route -> requête. */
const OR_TEST: ReponseOrdreReparation = {
  id: 'or-1',
  numero: 'OR-2026-000123',
  siteId: 'site-1',
  type: 'reparation',
  statut: 'ouvert',
  client: {
    id: 'client-1',
    numeroClient: 'C-1',
    nomAffiche: 'Jean Dupont',
    type: 'particulier',
    statut: 'actif',
    langueCorrespondance: 'fr',
    poObligatoire: false,
    telephone: null,
    localite: null,
    nombreVehicules: 1,
    dernierPassageLe: null,
  },
  vehicule: {
    id: 'vehicule-1',
    plaque: 'VD 123456',
    canton: 'VD',
    designation: 'VW Golf',
    vin: null,
    premiereMiseEnCirculationLe: null,
    identificationIncomplete: false,
  },
  figees: {
    clientDesignation: 'Jean Dupont',
    adresseFacturation: null,
    plaque: 'VD 123456',
    detenteurClientId: 'client-1',
  },
  conducteurPresentNom: null,
  kilometrageEntree: null,
  kilometrageSortie: null,
  restitutionPromiseLe: null,
  restitutionInitialeLe: null,
  localisation: 'atelier',
  sousTraitantNom: null,
  ordreReparationParentId: null,
  motifLien: null,
  rendezVousId: null,
  numeroCommandeInterne: null,
  receptionnaireId: null,
  retentionInvoqueeLe: null,
  litigeOuvertLe: null,
  ouvertLe: '2026-07-01T08:00:00.000Z',
  termineLe: null,
  factureLe: null,
  restitueLe: null,
  clotureLe: null,
  annuleLe: null,
  motifAnnulation: null,
  demandes: [],
  lignes: [],
  nombreLignes: 0,
  lignesTronquees: false,
  devisComplementaires: [],
  controleQualite: null,
  signatures: [],
  pret: null,
  cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
  attentes: { accord: false, pieces: false, externe: false },
  etatAffiche: 'ouvert',
  actionsDisponibles: [],
  version: 1,
  creeLe: '2026-07-01T08:00:00.000Z',
  modifieLe: '2026-07-01T08:00:00.000Z',
  modifiePar: null,
};

/**
 * Comportements de bout en bout du routeur réel (`routesConfig`, la même configuration que celle
 * utilisée en production par `routeur` — voir routeur.tsx) : ce fichier teste l'ASSEMBLAGE, pas
 * les écrans eux-mêmes (déjà testés individuellement dans leurs `*.spec.tsx` respectifs).
 */
describe('routeur — protection par défaut', () => {
  it('une route métier protégée sans session redirige vers /login', async () => {
    // Handler par défaut de test/msw/handlers.ts : 401 sur /auth/moi (« pas de session »).
    renduAvecRoutes(routesConfig, { routeInitiale: '/clients' });
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('la même route protégée s’affiche avec une session valide', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/clients', () => HttpResponse.json({ donnees: [], curseurSuivant: null })),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/clients' });
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
  });

  it('/ amène à l’accueil', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, { routeInitiale: '/' });
    expect(
      await screen.findByText('Retrouvez un client, un véhicule ou un ordre'),
    ).toBeInTheDocument();
  });

  it('la route de création d’OR rend l’écran réel, pas le placeholder « fonction à venir »', async () => {
    // Défaut que ce test attrape : `atelier/ordres-reparation/nouveau` câblé sur
    // `EcranFonctionAVenir` (repli générique) plutôt que sur `EcranNouvelOrdreReparation` — les deux
    // écrans peuvent se ressembler à l'oeil (un titre, un bouton retour), donc l'assertion porte sur
    // un texte que SEUL l'écran réel produit : le repli « site manquant » de
    // `EcranNouvelOrdreReparation.tsx`, déclenché ici en n'apportant aucun `?site=`.
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, { routeInitiale: '/atelier/ordres-reparation/nouveau' });
    expect(await screen.findByText('Site non sélectionné')).toBeInTheDocument();
    expect(
      screen.queryByText("Cette fonctionnalité n'est pas encore disponible."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Cette page n'existe pas")).not.toBeInTheDocument();
  });

  it('la route de création d’OR reçoit `site` et `clientId` par paramètres de requête (jamais de chemin)', async () => {
    // Complète le test ci-dessus : une fois `?site=` fourni mais sans `?clientId=`, l'écran affiche
    // son second repli honnête (« client non sélectionné ») plutôt que de deviner un client — preuve
    // que le câblage passe bien par la query string, pas par un paramètre de route.
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, {
      routeInitiale: '/atelier/ordres-reparation/nouveau?site=site-1',
    });
    expect(await screen.findByText('Client non sélectionné')).toBeInTheDocument();
  });

  it('la fiche d’OR reçoit son identifiant depuis l’URL (`:orId`) et déclenche son chargement', async () => {
    // Défaut précis que ce test attrape : la route déclarait `:id` alors que
    // `EcranFicheOrdreReparation` lit `useParams<{ orId: string }>()` — `orId` valait alors
    // `undefined`, `useOrdreReparation` restait `enabled: false`, et la fiche restait bloquée en
    // chargement infini, sans la moindre erreur. Le seul moyen de le détecter est de vérifier que
    // la requête HTTP part bien avec l'identifiant DE L'URL, puis que le contenu réel s'affiche.
    let idRecu: string | undefined;
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/ordres-reparation/:orId', ({ params }) => {
        idRecu = params.orId as string;
        return HttpResponse.json(OR_TEST);
      }),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/ordres-reparation/or-1' });

    // Le numéro de l'OR ne peut s'afficher que si la requête a abouti : la preuve que l'écran n'est
    // pas resté bloqué en chargement (le défaut serait invisible autrement — pas d'erreur, pas de
    // message, juste un squelette qui ne finit jamais).
    expect(await screen.findByText(OR_TEST.numero)).toBeInTheDocument();
    expect(idRecu).toBe('or-1');
  });

  it('la liste des ordres de réparation est accessible à `/ordres-reparation`', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/ordres-reparation' });
    expect(
      await screen.findByRole('heading', { name: 'Ordres de réparation' }),
    ).toBeInTheDocument();
  });
});

/**
 * Bug critique confirmé au navigateur : `/vehicules/nouveau` n'avait AUCUNE route dédiée —
 * l'URL tombait sur `vehicules/:vehiculeId` avec `vehiculeId = "nouveau"`, `EcranFicheVehicule`
 * tentait alors `GET /vehicules/nouveau` et échouait toujours (« Impossible de charger le
 * véhicule »). Ce bloc verrouille le correctif : la route dédiée existe, monte le VRAI écran de
 * création, et ne déclenche plus l'appel `GET /vehicules/nouveau`.
 */
describe('routeur — /vehicules/nouveau rend l’écran de création, jamais la fiche d’un véhicule inexistant', () => {
  it('monte `EcranNouveauVehicule` (titre « Nouveau véhicule »), sans appeler `GET /vehicules/nouveau`', async () => {
    let cheminAppele: string | null = null;
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules/:vehiculeId', ({ params }) => {
        cheminAppele = params.vehiculeId as string;
        return HttpResponse.json(
          { type: 't', title: 't', status: 404, code: 'VEHICULE_INTROUVABLE', instance: 'r' },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        );
      }),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/vehicules/nouveau' });

    expect(
      await screen.findByRole('heading', { name: 'Nouveau véhicule', level: 1 }),
    ).toBeInTheDocument();
    // Preuve négative : ni le message d'erreur de la fiche, ni un appel réseau vers
    // `GET /vehicules/nouveau` (le défaut exact du bug initial).
    expect(screen.queryByText('Impossible de charger le véhicule')).not.toBeInTheDocument();
    expect(cheminAppele).toBeNull();
  });

  it('la fiche d’un véhicule réel reste accessible à `/vehicules/:vehiculeId` (non-régression)', async () => {
    const problemeVehiculeIntrouvable = () =>
      HttpResponse.json(
        { type: 't', title: 't', status: 404, code: 'VEHICULE_INTROUVABLE', instance: 'r' },
        { status: 404, headers: { 'content-type': 'application/problem+json' } },
      );
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      // Les deux requêtes PRIMAIRES de `EcranFicheVehicule` (véhicule + contexte-atelier)
      // doivent échouer explicitement ici — sinon `onUnhandledRequest: 'error'`
      // (`test/setup.ts`) ferait échouer ce test sur la requête non mockée, pas sur l'assertion.
      http.get('/api/v1/vehicules/:vehiculeId', problemeVehiculeIntrouvable),
      http.get('/api/v1/vehicules/:vehiculeId/contexte-atelier', problemeVehiculeIntrouvable),
    );
    // `vehiculeId` réel qui n'est PAS `nouveau` : ne doit jamais matcher la route de création.
    renduAvecRoutes(routesConfig, { routeInitiale: '/vehicules/vehicule-reel-1' });
    expect(await screen.findByText('Impossible de charger le véhicule')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nouveau véhicule' })).not.toBeInTheDocument();
  });
});

/**
 * RÉORIENTÉ par le coordinateur (lot 2) : la consigne initiale (« bloquer `technicien` sur
 * `/parametrage/referentiels` ») était mal calibrée — elle cassait l'usage du réceptionniste
 * (le rôle qui consulte LE PLUS les tarifs, au comptoir et au téléphone) sans ajouter de
 * protection réelle (`parametrage.referentiel.lire`/`parametrage.atelier.lire` sont ouverts à
 * tous côté API). La route ne pose donc plus `rolesAutorises` — voir `droits-routes.ts` pour
 * l'arbitrage complet. Ce test verrouille la décision dans le sens INVERSE de l'ancien : il
 * rougit si quelqu'un réintroduit une restriction de rôle sur ces routes en croyant « corriger un
 * oubli de sécurité ».
 */
describe('routeur — /parametrage/referentiels, /parametrage/atelier, /parametrage/sites : lecture ouverte à tout rôle authentifié (décision arbitrée)', () => {
  const TOUS_LES_ROLES = [
    'technicien',
    'receptionnaire',
    'magasinier',
    'comptable',
    'vendeur',
    'chef_atelier',
    'direction',
    'admin',
  ] as const;

  it.each(TOUS_LES_ROLES)(
    '%s atteint le contenu réel de /parametrage/referentiels (deux onglets), jamais l’accès refusé',
    async (role) => {
      server.use(
        http.get('/api/v1/auth/moi', () =>
          HttpResponse.json({
            ...SESSION_TEST,
            utilisateur: { ...SESSION_TEST.utilisateur, role },
          }),
        ),
      );
      renduAvecRoutes(routesConfig, { routeInitiale: '/parametrage/referentiels' });

      expect(await screen.findAllByRole('tab')).toHaveLength(2);
      expect(
        screen.queryByText("Vous n'avez pas les droits pour cette action."),
      ).not.toBeInTheDocument();
    },
  );
});

/**
 * RÉORIENTÉ (lot 2), deuxième volet demandé par le coordinateur : preuve qu'une route EFFECTIVEMENT
 * restreinte refuse bien — `/parametrage/facturation` (bloc créancier, RF-115), qui restreint la
 * LECTURE côté API à `direction`/`comptable` (contrairement aux trois routes ci-dessus). Rend la
 * VRAIE `routesConfig`, avec la vraie réaction au `403` de l'API (pas de `rolesAutorises` ici — voir
 * `routeur.tsx` — la protection est entièrement côté API + écran dédié).
 */
describe('routeur — /parametrage/facturation refuse réellement (protection par l’API, RF-115)', () => {
  it('admin : reçoit l’écran de refus dédié sur 403 DROIT_INSUFFISANT, jamais le formulaire réel', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'admin' },
        }),
      ),
      http.get('/api/v1/parametres-facturation/creancier', () =>
        HttpResponse.json(
          { type: 't', title: 't', status: 403, code: 'DROIT_INSUFFISANT', instance: 'r' },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/parametrage/facturation' });

    expect(
      await screen.findByText('Accès réservé à la direction et à la comptabilité'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Nom du garage')).not.toBeInTheDocument();
  });

  it('direction : atteint le formulaire réel, jamais l’écran de refus', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/parametres-facturation/creancier', () =>
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
    renduAvecRoutes(routesConfig, { routeInitiale: '/parametrage/facturation' });

    expect(await screen.findByLabelText('Nom du garage')).toBeInTheDocument();
    expect(
      screen.queryByText('Accès réservé à la direction et à la comptabilité'),
    ).not.toBeInTheDocument();
  });
});

/**
 * RÉORIENTÉ (lot 2), troisième volet : la distinction « qui peut atteindre » / « à qui on propose »
 * (`droits-routes.ts`) se prouve ici en assemblage complet — le menu masque « Paramétrage atelier »/
 * « Sites » à un rôle sans gouvernance, alors que la route elle-même (test ci-dessus) reste ouverte
 * en lecture à ce même rôle. Ergonomie, pas sécurité : jumeau de la couverture déjà posée dans
 * `BarreLaterale.spec.tsx`, ici rendue via le VRAI `routesConfig` (AppShell + BarreLaterale
 * assemblés, pas le composant isolé).
 */
describe('routeur — le menu masque Paramétrage atelier / Sites à un rôle sans gouvernance (ergonomie, pas sécurité)', () => {
  it('technicien : le menu ne propose ni Paramétrage atelier ni Sites, mais propose Référentiels', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
        }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/' });

    expect(await screen.findByRole('link', { name: /tarifs/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /paramètres atelier/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^sites$/i })).not.toBeInTheDocument();
  });

  it('chef d’atelier : le menu propose Référentiels, Paramétrage atelier et Sites', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, { routeInitiale: '/' });

    expect(await screen.findByRole('link', { name: /paramètres atelier/i })).toHaveAttribute(
      'href',
      '/parametrage/atelier',
    );
    expect(screen.getByRole('link', { name: /^sites$/i })).toHaveAttribute(
      'href',
      '/parametrage/sites',
    );
    expect(screen.getByRole('link', { name: /tarifs/i })).toHaveAttribute(
      'href',
      '/parametrage/referentiels',
    );
  });
});

/**
 * Module pièces (étape 3) — `rolesAutorises={ROLES_PIECES}` (`droits-routes.ts`) reflète une
 * restriction RÉELLE de l'API (`DROITS_PIECES_PAR_ROLE.admin = []`, RF-115) : contrairement à
 * `/parametrage/referentiels` (lecture ouverte à tous, testé plus haut), `admin` doit recevoir
 * l'écran de refus DÉDIÉ (`EcranAccesRefuse`), jamais l'écran réel qui échouerait de toute façon
 * sur chaque appel API. Un rôle opérationnel (magasinier — `SESSION_TEST` par défaut est
 * `chef_atelier`, déjà dans `ROLES_PIECES`) doit au contraire atteindre le contenu réel.
 */
describe('routeur — /pieces/* refuse admin (protection RÉELLE, RF-115), ouvre les rôles opérationnels', () => {
  it('admin : reçoit l’écran de refus dédié, jamais le contenu réel (aucun appel API nécessaire)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'admin' },
        }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/pieces/reservations' });

    expect(
      await screen.findByText("Vous n'avez pas les droits pour cette action."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Réservations' })).not.toBeInTheDocument();
  });

  it('un rôle opérationnel (chef_atelier) atteint le contenu réel de /pieces/reservations', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/reservations', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/pieces/reservations' });

    expect(await screen.findByRole('heading', { name: 'Réservations' })).toBeInTheDocument();
    expect(
      screen.queryByText("Vous n'avez pas les droits pour cette action."),
    ).not.toBeInTheDocument();
  });

  it('la recherche comptoir pièces est accessible à /pieces/recherche-comptoir', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, { routeInitiale: '/pieces/recherche-comptoir?site=site-1' });

    // `level: 1` : l'écran vide (aucune saisie encore) affiche AUSSI « Recherche comptoir » en
    // `<h2>` via `EtatVide` (invite à taper) — même texte, deux niveaux différents.
    expect(
      await screen.findByRole('heading', { name: 'Recherche comptoir', level: 1 }),
    ).toBeInTheDocument();
  });

  it('la fiche article reçoit son identifiant depuis l’URL (`:id`) et déclenche son chargement', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/articles/:id', ({ params }) =>
        HttpResponse.json({
          id: params.id,
          numeroArticle: 'P-000123',
          designation: 'Plaquettes de frein avant',
          marque: null,
          categorie: 'piece_mecanique',
          statut: 'actif',
          referencePrincipale: '1K0698151',
          codeBarres: null,
          prixAchatCentimes: null,
          prixVenteTtcCentimes: 8900,
          tauxTvaPourmille: 81,
          estEchangeStandard: false,
          montantConsigneTtcCentimes: null,
          referenceRemplacementId: null,
          references: [],
          referencesTronquees: false,
          stocksResume: [],
          creeLe: '2026-07-01T08:00:00.000Z',
          modifieLe: '2026-07-01T08:00:00.000Z',
        }),
      ),
      http.get('/api/v1/articles/:id/mouvements', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 30 }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/pieces/articles/art-1' });

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();
  });
});

/**
 * Le défaut que ce test existe pour attraper : un écran fini, testé, mais câblé nulle part — le
 * routeur n'expose alors qu'une fraction des écrans réellement livrés sans que rien ne le signale
 * (voir consigne de la tâche). Le scan est volontairement fait sur le DISQUE, jamais sur une
 * liste figée à la main — même raison que `scripts/verifier-i18n.mjs` (une liste en dur ment dès
 * qu'un écran s'ajoute sans qu'on pense à la mettre à jour).
 *
 * `ecrans/systeme/**` est exclu : ces écrans (page introuvable, erreur fatale, config invalide,
 * service indisponible, vérification de session) ne sont pas des routes avec un `path` propre —
 * ils sont câblés programmatiquement ailleurs (main.tsx, App.tsx, RouteProtegee/RoutePublique),
 * et le sont déjà (vérifié à la lecture de ces fichiers).
 */
describe('couverture des écrans métier', () => {
  const racineRoutes = path.dirname(fileURLToPath(import.meta.url));
  const racineSrc = path.resolve(racineRoutes, '..');
  const dossierEcrans = path.join(racineSrc, 'ecrans');
  const sourceRouteur = readFileSync(path.join(racineRoutes, 'routeur.tsx'), 'utf-8');

  function listerEcransMetier(dossier: string): string[] {
    const resultats: string[] = [];
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const cheminComplet = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === 'systeme') continue;
        resultats.push(...listerEcransMetier(cheminComplet));
        continue;
      }
      if (
        entree.name.startsWith('Ecran') &&
        entree.name.endsWith('.tsx') &&
        !entree.name.endsWith('.spec.tsx')
      ) {
        resultats.push(entree.name.replace(/\.tsx$/, ''));
      }
    }
    return resultats;
  }

  it('chaque écran métier existant (hors ecrans/systeme) est référencé dans le routeur', () => {
    const ecrans = listerEcransMetier(dossierEcrans);
    // Garde-fou : si le scan lui-même se casse silencieusement (mauvais chemin, etc.), ce test
    // ne doit pas passer « vide » — il doit trouver AU MOINS les écrans déjà connus au moment où
    // ce test est écrit.
    expect(ecrans.length).toBeGreaterThanOrEqual(7);
    const manquants = ecrans.filter((nomEcran) => !sourceRouteur.includes(nomEcran));
    expect(manquants).toEqual([]);
  });
});
