import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import type {
  EntreeNoteClient,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseClientNote,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { donneesEcriture } from '@/api/enveloppe';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { chargeurSousCollectionClient, exigerCorps } from './support';

/** `GET /clients/{id}/notes` (RM-13) — onglet « Notes » de la fiche. Les notes de nature
 *  `alerte` sont ÉGALEMENT embarquées dans `GET /clients/{id}` (`ReponseClient.notesAlerte`, voir
 *  `useClient.ts`) pour le bandeau sticky : cette liste-ci reste la vue exhaustive (interne +
 *  alerte), pas la source du bandeau. */
export function useNotesClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientNote>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<ReponseClientNote>({
    cle: clesQuery.clients.notes(clientId ?? ''),
    charger: clientId ? chargeurSousCollectionClient(clientId, 'notes') : undefined,
    reessayer,
  });
  return resultat;
}

/**
 * `POST /clients/{id}/notes`. Invalide `clients.notes` (la liste de l'onglet) **et**
 * `clients.detail` (arbitrage main, L1-16) : une note `alerte` fraîchement créée change le
 * bandeau sticky de la fiche, qui lit `client.notesAlerte` sans appel réseau séparé — sans cette
 * seconde invalidation, une alerte ajoutée resterait invisible jusqu'au prochain montage complet
 * de l'écran.
 */
export function useCreerNoteClient(
  clientId: string,
): UseMutationResult<ReponseClientNote, unknown, EntreeNoteClient> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entree: EntreeNoteClient) => {
      const reponse = await requeteApi<ReponseAvecAvertissements<ReponseClientNote>>(
        `/clients/${clientId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify(entree),
        },
      );
      return donneesEcriture(exigerCorps(reponse, `POST /clients/${clientId}/notes`));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.clients.notes(clientId) });
      void queryClient.invalidateQueries({ queryKey: clesQuery.clients.detail(clientId) });
    },
  });
}
