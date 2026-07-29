import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ReponseOrdreReparation } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { routesConfig } from './routeur';

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
    expect(await screen.findByText('Retrouvez un client, un véhicule ou un ordre')).toBeInTheDocument();
  });

  it('un lien vers la création d’OR (écran pas encore écrit) affiche un message honnête, jamais une page introuvable', async () => {
    // La fiche client navigue déjà vers `/atelier/ordres-reparation/nouveau` alors qu'aucun écran
    // de création n'existe (hors périmètre — voir EcranFonctionAVenir.tsx). Un 404 générique
    // laisserait croire à un lien cassé.
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, { routeInitiale: '/atelier/ordres-reparation/nouveau' });
    expect(await screen.findByText("Cette fonctionnalité n'est pas encore disponible.")).toBeInTheDocument();
    expect(screen.queryByText("Cette page n'existe pas")).not.toBeInTheDocument();
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
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json({ donnees: [], curseurSuivant: null })),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/ordres-reparation' });
    expect(await screen.findByRole('heading', { name: 'Ordres de réparation' })).toBeInTheDocument();
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
      if (entree.name.startsWith('Ecran') && entree.name.endsWith('.tsx') && !entree.name.endsWith('.spec.tsx')) {
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
