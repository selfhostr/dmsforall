import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, it } from 'vitest';

import type { ClientResume, OrdreReparationResume, VehiculeResume } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranListeOrdresReparation } from '@/ecrans/atelier/EcranListeOrdresReparation';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';

/**
 * Mesure 2/4 — famille « liste dense », lue au comptoir/bureau : tableau de plusieurs dizaines de
 * lignes, badges de statut, colonnes tassées. Fixtures et patron de rendu repris de
 * `EcranListeOrdresReparation.spec.tsx` (déjà éprouvé pour cet écran).
 */
const VEHICULE: VehiculeResume = {
  id: 'v1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
  emplacementLibre: null,
};

const CLIENT: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: 'Lausanne',
  nombreVehicules: 1,
  dernierPassageLe: null,
};

function construireResume(overrides: Partial<OrdreReparationResume> = {}): OrdreReparationResume {
  return {
    id: 'or-1',
    numero: 'OR-000123',
    statut: 'ouvert',
    etatAffiche: 'ouvert',
    type: 'reparation',
    localisation: 'atelier',
    ouvertLe: '2026-07-01T08:00:00.000Z',
    restitutionPromiseLe: null,
    vehicule: VEHICULE,
    client: CLIENT,
    nombreLignes: 0,
    ...overrides,
  };
}

// Une ligne par statut représenté à l'écran (badges `BadgeStatutOr`, couleur + forme + mot) : le
// jeu de règles WCAG AA ne juge pas la couleur (voir `harnais.ts`), mais juge la structure du
// tableau, l'ordre de lecture et le nom accessible de chaque badge/lien — la variété de statuts
// maximise les chances de heurter un badge mal étiqueté si un seul type existait.
const LIGNES = [
  construireResume({ id: 'or-1', numero: 'OR-000123', statut: 'ouvert', etatAffiche: 'ouvert' }),
  construireResume({
    id: 'or-2',
    numero: 'OR-000124',
    statut: 'en_cours',
    etatAffiche: 'en_cours',
  }),
  construireResume({
    id: 'or-3',
    numero: 'OR-000125',
    statut: 'facture',
    etatAffiche: 'facture',
  }),
  construireResume({
    id: 'or-4',
    numero: 'OR-000126',
    statut: 'annule',
    etatAffiche: 'annule',
  }),
];

function rendreEcran() {
  server.use(
    http.get('/api/v1/ordres-reparation', () =>
      HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
    ),
  );
  return renduAvecRoutes(
    [
      { path: '/ordres-reparation', element: <EcranListeOrdresReparation /> },
      { path: '/ordres-reparation/:id', element: <div>PAGE_FICHE_OR</div> },
    ],
    { routeInitiale: '/ordres-reparation' },
  );
}

describe('Accessibilité WCAG 2.1 AA — liste des ordres de réparation', () => {
  it('tableau rempli, quatre statuts distincts', async () => {
    rendreEcran();
    await screen.findByText('OR-000123');

    // `document.body`, pas le `container` de `render()` : cet écran pose un filtre `<Select>`
    // Radix (fermé par défaut ici, donc sans effet sur ce cas précis) — convention uniforme avec
    // les autres `mesures.*.spec.tsx` pour ne pas dépendre de l'état ouvert/fermé d'un composant
    // portalé. Voir l'avertissement détaillé dans `harnais.ts`.
    const audit = await auditerAccessibiliteEcran(
      'Liste des ordres de réparation — tableau rempli',
      document.body,
    );

    exigerAucuneViolation(audit);
  });
});
