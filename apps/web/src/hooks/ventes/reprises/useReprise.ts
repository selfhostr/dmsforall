import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseReprise } from '@dfa/shared';

import { clesVentesReprises } from './cles';
import { recupererReprise } from './reprise.api';

/**
 * `GET /dossiers-vente/{id}/reprise` — requête SECONDAIRE non bloquante (§8 du design : même
 * patron que `useContexteAtelier` vs `useKilometragesVehicule` sur `EcranFicheVehicule`, primaire
 * bloquant vs secondaire par section).
 *
 * `possedeReprise` doit venir de `dossier.reprise !== null` (déjà connu de l'appelant via la
 * fiche dossier, hors périmètre de ce module) : la reprise est une composante OPTIONNELLE du
 * dossier (RV-25), et ce hook ne doit JAMAIS interroger `GET .../reprise` sur un dossier qui n'en
 * a pas — ce 404 attendu n'aurait aucune information à apporter, seulement du bruit réseau.
 */
export function useReprise(
  dossierVenteId: string | undefined,
  possedeReprise: boolean,
): UseQueryResult<ReponseReprise> {
  return useQuery({
    queryKey: clesVentesReprises.detail(dossierVenteId ?? ''),
    queryFn: () => recupererReprise(dossierVenteId as string),
    enabled: dossierVenteId !== undefined && possedeReprise,
  });
}
