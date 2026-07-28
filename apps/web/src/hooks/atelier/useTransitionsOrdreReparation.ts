import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeActionAnnuler,
  EntreeActionReceptionner,
  EntreeActionReprendreTravaux,
  EntreeActionRefuserControle,
  EntreeActionRestituer,
  EntreeActionRouvrir,
  EntreeActionTerminer,
  EntreeActionValiderControle,
  ReponseAvecAvertissements,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import {
  annulerOrdreReparation,
  cloturerOrdreReparation,
  demarrerOrdreReparation,
  passerEnControleOrdreReparation,
  receptionnerOrdreReparation,
  refuserControleOrdreReparation,
  reprendreTravauxOrdreReparation,
  restituerOrdreReparation,
  rouvrirOrdreReparation,
  terminerOrdreReparation,
  validerControleOrdreReparation,
  type EntreeActionSansCorps,
} from './ordres-reparation.api';

/**
 * Une transition par action nommée (§7.7, `ACTIONS_ORDRE_REPARATION`) — jamais un `PATCH`
 * générique, voir l'en-tête de `@dfa/shared/contrats/atelier/ordre-reparation.ts`. Chaque
 * transition renvoie le DOCUMENT COMPLET de l'OR (D-10) : posé directement dans le cache via
 * `setQueryData` sur `clesQuery.or.detail(orId)`, sans jamais relire (« l'écran d'OR est l'écran
 * le plus rafraîchi du produit »). La liste est invalidée par PRÉFIXE (`['or', 'liste']`) pour
 * couvrir toute variante de filtre/tri déjà en cache, comme `useCreerClient`.
 *
 * Ligne-niveau (`valider-lignes`, `refuser-lignes`, `annuler-lignes`, `soumettre-lignes-a-devis`)
 * volontairement ABSENTES d'ici : elles exigent une sélection de lignes que l'écran de fiche ne
 * construit pas encore (pas de sélection multiple sur `ListeLignesOrdreReparation` en v1) —
 * ajouter ces hooks reste additif le jour où cette sélection existe.
 */
function useActionOrdreReparation<TEntree extends object>(
  orId: string,
  action: (orId: string, entree: TEntree) => Promise<ReponseAvecAvertissements<ReponseOrdreReparation>>,
): UseMutationResult<ReponseAvecAvertissements<ReponseOrdreReparation>, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(orId, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesQuery.or.detail(orId), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
    },
  });
}

/** T-03 `planifie -> ouvert`. */
export function useReceptionnerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionReceptionner>(orId, receptionnerOrdreReparation);
}

/** T-04 `ouvert -> en_cours`. */
export function useDemarrerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionSansCorps>(orId, demarrerOrdreReparation);
}

/** T-06 / T-08 / T-10 — lève les blocages d'attente. */
export function useReprendreTravauxOr(orId: string) {
  return useActionOrdreReparation<EntreeActionReprendreTravaux>(orId, reprendreTravauxOrdreReparation);
}

/** T-11 `en_cours -> controle`. */
export function usePasserEnControleOr(orId: string) {
  return useActionOrdreReparation<EntreeActionSansCorps>(orId, passerEnControleOrdreReparation);
}

/** T-12 `controle -> en_cours`, motif obligatoire. */
export function useRefuserControleOr(orId: string) {
  return useActionOrdreReparation<EntreeActionRefuserControle>(orId, refuserControleOrdreReparation);
}

/** T-13 `controle -> termine`. */
export function useValiderControleOr(orId: string) {
  return useActionOrdreReparation<EntreeActionValiderControle>(orId, validerControleOrdreReparation);
}

/** T-14 `en_cours -> termine` (interdite si contrôle qualité obligatoire, P-08). */
export function useTerminerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionTerminer>(orId, terminerOrdreReparation);
}

/** T-15 `termine -> en_cours`, motif obligatoire. Depuis `facture`, refusée par le serveur
 *  (`OR_LIGNE_VERROUILLEE`/transition interdite) avec `CREER_OR_RETOUCHE` en action proposée. */
export function useRouvrirOr(orId: string) {
  return useActionOrdreReparation<EntreeActionRouvrir>(orId, rouvrirOrdreReparation);
}

/** T-17 / T-18. */
export function useRestituerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionRestituer>(orId, restituerOrdreReparation);
}

/** T-19. */
export function useCloturerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionSansCorps>(orId, cloturerOrdreReparation);
}

/** T-20, motif obligatoire (RM-62). */
export function useAnnulerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionAnnuler>(orId, annulerOrdreReparation);
}
