import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { RapportImportReprise } from '@dfa/shared';

import { clesReprise } from './cles';
import { recupererRapport } from './reprise.api';

/** `GET /reprise/dossiers/{id}/rapport` — lisible dès que l'import a démarré (`statut !==
 *  'en_attente'`), pas seulement une fois terminé (montre ce qui a déjà été écrit même en cas
 *  d'échec en cours de route). Pas de sondage propre : `EtapeImport`/`RapportImport` la
 *  re-déclenchent via l'invalidation posée par `useRejouerImportReprise`, et l'écran d'import lui-
 *  même la relit à chaque `statut` reçu du sondage de `useImportReprise` (voir son appelant). */
export function useRapportReprise(
  dossierId: string | undefined,
  rapportDisponible: boolean,
): UseQueryResult<RapportImportReprise> {
  return useQuery({
    queryKey: clesReprise.rapport(dossierId ?? ''),
    queryFn: () => recupererRapport(dossierId as string),
    enabled: dossierId !== undefined && rapportDisponible,
  });
}
