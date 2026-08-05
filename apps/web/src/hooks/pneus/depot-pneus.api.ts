import type {
  EntreeChangementSaisonDepotPneus,
  EntreeCreationDepotPneus,
  EntreeSortieDepotPneus,
  PageCurseur,
  ReponseDepotPneus,
  SaisonPneu,
  StatutDepotPneus,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du hangar à pneus — même convention que `hooks/pieces/articles.api.ts` : les
 * types consommés sont ceux de `@dfa/shared` (`packages/shared/src/contrats/pneus/`), jamais
 * `api/types.gen.ts`.
 *
 * ÉCART SIGNALÉ (même nature que celui documenté en tête de `hooks/pieces/articles.api.ts`) :
 * `apps/web/src/api/types.gen.ts` n'a PAS été régénéré depuis l'OpenAPI pour inclure le module
 * `pneus` au moment d'écrire cet écran — vérifié le 05.08.2026, aucune occurrence de
 * `hangar-pneus`/`depots-pneus` dans ce fichier généré. Les SIX routes existent et sont prouvées
 * côté API (`apps/api/src/pneus/depot-pneus.controller.ts`, trois contrôleurs) ; ce fichier
 * s'aligne sur leurs DTO, qui implémentent eux-mêmes les types `@dfa/shared` importés ci-dessus
 * (voir `apps/api/src/pneus/dto/depot-pneus.dto.ts`). À réconcilier avec `types.gen.ts` à la
 * prochaine régénération planifiée (`pnpm api:openapi && pnpm web:types`) — non exécutée ici,
 * plusieurs agents ont des chantiers `apps/api/**` en vol en parallèle.
 */

export interface PageDepotsPneus {
  readonly limite: number;
  readonly curseur?: string;
}

/** Filtres réellement exposés par l'écran hangar (sous-ensemble de `FiltresHangarPneus`,
 *  @dfa/shared). `statut` par défaut de l'écran (RPP-04 : ce qui est PHYSIQUEMENT dans le hangar,
 *  `en_depot` + `a_relancer` — `monte` est sur le véhicule, `sorti` n'est plus là) reste un choix
 *  de l'écran, pas de ce fichier de transport. */
export interface FiltresHangar {
  readonly statut?: readonly StatutDepotPneus[];
  readonly saison?: SaisonPneu;
  readonly tri: string;
  readonly [cle: string]: string | readonly string[] | undefined;
}

function ajouterListe(
  parametres: URLSearchParams,
  cle: string,
  valeurs: readonly string[] | undefined,
) {
  if (!valeurs) return;
  for (const valeur of valeurs) parametres.append(cle, valeur);
}

/** `GET /sites/{siteId}/hangar-pneus` (spec §5, §6) — vue hangar, pagination par curseur. */
export async function recupererHangarPneus(
  siteId: string,
  filtres: FiltresHangar,
  page: PageDepotsPneus,
): Promise<PageCurseur<ReponseDepotPneus>> {
  const parametres = new URLSearchParams();
  ajouterListe(parametres, 'statut', filtres.statut);
  if (filtres.saison) parametres.set('saison', filtres.saison);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);

  const reponse = await requeteApi<PageCurseur<ReponseDepotPneus>>(
    `/sites/${siteId}/hangar-pneus?${parametres.toString()}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

export interface FiltresDepotsVehicule {
  readonly statut?: readonly StatutDepotPneus[];
  readonly tri: string;
}

/** `GET /vehicules/{id}/depots-pneus` — historique COMPLET (tous statuts) d'un véhicule. */
export async function listerDepotsPneusVehicule(
  vehiculeId: string,
  filtres: FiltresDepotsVehicule,
  page: PageDepotsPneus,
): Promise<PageCurseur<ReponseDepotPneus>> {
  const parametres = new URLSearchParams();
  ajouterListe(parametres, 'statut', filtres.statut);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);

  const reponse = await requeteApi<PageCurseur<ReponseDepotPneus>>(
    `/vehicules/${vehiculeId}/depots-pneus?${parametres.toString()}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `POST /vehicules/{id}/depots-pneus` — `Idempotency-Key` OBLIGATOIRE (création sensible, garde
 *  physique d'un bien du client, voir le contrat). */
export async function creerDepotPneus(
  vehiculeId: string,
  entree: EntreeCreationDepotPneus,
  idempotencyKey: string,
): Promise<ReponseDepotPneus> {
  const reponse = await requeteApi<ReponseDepotPneus>(`/vehicules/${vehiculeId}/depots-pneus`, {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /vehicules/{id}/depots-pneus.');
  }
  return reponse;
}

/** `POST /depots-pneus/{id}/changer-saison` (RPP-03). Pas d'`Idempotency-Key` — transition gardée
 *  par l'état de départ (voir le contrat, `schemaChangementSaisonDepotPneus`). */
export async function changerSaisonDepotPneus(
  depotId: string,
  entree: EntreeChangementSaisonDepotPneus,
): Promise<ReponseDepotPneus> {
  const reponse = await requeteApi<ReponseDepotPneus>(`/depots-pneus/${depotId}/changer-saison`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /depots-pneus/{id}/changer-saison.');
  }
  return reponse;
}

/** `POST /depots-pneus/{id}/sortir` (RPP-05) — statut TERMINAL, motif obligatoire. */
export async function sortirDepotPneus(
  depotId: string,
  entree: EntreeSortieDepotPneus,
): Promise<ReponseDepotPneus> {
  const reponse = await requeteApi<ReponseDepotPneus>(`/depots-pneus/${depotId}/sortir`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /depots-pneus/{id}/sortir.');
  }
  return reponse;
}

export interface FiltresARelancer {
  readonly siteId?: string;
  readonly tri: string;
}

/** `GET /depots-pneus/a-relancer` (RPP-04) — jeux oubliés, site ou tenant entier. */
export async function listerDepotsPneusARelancer(
  filtres: FiltresARelancer,
  page: PageDepotsPneus,
): Promise<PageCurseur<ReponseDepotPneus>> {
  const parametres = new URLSearchParams();
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);

  const reponse = await requeteApi<PageCurseur<ReponseDepotPneus>>(
    `/depots-pneus/a-relancer?${parametres.toString()}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}
