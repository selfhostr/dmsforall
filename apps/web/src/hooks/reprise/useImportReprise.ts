import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { EntreeRejouerImportReprise, ReponseImportReprise } from '@dfa/shared';

import { clesReprise } from './cles';
import { recupererImport, rejouerImport } from './reprise.api';

const STATUTS_IMPORT_ACTIFS = ['en_attente', 'en_cours'] as const;

/** `false` = sondage arrêté (import absent, ou dans un des trois statuts terminaux
 *  `termine`/`echoue`/`annule`). Actif tant que l'import attend de démarrer ou tourne. */
export function calculerIntervalleSondageImport(
  imp: ReponseImportReprise | undefined,
): number | false {
  if (!imp) return false;
  return (STATUTS_IMPORT_ACTIFS as readonly string[]).includes(imp.statut) ? 3_000 : false;
}

/** `GET /reprise/dossiers/{id}/import` — activée uniquement si `dossier.importId !== null`. */
export function useImportReprise(
  dossierId: string | undefined,
  importDisponible: boolean,
): UseQueryResult<ReponseImportReprise> {
  return useQuery({
    queryKey: clesReprise.import(dossierId ?? ''),
    queryFn: () => recupererImport(dossierId as string),
    enabled: dossierId !== undefined && importDisponible,
    refetchInterval: (requete) => calculerIntervalleSondageImport(requete.state.data),
  });
}

/** `POST /reprise/dossiers/{id}/import/rejouer` — reprise après `import_echoue`, sans jamais
 *  dupliquer une ligne déjà écrite (`AncrageOrigineReprise`, contrainte d'unicité serveur).
 *  Invalide l'import (nouvelle tentative, `tentative` incrémenté) ET le rapport (nouveaux
 *  compteurs). */
export function useRejouerImportReprise(dossierId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree?: EntreeRejouerImportReprise) => rejouerImport(dossierId as string, entree),
    onSuccess: (imp) => {
      if (dossierId) {
        queryClient.setQueryData(clesReprise.import(dossierId), imp);
        void queryClient.invalidateQueries({ queryKey: clesReprise.rapport(dossierId) });
      }
    },
  });
}
