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
 * Ligne-niveau (`valider-lignes`, `refuser-lignes`, `annuler-lignes`) : `ListeLignesOrdreReparation`
 * construit désormais une sélection multiple (case à cocher par ligne, gouvernée par
 * `ecrans/atelier/droits.ts`) — leurs hooks vivent dans `useActionsLigneOr.ts`, qui RÉUTILISE
 * `useActionOrdreReparation` ci-dessous (exporté pour cette raison) plutôt que de dupliquer le
 * branchement `setQueryData`/invalidation : les deux familles d'actions renvoient le même DOCUMENT
 * COMPLET dans l'enveloppe (`EnveloppeOrdreReparationDto`). `soumettre-lignes-a-devis` reste hors
 * périmètre (aucun écran ne le déclenche encore).
 */
export function useActionOrdreReparation<TEntree extends object>(
  orId: string,
  action: (
    orId: string,
    entree: TEntree,
  ) => Promise<ReponseAvecAvertissements<ReponseOrdreReparation>>,
  /** Clé i18n du toast de succès (`commun:toasts.*`) ; sans elle, aucun retour affiché. */
  succes?: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseOrdreReparation>, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(orId, entree),
    meta: succes ? { succes } : undefined,
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesQuery.or.detail(orId), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
    },
  });
}

/** T-03 `planifie -> ouvert`. */
export function useReceptionnerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionReceptionner>(
    orId,
    receptionnerOrdreReparation,
    'commun:toasts.orReceptionne',
  );
}

/** T-04 `ouvert -> en_cours`. */
export function useDemarrerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionSansCorps>(
    orId,
    demarrerOrdreReparation,
    'commun:toasts.orDemarre',
  );
}

/** T-06 / T-08 / T-10 — lève les blocages d'attente. */
export function useReprendreTravauxOr(orId: string) {
  return useActionOrdreReparation<EntreeActionReprendreTravaux>(
    orId,
    reprendreTravauxOrdreReparation,
    'commun:toasts.travauxRepris',
  );
}

/** T-11 `en_cours -> controle`. */
export function usePasserEnControleOr(orId: string) {
  return useActionOrdreReparation<EntreeActionSansCorps>(
    orId,
    passerEnControleOrdreReparation,
    'commun:toasts.orEnControle',
  );
}

/** T-12 `controle -> en_cours`, motif obligatoire. */
export function useRefuserControleOr(orId: string) {
  return useActionOrdreReparation<EntreeActionRefuserControle>(
    orId,
    refuserControleOrdreReparation,
    'commun:toasts.controleRefuse',
  );
}

/** T-13 `controle -> termine`. */
export function useValiderControleOr(orId: string) {
  return useActionOrdreReparation<EntreeActionValiderControle>(
    orId,
    validerControleOrdreReparation,
    'commun:toasts.controleValide',
  );
}

/** T-14 `en_cours -> termine` (interdite si contrôle qualité obligatoire, P-08). */
export function useTerminerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionTerminer>(
    orId,
    terminerOrdreReparation,
    'commun:toasts.travauxTermines',
  );
}

/** T-15 `termine -> en_cours`, motif obligatoire. Depuis `facture`, refusée par le serveur
 *  (`OR_LIGNE_VERROUILLEE`/transition interdite) avec `CREER_OR_RETOUCHE` en action proposée. */
export function useRouvrirOr(orId: string) {
  return useActionOrdreReparation<EntreeActionRouvrir>(
    orId,
    rouvrirOrdreReparation,
    'commun:toasts.orRouvert',
  );
}

/** T-17 / T-18. */
export function useRestituerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionRestituer>(
    orId,
    restituerOrdreReparation,
    'commun:toasts.orRestitue',
  );
}

/** T-19. */
export function useCloturerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionSansCorps>(
    orId,
    cloturerOrdreReparation,
    'commun:toasts.orCloture',
  );
}

/** T-20, motif obligatoire (RM-62). */
export function useAnnulerOr(orId: string) {
  return useActionOrdreReparation<EntreeActionAnnuler>(
    orId,
    annulerOrdreReparation,
    'commun:toasts.orAnnule',
  );
}
