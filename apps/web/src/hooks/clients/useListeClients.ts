import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { ClientResume, PageCurseur, StatutClient, TypeClient } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { construireRequete, exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

/** Tris fermés de `GET /clients` (`TRIS_CLIENTS`, `@dfa/shared`) — dupliqués ici en littéraux
 *  plutôt qu'importés en valeur : seul le type compte côté écran (le `SelecteurTri` les reçoit
 *  déjà traduits), `TRIS_CLIENTS` reste la source de vérité runtime côté validation serveur. */
export type TriClients =
  | 'nom:asc'
  | 'nom:desc'
  | 'numeroClient:asc'
  | 'numeroClient:desc'
  | 'creeLe:desc'
  | 'dernierPassageLe:desc';

export interface FiltresListeClients {
  readonly q?: string;
  readonly type?: TypeClient;
  /** Défaut serveur `['actif', 'bloque']` si omis (RM-08 : un client bloqué reste visible au
   *  comptoir) — ne jamais envoyer `[]` pour « tous », omettre le paramètre à la place. */
  readonly statut?: readonly StatutClient[];
  readonly tri?: TriClients;
}

function cheminListeClients(filtres: FiltresListeClients, curseur: string | undefined): string {
  const params = construireRequete(
    {
      q: filtres.q,
      type: filtres.type,
      tri: filtres.tri,
      limite: LIMITE_PAR_PAGE,
      curseur,
    },
    { statut: filtres.statut },
  );
  return `/clients?${params.toString()}`;
}

/** `GET /clients` — pagination par curseur (`BoutonChargerPlus`, jamais de numéros de page).
 *
 *  `options.enabled` (facultatif, défaut `true` — comportement inchangé si omis) : à passer
 *  `false` par l'appelant tant qu'une recherche est vide, même garde que
 *  `useVehiculesStockDisponibles`/`useListeVehicules` — évite une requête pour toute la première
 *  page au montage d'un sélecteur dont l'UI masque de toute façon le résultat avant saisie. */
export function useListeClients(
  filtres: FiltresListeClients = {},
  options?: { readonly enabled?: boolean },
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ClientResume>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<ClientResume>({
    cle: clesQuery.clients.liste({
      q: filtres.q ?? '',
      type: filtres.type ?? '',
      statut: [...(filtres.statut ?? [])].sort().join(','),
      tri: filtres.tri ?? '',
    }),
    charger: async (curseur) => {
      const page = await requeteApi<PageCurseur<ClientResume>>(
        cheminListeClients(filtres, curseur),
        { method: 'GET' },
      );
      return exigerCorps(page, 'GET /clients');
    },
    actif: options?.enabled,
    reessayer,
  });
  return resultat;
}
