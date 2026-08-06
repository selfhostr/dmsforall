import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeAnnulationLignes,
  EntreeCreationLigneOr,
  EntreeRefusLignes,
  EntreeValidationLignes,
  ReponseAvecAvertissements,
  ReponseLigneOr,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import {
  annulerLignesOrdreReparation,
  creerLigneOrdreReparation,
  refuserLignesOrdreReparation,
  validerLignesOrdreReparation,
} from './ordres-reparation.api';
import { useActionOrdreReparation } from './useTransitionsOrdreReparation';

interface VariablesCreationLigneOr {
  readonly entree: EntreeCreationLigneOr;
  /** Une clé par ligne (RM-49 : la saisie se fait en rafale) — voir le commentaire d'en-tête de
   *  `api/idempotence.ts`. Générée par l'appelant à l'instant du clic, jamais mémorisée. */
  readonly idempotencyKey: string;
}

/**
 * `POST /ordres-reparation/{orId}/lignes` (§7.8, `atelier.ligne.creer` — voir
 * `ecrans/atelier/droits.ts`) — couche TanStack Query pure, consommée par
 * `DialogueAjoutLigneOr.tsx`.
 *
 * À la différence des transitions et des actions groupées ci-dessous, la réponse ne porte que la
 * LIGNE créée (`EnveloppeLigneOrDto`), jamais le document OR complet : `nombreLignes`,
 * `totauxParPayeur`, `attentes` et `actionsDisponibles` ne peuvent être reconstruits sans le
 * serveur. Le document est donc INVALIDÉ (relecture), pas posé directement en cache.
 */
export function useCreerLigneOr(
  orId: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseLigneOr>, unknown, VariablesCreationLigneOr> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationLigneOr) =>
      creerLigneOrdreReparation(orId, entree, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.or.detail(orId) });
    },
  });
}

/** §10 L967 — Action groupée ATOMIQUE : `proposee|a_valider -> validee`. Droit
 *  `atelier.ligne.valider` (réceptionnaire, chef d'atelier, direction, admin). */
export function useValiderLignesOr(orId: string) {
  return useActionOrdreReparation<EntreeValidationLignes>(orId, validerLignesOrdreReparation);
}

/** `a_valider -> refusee` (CT-33), motif optionnel. Droit `atelier.ligne.refuser`. */
export function useRefuserLignesOr(orId: string) {
  return useActionOrdreReparation<EntreeRefusLignes>(orId, refuserLignesOrdreReparation);
}

/** Annulation avec motif OBLIGATOIRE (RM-71) — toute ligne non facturée. Droit
 *  `atelier.ligne.annuler`. */
export function useAnnulerLignesOr(orId: string) {
  return useActionOrdreReparation<EntreeAnnulationLignes>(orId, annulerLignesOrdreReparation);
}
