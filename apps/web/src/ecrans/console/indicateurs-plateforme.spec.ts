import type { GarageConsole } from '@dfa/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFINITIONS_INDICATEURS_CONSOLE,
  IDS_INDICATEURS_CONSOLE,
  calculerIndicateursConsole,
  garageCorrespondAIndicateur,
} from './indicateurs-plateforme';

const GARAGE_CRITIQUE: GarageConsole = {
  tenantId: 't-1',
  slug: 'garage-martin',
  raisonSociale: 'Garage Martin SA',
  statut: 'actif',
  creeLe: '2025-01-01T00:00:00.000Z',
  niveau: 'critique',
  alertes: [
    {
      code: 'aucune_connexion_recente',
      niveau: 'attention',
      valeur: 10,
      depuisLe: '2026-07-29T00:00:00.000Z',
      domaine: null,
    },
    {
      code: 'module_silencieux',
      niveau: 'attention',
      valeur: 45,
      depuisLe: '2026-06-25T00:00:00.000Z',
      domaine: 'pneus',
    },
  ],
  sites: 1,
  utilisateursActifs: 3,
  sessionsActives: 1,
  comptesVerrouilles: 2,
  derniereConnexionReussieLe: '2026-07-29T08:00:00.000Z',
  connexionsEchouees24h: 0,
  dernierExportComptableLe: '2026-08-01T00:00:00.000Z',
  dernierExportComptableStatut: 'rejete',
  exportsComptablesRejetes30j: 1,
  relancesPlanifieesEnRetard: 3,
  relancesEnvoisEchoues7j: 1,
  ordresReparationActifs: 4,
  facturesEmisesImpayees: 2,
  modules: [],
};

const GARAGE_ATTENTION: GarageConsole = {
  tenantId: 't-2',
  slug: 'auto-center',
  raisonSociale: 'Auto Center SA',
  statut: 'suspendu',
  creeLe: '2025-02-01T00:00:00.000Z',
  niveau: 'attention',
  alertes: [
    {
      code: 'relances_envois_echoues',
      niveau: 'attention',
      valeur: 2,
      depuisLe: '2026-08-01T00:00:00.000Z',
      domaine: null,
    },
    {
      code: 'garage_suspendu',
      niveau: 'attention',
      valeur: null,
      depuisLe: '2026-08-02T00:00:00.000Z',
      domaine: null,
    },
  ],
  sites: 1,
  utilisateursActifs: 2,
  sessionsActives: 0,
  comptesVerrouilles: 0,
  derniereConnexionReussieLe: '2026-08-08T11:00:00.000Z',
  connexionsEchouees24h: 0,
  dernierExportComptableLe: '2026-08-05T00:00:00.000Z',
  dernierExportComptableStatut: 'accepte',
  exportsComptablesRejetes30j: 0,
  relancesPlanifieesEnRetard: 0,
  relancesEnvoisEchoues7j: 2,
  ordresReparationActifs: 1,
  facturesEmisesImpayees: 0,
  modules: [],
};

const GARAGE_OK: GarageConsole = {
  tenantId: 't-3',
  slug: 'garage-rossi',
  raisonSociale: 'Garage Rossi',
  statut: 'actif',
  creeLe: '2025-03-01T00:00:00.000Z',
  niveau: 'ok',
  alertes: [],
  sites: 1,
  utilisateursActifs: 1,
  sessionsActives: 0,
  comptesVerrouilles: 0,
  derniereConnexionReussieLe: null,
  connexionsEchouees24h: 0,
  dernierExportComptableLe: null,
  dernierExportComptableStatut: null,
  exportsComptablesRejetes30j: 0,
  relancesPlanifieesEnRetard: 0,
  relancesEnvoisEchoues7j: 0,
  ordresReparationActifs: 0,
  facturesEmisesImpayees: 0,
  modules: [],
};

const GARAGES = [GARAGE_CRITIQUE, GARAGE_ATTENTION, GARAGE_OK];

describe('DEFINITIONS_INDICATEURS_CONSOLE', () => {
  it('couvre exactement les 8 indicateurs mesurables par garage dans le contrat réel, un et un seul mapping par id', () => {
    expect(IDS_INDICATEURS_CONSOLE).toHaveLength(8);
    expect(DEFINITIONS_INDICATEURS_CONSOLE.map((d) => d.id)).toEqual(IDS_INDICATEURS_CONSOLE);
  });
});

describe('calculerIndicateursConsole', () => {
  it('somme les occurrences pour les compteurs bruts (comptes verrouillés, relances, modules silencieux)', () => {
    const valeurs = calculerIndicateursConsole(GARAGES);
    expect(valeurs.find((v) => v.id === 'comptesVerrouilles')?.total).toBe(2); // 2 + 0 + 0
    expect(valeurs.find((v) => v.id === 'relancesEnRetard')?.total).toBe(3); // 3 + 0 + 0
    expect(valeurs.find((v) => v.id === 'relancesEnvoisEchoues')?.total).toBe(3); // 1 + 2 + 0
    expect(valeurs.find((v) => v.id === 'moduleInactif')?.total).toBe(1); // une alerte module_silencieux
  });

  it('compte les garages concernés pour les indicateurs booléens', () => {
    const valeurs = calculerIndicateursConsole(GARAGES);
    expect(valeurs.find((v) => v.id === 'garagesCritiques')?.total).toBe(1);
    expect(valeurs.find((v) => v.id === 'garageSuspendu')?.total).toBe(1);
    expect(valeurs.find((v) => v.id === 'exportComptableEnEchec')?.total).toBe(1);
    expect(valeurs.find((v) => v.id === 'aucuneConnexion')?.total).toBe(1);
  });

  it('rend un total à zéro sur une liste vide, jamais une exception', () => {
    const valeurs = calculerIndicateursConsole([]);
    expect(valeurs.every((v) => v.total === 0)).toBe(true);
  });
});

describe('garageCorrespondAIndicateur', () => {
  it('retient un garage dont la mesure est strictement positive', () => {
    expect(garageCorrespondAIndicateur(GARAGE_CRITIQUE, 'exportComptableEnEchec')).toBe(true);
    expect(garageCorrespondAIndicateur(GARAGE_ATTENTION, 'garageSuspendu')).toBe(true);
  });

  it('écarte un garage dont la mesure est nulle', () => {
    expect(garageCorrespondAIndicateur(GARAGE_OK, 'comptesVerrouilles')).toBe(false);
    expect(garageCorrespondAIndicateur(GARAGE_ATTENTION, 'garagesCritiques')).toBe(false);
  });
});
