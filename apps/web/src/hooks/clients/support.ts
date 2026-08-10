/**
 * Petits utilitaires internes aux hooks du domaine clients — jamais exportés hors de
 * `hooks/clients/**`, jamais de logique métier ici (elle vit dans chaque hook).
 */

import type { PageCurseur } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import type { ChargeurPage } from '@/hooks/pagination-curseur';

// La politique de réessai (`estRefusStable`/`useDoitReessayer`) vivait ici avant d'être déplacée
// vers `hooks/pagination-curseur.ts`, à côté du type `PolitiqueReessai` qu'elle implémente — son
// vrai domicile, puisque c'est là que ce type est défini. Importer `useDoitReessayer` depuis
// `@/hooks/pagination-curseur` directement plutôt que de la redistribuer d'ici : ce fichier ne
// porte plus que les utilitaires SPÉCIFIQUES au domaine `clients/**`.

/** Un `GET` de ressource unitaire (pas une collection) ne renvoie jamais un corps vide côté
 *  contrat (`contrats-api-etape-1.md` §7) : seuls un `204` (aucune écriture de ce domaine n'en
 *  produit) ou une erreur réseau/HTTP (déjà levée par `requeteApi` avant d'arriver ici) peuvent
 *  produire `undefined`. Un `undefined` qui arrive quand même est donc un défaut serveur, pas un
 *  état à absorber silencieusement côté écran — d'où l'échec explicite plutôt qu'un `?? valeur
 *  par défaut` qui masquerait la régression. */
export function exigerCorps<T>(valeur: T | undefined, contexte: string): T {
  if (valeur === undefined) {
    throw new Error(`Réponse vide inattendue : ${contexte}.`);
  }
  return valeur;
}

/** Construit une querystring en omettant les valeurs absentes/vides — évite à chaque hook de
 *  domaine de réécrire la même garde `if (valeur) params.set(...)`. Un tableau se RÉPÈTE
 *  (`params.append`), jamais une liste séparée par virgules (contrats-api-etape-1.md §6.2). */
export function construireRequete(
  base: Record<string, string | number | boolean | undefined>,
  multivalues: Record<string, readonly string[] | undefined> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(base)) {
    if (valeur === undefined || valeur === '') continue;
    params.set(cle, String(valeur));
  }
  for (const [cle, valeurs] of Object.entries(multivalues)) {
    for (const valeur of valeurs ?? []) {
      params.append(cle, valeur);
    }
  }
  return params;
}

/** Toutes les sous-collections de la fiche client partagent la même taille de page. */
const LIMITE_SOUS_COLLECTION = 50;

/**
 * Chargeur d'une page d'une sous-collection de la fiche client
 * (`GET /clients/{id}/<segment>`) — l'unique forme d'appel des onglets « Contacts », « Adresses »,
 * « Conditions », « Consentements », « Notes », « Véhicules » et « Derniers passages ».
 *
 * `clientId` est un `string` NON optionnel, délibérément : c'est ce qui oblige l'appelant à
 * résoudre le client AVANT de construire son chargeur (voir `useListeCurseur`, où un chargeur
 * absent désactive la requête). Les versions précédentes interpolaient un `clientId` possiblement
 * `undefined` dans l'URL — `/clients/undefined/contacts` n'était évité que par une garde `enabled`
 * posée à la main, indépendante, dans chacun des sept hooks.
 *
 * L'ordre des paramètres est celui d'origine — `base` d'abord, puis `limite`, puis `curseur`, puis
 * les valeurs répétées : une querystring réordonnée resterait sémantiquement correcte côté serveur
 * mais changerait l'URL exacte de chaque requête, ce qu'aucun test ne verrait.
 */
export function chargeurSousCollectionClient<T>(
  clientId: string,
  segment: string,
  base: Record<string, string | number | boolean | undefined> = {},
  multivalues: Record<string, readonly string[] | undefined> = {},
): ChargeurPage<T> {
  return async (curseur) => {
    const params = construireRequete(
      { ...base, limite: LIMITE_SOUS_COLLECTION, curseur },
      multivalues,
    );
    const chemin = `/clients/${clientId}/${segment}`;
    const page = await requeteApi<PageCurseur<T>>(`${chemin}?${params.toString()}`, {
      method: 'GET',
    });
    return exigerCorps(page, `GET ${chemin}`);
  };
}
