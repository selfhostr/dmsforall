import type {
  OrdreReparationResumeListe,
  PageCurseur,
  ReponseOrdreReparation,
  StatutOrdreReparation,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * `GET /ordres-reparation?technicienId=&statut[]=&forme=resume` — « Mes OR du jour » (écran de
 * pointage du technicien). Transport DÉDIÉ, PAS une réutilisation de `hooks/atelier/ordres-reparation.api.ts` :
 * ce fichier — hors périmètre d'écriture de ce lot — expose `FiltresListeOrdresReparation` sans
 * `technicienId` ET avec `statut` en mono-sélection, alors que le contrat serveur
 * (`schemaFiltresOrdresReparation`, `contrats/atelier/ordre-reparation.ts`) accepte bel et bien les
 * deux : `statut` y est un TABLEAU. Étendre le hook partagé serait la solution la plus propre à
 * terme (signalé au rapport de livraison de ce module plutôt que fait ici, par respect du
 * périmètre disjoint) ; en attendant, ce petit transport local suffit à ce seul besoin, sans
 * dupliquer ni contourner le hook existant pour les écrans qui, eux, n'ont pas besoin de filtrer
 * par technicien.
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

/** `forme=resume` : `OrdreReparationResumeListe` (avec `nombreLignesAssignees`), ~10 % du poids du
 *  document complet. */
export async function listerMesOrdresAssignes(
  filtres: FiltresMesOrdresAssignes,
  limite: number,
): Promise<PageCurseur<OrdreReparationResumeListe>> {
  const page = await requeteApi<PageCurseur<OrdreReparationResumeListe>>(
    `/ordres-reparation?${construireParametres(filtres, limite)}&forme=resume`,
    { method: 'GET' },
  );
  return page ?? { donnees: [], curseurSuivant: null, limite };
}

/** Document complet (`lignes` incluses) : seulement pour la borne, où le compte de session n'est
 *  pas le technicien identifié par PIN, donc `nombreLignesAssignees` (calculé pour le compte de
 *  session) vaut 0 et ne peut pas servir. */
export async function listerMesOrdresAssignesComplets(
  filtres: FiltresMesOrdresAssignes,
  limite: number,
): Promise<PageCurseur<ReponseOrdreReparation>> {
  const page = await requeteApi<PageCurseur<ReponseOrdreReparation>>(
    `/ordres-reparation?${construireParametres(filtres, limite)}`,
    { method: 'GET' },
  );
  return page ?? { donnees: [], curseurSuivant: null, limite };
}
