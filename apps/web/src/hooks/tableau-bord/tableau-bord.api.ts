import type {
  FiltreTableauBord,
  ReponseActiviteTableauBord,
  ReponseFinancierTableauBord,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/** Couche transport du tableau de bord — mêmes remarques que `hooks/pieces/stock.api.ts` :
 *  types importés depuis `@dfa/shared` (`packages/shared/src/contrats/tableau-bord/`), jamais
 *  depuis `api/types.gen.ts` (pas encore régénéré pour ce domaine, livré après la dernière
 *  exécution de `pnpm api:openapi`). */

function construireParametresFiltre(filtre: FiltreTableauBord): string {
  const parametres = new URLSearchParams();
  if (filtre.siteId) parametres.set('siteId', filtre.siteId);
  if (filtre.du) parametres.set('du', filtre.du);
  if (filtre.au) parametres.set('au', filtre.au);
  const chaine = parametres.toString();
  return chaine === '' ? '' : `?${chaine}`;
}

/** `GET /tableau-bord/activite` — ouvert à tout rôle de PERSONNE sauf `poste_atelier` (voir
 *  `ecrans/tableau-bord/droits.ts`). `du`/`au`/`siteId` absents -> le serveur retient le mois
 *  civil UTC courant et renvoie la période effectivement appliquée en écho (`periode`). */
export async function recupererActiviteTableauBord(
  filtre: FiltreTableauBord,
): Promise<ReponseActiviteTableauBord> {
  const reponse = await requeteApi<ReponseActiviteTableauBord>(
    `/tableau-bord/activite${construireParametresFiltre(filtre)}`,
    { method: 'GET' },
  );
  if (!reponse) {
    throw new Error('Réponse activité tableau de bord inattendue : corps vide.');
  }
  return reponse;
}

/** `GET /tableau-bord/financier` — RÉSERVÉ `direction`/`comptable` (RF-115, `admin` explicitement
 *  exclu). Ne JAMAIS appeler cette fonction pour un rôle non autorisé : voir `enabled` dans
 *  `useFinancierTableauBord`, défense en profondeur en plus du masquage côté écran. */
export async function recupererFinancierTableauBord(
  filtre: FiltreTableauBord,
): Promise<ReponseFinancierTableauBord> {
  const reponse = await requeteApi<ReponseFinancierTableauBord>(
    `/tableau-bord/financier${construireParametresFiltre(filtre)}`,
    { method: 'GET' },
  );
  if (!reponse) {
    throw new Error('Réponse financier tableau de bord inattendue : corps vide.');
  }
  return reponse;
}
