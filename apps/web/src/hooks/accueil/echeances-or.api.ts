import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport DÉDIÉE au widget calendrier de l'écran « Aujourd'hui » — un fichier séparé de
 * `hooks/atelier/ordres-reparation.api.ts` plutôt qu'une extension de celui-ci : ce dernier est
 * dans le périmètre du domaine atelier (autre chantier en vol au moment d'écrire ce widget), et sa
 * `FiltresListeOrdresReparation` ne sérialise pas les bornes `restitutionPromiseDu`/`Au` (§6.2 de
 * `packages/shared/src/contrats/atelier/ordre-reparation.ts`, `schemaFiltresOrdresReparation`).
 * Même endpoint (`GET /ordres-reparation`), mêmes types partagés — seule la sérialisation des
 * filtres diffère, pour ne toucher aucun fichier du domaine atelier.
 */
export interface FiltresEcheancesOr {
  /** Bornes INCLUSES, format `aaaa-mm-jj` — même convention que le reste de l'API (§6.2).
   *  `restitutionPromiseDu` OPTIONNELLE (issue #112, `CarteOrEnRetard.tsx`) : une borne basse
   *  absente interroge « jusqu'à `restitutionPromiseAu` », pas seulement CE jour-là — nécessaire
   *  pour une vue « en retard » qui ne doit jamais se limiter aux promesses d'aujourd'hui. */
  readonly restitutionPromiseDu?: string;
  readonly restitutionPromiseAu: string;
  readonly siteId?: string;
}

const LIMITE = 100;

function construireParametres(filtres: FiltresEcheancesOr): string {
  const parametres = new URLSearchParams();
  if (filtres.restitutionPromiseDu) {
    parametres.set('restitutionPromiseDu', filtres.restitutionPromiseDu);
  }
  parametres.set('restitutionPromiseAu', filtres.restitutionPromiseAu);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  parametres.set('tri', 'restitutionPromiseLe:asc');
  parametres.set('limite', String(LIMITE));
  return parametres.toString();
}

/** `GET /ordres-reparation` filtré sur une fenêtre de dates de restitution promise — les seules
 *  dates aujourd'hui portées par la donnée qui ressemblent à un engagement pris avec un client
 *  (aucune table `rendez_vous` n'existe encore, voir `CalendrierEcheances.tsx`). Une seule page :
 *  ce widget est un aperçu de semaine sur l'écran d'accueil, pas une liste paginée. */
export async function listerEcheancesOr(
  filtres: FiltresEcheancesOr,
): Promise<PageCurseur<OrdreReparationResume>> {
  const page = await requeteApi<PageCurseur<OrdreReparationResume>>(
    `/ordres-reparation?${construireParametres(filtres)}`,
    { method: 'GET' },
  );
  return page ?? { donnees: [], curseurSuivant: null, limite: LIMITE };
}
