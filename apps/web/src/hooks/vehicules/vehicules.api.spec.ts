import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { VehiculeResume } from '@dfa/shared';

import { server } from '@/test/msw/server';

import { listerVehicules } from './vehicules.api';

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

const DETENTEUR_MEIER = 'client-meier';

/**
 * Défaut réparé : `construireParametres` ne sérialisait pas `detenteurId`, silencieusement rejeté
 * par l'index signature ouverte de `FiltresListeVehicules` (aucune erreur TypeScript). Le serveur
 * (`service-vehicule.ts::construireConditionsFiltresVehicules`) applique réellement ce filtre par
 * `exists (... d.client_id = ...)` : ce handler MSW simule fidèlement ce comportement pour prouver
 * que le paramètre part bien dans l'URL, pas seulement qu'il est accepté par le type.
 */
function installerHandlerFiltreDetenteur() {
  server.use(
    http.get('/api/v1/vehicules', ({ request }) => {
      const url = new URL(request.url);
      const detenteurId = url.searchParams.get('detenteurId');
      const donnees = detenteurId === DETENTEUR_MEIER ? [VEHICULE_MEIER] : [];
      return HttpResponse.json({ donnees, curseurSuivant: null, limite: 5 });
    }),
  );
}

describe('vehicules.api — listerVehicules — sérialisation de detenteurId', () => {
  it('un detenteurId existant part dans la requête et rend ses véhicules', async () => {
    installerHandlerFiltreDetenteur();

    const page = await listerVehicules(
      { detenteurId: DETENTEUR_MEIER, tri: 'plaque:asc' },
      { limite: 5 },
    );

    expect(page.donnees).toEqual([VEHICULE_MEIER]);
  });

  it('un detenteurId inexistant rend une liste VIDE — jamais tous les véhicules du tenant', async () => {
    installerHandlerFiltreDetenteur();

    const page = await listerVehicules(
      { detenteurId: 'client-inexistant', tri: 'plaque:asc' },
      { limite: 5 },
    );

    expect(page.donnees).toEqual([]);
  });

  it('sans detenteurId, le paramètre est absent de la requête (aucun filtre implicite)', async () => {
    let urlCapturee: URL | undefined;
    server.use(
      http.get('/api/v1/vehicules', ({ request }) => {
        urlCapturee = new URL(request.url);
        return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 5 });
      }),
    );

    await listerVehicules({ tri: 'plaque:asc' }, { limite: 5 });

    expect(urlCapturee?.searchParams.has('detenteurId')).toBe(false);
  });
});
