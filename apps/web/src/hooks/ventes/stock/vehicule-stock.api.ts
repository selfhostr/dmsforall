import type {
  EntreeMarquerVenduVehiculeStock,
  EntreeMiseEnStock,
  EntreeModificationVehiculeStock,
  EntreeReceptionnerVehiculeStock,
  EntreeRemettreDisponibleVehiculeStock,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseVehiculeStock,
  StatutCommercialVehicule,
  TypeVehiculeVente,
  VehiculeStockResume,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport des véhicules en stock (étape 4, VN/VO) — même convention que
 * `hooks/pieces/articles.api.ts` : les types consommés sont ceux de `@dfa/shared`
 * (`packages/shared/src/contrats/ventes/vehicule-stock.ts`), jamais `api/types.gen.ts`.
 *
 * ÉCART SIGNALÉ (même nature que celui documenté en tête de `hooks/pieces/articles.api.ts` et
 * `hooks/facturation/documents-vente.api.ts`) : `apps/web/src/api/types.gen.ts` ne contient AUCUNE
 * entrée pour `vehicule-stock`/`vehicules-stock` au moment où ce fichier est écrit (vérifié par
 * recherche textuelle — aucune régénération `pnpm api:openapi && pnpm web:types` exécutée ici, le
 * dépôt a des agents en vol en parallèle sur `apps/api/**` et `packages/shared/**`). Les quatre
 * routes existent et sont prouvées côté API
 * (`apps/api/src/ventes/vehicule-stock.controller.ts`, `vehicules-stock.controller.ts`) ; ce
 * fichier s'aligne directement sur le contrat partagé, qui est la source de vérité en attendant.
 *
 * `id` ci-dessous est TOUJOURS `vehicule.id` (décision structurante du contrat, voir l'en-tête de
 * `vehicule-stock.ts`) — jamais un second identifiant de type « stockId ».
 *
 * ÉTAG / `If-Match` : `apps/web/src/api/client.ts` documente un mécanisme `surReponse`/
 * `lireEnTetesReponse` pour lire l'en-tête `ETag` d'une réponse, mais AUCUN hook du dépôt ne
 * l'utilise réellement à ce jour (vérifié par recherche — seul `client.ts` lui-même y fait
 * référence). Ce module retient le chemin plus court, déjà documenté par le contrat lui-même
 * (`ordre-reparation.ts` : « `version`, entier monotone, rendu aussi en en-tête `ETag:
 * W/"<version>"` ») : `ReponseVehiculeStock.version` porte déjà la valeur nécessaire, donc
 * `construireIfMatch` la reconstruit directement plutôt que de dépendre d'un en-tête de réponse
 * jamais capturé nulle part ailleurs dans le code existant.
 */
export function construireIfMatch(version: number): string {
  return `W/"${version}"`;
}

/** Sous-ensemble de `FiltresVehiculesStock` (@dfa/shared) réellement exposé par l'écran liste —
 *  même patron que `FiltresListeArticles` (hooks/pieces/articles.api.ts). */
export interface FiltresListeVehiculesStock {
  readonly q?: string;
  readonly siteId?: string;
  readonly provenance?: readonly string[];
  readonly statutCommercial?: readonly StatutCommercialVehicule[];
  readonly typeVehicule?: TypeVehiculeVente;
  readonly tri: string;
}

