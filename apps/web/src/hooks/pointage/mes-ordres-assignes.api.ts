import type { OrdreReparationResume, PageCurseur, StatutOrdreReparation } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * `GET /ordres-reparation?technicienId=&statut[]=` — « Mes OR du jour » (écran de pointage du
 * technicien). Transport DÉDIÉ, PAS une réutilisation de `hooks/atelier/ordres-reparation.api.ts` :
 * ce fichier — hors périmètre d'écriture de cet agent — expose `FiltresListeOrdresReparation` sans
 * `technicienId` ET avec `statut` en mono-sélection, alors que le contrat serveur
 * (`schemaFiltresOrdresReparation`, `contrats/atelier/ordre-reparation.ts`) accepte bel et bien les
 * deux : `technicienId` filtre déjà côté service (`service-or.ts`, vérifié), et `statut` y est un
 * TABLEAU. Étendre le hook partagé serait la solution la plus propre à terme (signalé au rapport
 * de livraison de ce module plutôt que fait ici, par respect du périmètre disjoint) ; en
 * attendant, ce petit transport local suffit à ce seul besoin, sans dupliquer ni contourner le
 * hook existant pour les écrans qui, eux, n'ont pas besoin de filtrer par technicien.
 */
export interface FiltresMesOrdresAssignes {
  readonly technicienId: string;
  readonly statut: readonly StatutOrdreReparation[];
  readonly tri: string;
}

function construireParametres(filtres: FiltresMesOrdresAssignes, limite: number): string {
  const parametres = new URLSearchParams();
  parametres.set('technicienId', filtres.technicienId);
  for (const valeur of filtres.statut) parametres.append('statut', valeur);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(limite));
  return parametres.toString();
}

export async function listerMesOrdresAssignes(
  filtres: FiltresMesOrdresAssignes,
  limite: number,
): Promise<PageCurseur<OrdreReparationResume>> {
  const page = await requeteApi<PageCurseur<OrdreReparationResume>>(
    `/ordres-reparation?${construireParametres(filtres, limite)}`,
    { method: 'GET' },
  );
  return page ?? { donnees: [], curseurSuivant: null, limite };
}
