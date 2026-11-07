import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ClientResume, OrdreReparationResume, VehiculeResume } from '@dfa/shared';

import { server } from '@/test/msw/server';

import { listerOrdresReparation, listerResumesOrdresReparation } from './ordres-reparation.api';

const VEHICULE_MEIER: VehiculeResume = {
  id: 'veh-meier-1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Golf 8 2.0 TDI',
  vin: 'WVWZZZ1KZAP123456',
  premiereMiseEnCirculationLe: '2020-01-01',
  identificationIncomplete: false,
  emplacementLibre: null,
};

const CLIENT_MEIER: ClientResume = {
  id: 'cl-meier-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Meier SA',
  type: 'entreprise',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: 'Lausanne',
  nombreVehicules: 1,
  dernierPassageLe: null,
};

const OR_MEIER: OrdreReparationResume = {
  id: 'or-meier-1',
  numero: 'OR-000123',
  statut: 'ouvert',
  etatAffiche: 'ouvert',
  type: 'reparation',
  localisation: 'atelier',
  ouvertLe: '2026-07-01T08:00:00.000Z',
  restitutionPromiseLe: null,
  vehicule: VEHICULE_MEIER,
  client: CLIENT_MEIER,
  nombreLignes: 0,
};

const VEHICULE_ID_MEIER = VEHICULE_MEIER.id;

/**
 * Même défaut, même correctif que `hooks/vehicules/vehicules.api.spec.ts` (`detenteurId`), sur un
 * autre paramètre : `construireParametres` ne sérialisait pas `vehiculeId`, silencieusement rejeté
 * par l'index signature ouverte de `FiltresListeOrdresReparation` (aucune erreur TypeScript). Le
 * serveur (`apps/api/src/atelier/service-or.ts::lister`) applique réellement ce filtre par
 * `eq(ordreReparation.vehiculeId, filtres.vehiculeId)` : ce handler MSW simule fidèlement ce
 * comportement pour prouver que le paramètre part bien dans l'URL, pas seulement qu'il est accepté
 * par le type.
 */
function installerHandlerFiltreVehicule() {
  server.use(
    http.get('/api/v1/ordres-reparation', ({ request }) => {
      const url = new URL(request.url);
      const vehiculeId = url.searchParams.get('vehiculeId');
      const donnees = vehiculeId === VEHICULE_ID_MEIER ? [OR_MEIER] : [];
      return HttpResponse.json({ donnees, curseurSuivant: null, limite: 5 });
    }),
  );
}

describe('ordres-reparation.api — listerOrdresReparation — sérialisation de vehiculeId', () => {
  it('un vehiculeId existant part dans la requête et rend ses ordres de réparation', async () => {
    installerHandlerFiltreVehicule();

    const page = await listerOrdresReparation(
      { vehiculeId: VEHICULE_ID_MEIER, tri: 'ouvertLe:desc' },
      { limite: 5 },
    );

    expect(page.donnees).toEqual([OR_MEIER]);
  });

  it('un vehiculeId inexistant rend une liste VIDE — jamais tous les OR du tenant', async () => {
    installerHandlerFiltreVehicule();

    const page = await listerOrdresReparation(
      { vehiculeId: 'veh-inexistant', tri: 'ouvertLe:desc' },
      { limite: 5 },
    );

    expect(page.donnees).toEqual([]);
  });

  it('sans vehiculeId, le paramètre est absent de la requête (aucun filtre implicite)', async () => {
    let urlCapturee: URL | undefined;
    server.use(
      http.get('/api/v1/ordres-reparation', ({ request }) => {
        urlCapturee = new URL(request.url);
        return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 5 });
      }),
    );

    await listerOrdresReparation({ tri: 'ouvertLe:desc' }, { limite: 5 });

    expect(urlCapturee?.searchParams.has('vehiculeId')).toBe(false);
  });
});

describe('ordres-reparation.api — listerResumesOrdresReparation', () => {
  it('demande la forme résumé, sans perdre les filtres ni le curseur', async () => {
    let urlCapturee: URL | undefined;
    server.use(
      http.get('/api/v1/ordres-reparation', ({ request }) => {
        urlCapturee = new URL(request.url);
        return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 });
      }),
    );

    await listerResumesOrdresReparation(
      { q: 'meier', tri: 'ouvertLe:desc' },
      { limite: 50, curseur: 'abc' },
    );

    expect(urlCapturee?.searchParams.get('forme')).toBe('resume');
    expect(urlCapturee?.searchParams.get('q')).toBe('meier');
    expect(urlCapturee?.searchParams.get('curseur')).toBe('abc');
    expect(urlCapturee?.searchParams.get('limite')).toBe('50');
  });

  it('listerOrdresReparation ne demande PAS la forme résumé (autres écrans inchangés)', async () => {
    let urlCapturee: URL | undefined;
    server.use(
      http.get('/api/v1/ordres-reparation', ({ request }) => {
        urlCapturee = new URL(request.url);
        return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 5 });
      }),
    );

    await listerOrdresReparation({ tri: 'ouvertLe:desc' }, { limite: 5 });

    expect(urlCapturee?.searchParams.has('forme')).toBe(false);
  });
});
