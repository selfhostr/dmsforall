import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeMarquerVenduVehiculeStock,
  EntreeMiseEnStock,
  EntreeModificationVehiculeStock,
  EntreeReceptionnerVehiculeStock,
  EntreeRemettreDisponibleVehiculeStock,
  ReponseAvecAvertissements,
  ReponseVehiculeStock,
} from '@dfa/shared';

import { clesVentesStock } from './cles';
import {
  marquerVenduVehiculeStock,
  mettreEnStock,
  modifierVehiculeStock,
  receptionnerVehiculeStock,
  remettreDisponibleVehiculeStock,
} from './vehicule-stock.api';

type Reponse = ReponseAvecAvertissements<ReponseVehiculeStock>;

/** Toute mutation réussie pose directement la fiche COMPLÈTE dans le cache (jamais de relecture)
 *  et invalide la liste par PRÉFIXE (couvre toute variante de filtre/tri déjà en cache) — même
 *  patron que `useActionArticle` (hooks/pieces/useTransitionsArticle.ts). */
function poserEtInvalider(
  queryClient: ReturnType<typeof useQueryClient>,
  vehiculeId: string,
  reponse: Reponse,
): void {
  queryClient.setQueryData(clesVentesStock.detail(vehiculeId), reponse.donnees);
  void queryClient.invalidateQueries({ queryKey: ['ventes', 'stock', 'liste'] });
}

interface VariablesMiseEnStock {
  readonly entree: EntreeMiseEnStock;
  /** Une clé par SOUMISSION du formulaire d'entrée en stock — même règle que
   *  `useCleIdempotence` (§5 étape 1) : un rejeu (double-clic, retry réseau) ne doit jamais
   *  produire deux fiches de coût pour le même véhicule. */
  readonly idempotencyKey: string;
}

/** `POST /vehicules/{vehiculeId}/stock` (RV-01). `vehiculeId` est fixé à l'appel du hook — le
 *  véhicule ciblé est choisi AVANT la soumission (écran « entrée en stock », recherche parmi les
 *  véhicules existants), jamais une variable de mutation. */
export function useMettreEnStock(
  vehiculeId: string,
): UseMutationResult<Reponse, unknown, VariablesMiseEnStock> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) => mettreEnStock(vehiculeId, entree, idempotencyKey),
    onSuccess: (reponse) => poserEtInvalider(queryClient, vehiculeId, reponse),
  });
}

interface VariablesModification {
  readonly entree: EntreeModificationVehiculeStock;
  /** `W/"<version>"` — voir `construireIfMatch` (vehicule-stock.api.ts), à calculer par l'appelant
   *  depuis `ReponseVehiculeStock.version` déjà en cache (dernière lecture). */
  readonly ifMatch: string;
}

/** `PATCH /vehicules/{vehiculeId}/stock` — seul endpoint qui fixe/change
 *  `prixVenteAfficheCentimes` (y compris `null -> valeur` = « mettre en vente ») : il n'existe
 *  PAS d'action « mettre en vente » séparée côté API. */
export function useModifierVehiculeStock(
  vehiculeId: string,
): UseMutationResult<Reponse, unknown, VariablesModification> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, ifMatch }) => modifierVehiculeStock(vehiculeId, entree, ifMatch),
    onSuccess: (reponse) => poserEtInvalider(queryClient, vehiculeId, reponse),
  });
}

/** `POST /vehicules/{vehiculeId}/stock/receptionner` — `en_commande -> disponible` (RV-09). */
export function useReceptionnerVehiculeStock(
  vehiculeId: string,
): UseMutationResult<Reponse, unknown, EntreeReceptionnerVehiculeStock> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree) => receptionnerVehiculeStock(vehiculeId, entree),
    onSuccess: (reponse) => poserEtInvalider(queryClient, vehiculeId, reponse),
  });
}

/** `POST /vehicules/{vehiculeId}/stock/remettre-disponible` — correction exceptionnelle
 *  (RV-10), motif obligatoire. */
export function useRemettreDisponibleVehiculeStock(
  vehiculeId: string,
): UseMutationResult<Reponse, unknown, EntreeRemettreDisponibleVehiculeStock> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree) => remettreDisponibleVehiculeStock(vehiculeId, entree),
    onSuccess: (reponse) => poserEtInvalider(queryClient, vehiculeId, reponse),
  });
}

/** `POST /vehicules/{vehiculeId}/stock/marquer-vendu` — correction exceptionnelle
 *  (`reserve -> vendu`), motif obligatoire, même droit que `remettre-disponible`
 *  (`ventes.vehicule_stock.corriger`). Voir l'ÉCART SIGNALÉ en tête de `vehicule-stock.api.ts` :
 *  la route serveur était en cours de câblage en parallèle au moment de l'écriture. */
export function useMarquerVenduVehiculeStock(
  vehiculeId: string,
): UseMutationResult<Reponse, unknown, EntreeMarquerVenduVehiculeStock> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree) => marquerVenduVehiculeStock(vehiculeId, entree),
    onSuccess: (reponse) => poserEtInvalider(queryClient, vehiculeId, reponse),
  });
}
