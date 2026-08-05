import type { FiltresSuiviVente, LigneSuiviVente, PageCurseur } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du suivi financement/garantie (`ventes/suivi-vente.controller.ts`,
 * `GET /ventes/suivi`) — même convention que `hooks/ventes/dossiers/dossiers-vente.api.ts` :
 * types consommés depuis `@dfa/shared` (`packages/shared/src/contrats/ventes/suivi.ts`), jamais
 * `api/types.gen.ts`.
 *
 * ÉCART SIGNALÉ (même nature que celui documenté en tête de `hooks/ventes/dossiers/dossiers-vente.api.ts`) :
 * `apps/web/src/api/types.gen.ts` n'a pas encore été régénéré depuis l'OpenAPI pour inclure cette
 * route — vérifiée en exécution réelle contre l'API locale (`GET /api/v1/ventes/suivi`, 200 avec
 * un corps conforme à `PageCurseur<LigneSuiviVente>`) avant d'écrire ce fichier. À réconcilier
 * avec `types.gen.ts` à la prochaine régénération planifiée.
 */

function construireParametresListe(
  filtres: FiltresSuiviVente,
  curseur: string | undefined,
): string {
  const parametres = new URLSearchParams();
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.dansJours !== undefined) parametres.set('dansJours', String(filtres.dansJours));
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(filtres.limite));
  if (curseur) parametres.set('curseur', curseur);
  return parametres.toString();
}

/** `GET /ventes/suivi` — pagination par curseur, triée par défaut sur l'échéance la plus proche
 *  (les échéances dépassées remontent en premier, voir l'en-tête du contrat). */
export async function listerSuiviVente(
  filtres: FiltresSuiviVente,
  curseur: string | undefined,
): Promise<PageCurseur<LigneSuiviVente>> {
  const reponse = await requeteApi<PageCurseur<LigneSuiviVente>>(
    `/ventes/suivi?${construireParametresListe(filtres, curseur)}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: filtres.limite };
}