export interface PageVehiculesStock {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametresListe(
  filtres: FiltresListeVehiculesStock,
  page: PageVehiculesStock,
): string {
  const parametres = new URLSearchParams();
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  for (const valeur of filtres.provenance ?? []) parametres.append('provenance', valeur);
  for (const valeur of filtres.statutCommercial ?? [])
    parametres.append('statutCommercial', valeur);
  if (filtres.typeVehicule) parametres.set('typeVehicule', filtres.typeVehicule);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /vehicules-stock` — collection paginée par curseur (projection `VehiculeStockResume`). */
export async function listerVehiculesStock(
  filtres: FiltresListeVehiculesStock,
  page: PageVehiculesStock,
): Promise<PageCurseur<VehiculeStockResume>> {
  const reponse = await requeteApi<PageCurseur<VehiculeStockResume>>(
    `/vehicules-stock?${construireParametresListe(filtres, page)}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `GET /vehicules/{vehiculeId}/stock` — fiche complète. 404 si le véhicule n'a jamais été mis
 *  en stock (propagé tel quel, `ErreurApi`, voir `@/api/erreurs.ts`). */
export async function recupererVehiculeStock(vehiculeId: string): Promise<ReponseVehiculeStock> {
  const stock = await requeteApi<ReponseVehiculeStock>(`/vehicules/${vehiculeId}/stock`, {
    method: 'GET',
  });
  if (!stock) {
    throw new Error('Réponse véhicule en stock inattendue : corps vide.');
  }
  return stock;
}

/** `POST /vehicules/{vehiculeId}/stock` — met un véhicule EXISTANT en stock. `Idempotency-Key`
 *  OBLIGATOIRE (RV-01) : un double-clic comptoir ne doit jamais produire deux fiches de coût
 *  pour le même véhicule (`409 VENTE_VEHICULE_STOCK_DEJA_EXISTANT` sinon). */
export async function mettreEnStock(
  vehiculeId: string,
  entree: EntreeMiseEnStock,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseVehiculeStock>>(
    `/vehicules/${vehiculeId}/stock`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /vehicules/{id}/stock.');
  }
  return reponse;
}

/** `PATCH /vehicules/{vehiculeId}/stock` — `If-Match` OBLIGATOIRE (voir `construireIfMatch`
 *  ci-dessus). Sert notamment à fixer/changer `prixVenteAfficheCentimes` (y compris `null ->
 *  valeur` = « mettre en vente ») : il n'existe PAS d'endpoint séparé pour ce geste. */
export async function modifierVehiculeStock(
  vehiculeId: string,
  entree: EntreeModificationVehiculeStock,
  ifMatch: string,
): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseVehiculeStock>>(
    `/vehicules/${vehiculeId}/stock`,
    {
      method: 'PATCH',
      body: JSON.stringify(entree),
      ifMatch,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH /vehicules/{id}/stock.');
  }
  return reponse;
}

/** `POST /vehicules/{vehiculeId}/stock/receptionner` — `en_commande -> disponible` (RV-09). */
export async function receptionnerVehiculeStock(
  vehiculeId: string,
  entree: EntreeReceptionnerVehiculeStock,
): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseVehiculeStock>>(
    `/vehicules/${vehiculeId}/stock/receptionner`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /vehicules/{id}/stock/receptionner.');
  }
  return reponse;
}

/** `POST /vehicules/{vehiculeId}/stock/remettre-disponible` — retour manuel `reserve ->
 *  disponible`, correction exceptionnelle (RV-10), motif obligatoire. */
export async function remettreDisponibleVehiculeStock(
  vehiculeId: string,
  entree: EntreeRemettreDisponibleVehiculeStock,
): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseVehiculeStock>>(
    `/vehicules/${vehiculeId}/stock/remettre-disponible`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /vehicules/{id}/stock/remettre-disponible.');
  }
  return reponse;
}

/** `POST /vehicules/{vehiculeId}/stock/marquer-vendu` — `reserve -> vendu`, correction
 *  exceptionnelle (même doctrine que `remettre-disponible`, motif obligatoire) : l'usage NORMAL
 *  est un effet de bord PROGRAMMATIQUE de l'émission de facture (`facturation/`), câblage hors
 *  périmètre de cet agent — voir `contrats/ventes/vehicule-stock.ts::schemaMarquerVenduVehiculeStock`.
 *
 * MANQUE BACKEND CONSTATÉ (voir le rapport de livraison) : au moment où ce fichier est écrit, le
 * contrat partagé et le service (`apps/api/src/ventes/service-vehicule-stock.ts::marquerVendu`)
 * existent, mais AUCUNE route `@Post('marquer-vendu')` n'était encore câblée dans
 * `vehicule-stock.controller.ts` (seuls les imports du schéma y étaient posés) — un agent API
 * distinct travaillait dessus EN PARALLÈLE. Cette fonction suppose la route déjà documentée par
 * le contrat (`POST /vehicules/{vehiculeId}/stock/marquer-vendu`, motif obligatoire, même forme
 * que `remettre-disponible`) ; à vérifier avant mise en service réelle si elle 404 encore. */
export async function marquerVenduVehiculeStock(
  vehiculeId: string,
  entree: EntreeMarquerVenduVehiculeStock,
): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseVehiculeStock>>(
    `/vehicules/${vehiculeId}/stock/marquer-vendu`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /vehicules/{id}/stock/marquer-vendu.');
  }
  return reponse;
}
