import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeFacturationOrdreReparation, ReponseAvecAvertissements, ReponseFacturationOrdreReparation } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { clesFacturation } from './cles';
import { facturerOrdreReparation } from './facturer-ordre-reparation.api';

interface VariablesFacturationOr {
  readonly orId: string;
  readonly entree: EntreeFacturationOrdreReparation;
  readonly idempotencyKey: string;
}

/**
 * `POST /ordres-reparation/{orId}/facturer` — couche mutation PURE (`RF-81`), sans logique de
 * confirmation ni de clé d'idempotence : cette partie est orchestrée par
 * `useFacturationOrdreReparation.ts`, qui consomme ce hook — même séparation que
 * `hooks/atelier/useCreerOrdreReparation.ts` / `useCreationOrdreReparation.ts`.
 *
 * `onSuccess` pose chaque facture créée dans le cache de sa propre fiche ET l'OR à jour
 * (`ReponseFacturationOrdreReparation.ordreReparation`, §7.7 — même patron que toute transition
 * d'OR : le client n'a pas à relire séparément après l'appel, `statut` peut rester `'termine'` si
 * des groupes payeur restent en attente, `RF-84`). La liste des factures est invalidée par
 * PRÉFIXE (`['facturation', 'documents', 'liste']`), comme toute autre création de document.
 */
export function useFacturerOrdreReparation(): UseMutationResult<
  ReponseAvecAvertissements<ReponseFacturationOrdreReparation>,
  unknown,
  VariablesFacturationOr
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orId, entree, idempotencyKey }: VariablesFacturationOr) => facturerOrdreReparation(orId, entree, idempotencyKey),
    onSuccess: (reponse) => {
      for (const facture of reponse.donnees.facturesCreees) {
        queryClient.setQueryData(clesFacturation.documents.detail(facture.id), facture);
      }
      queryClient.setQueryData(clesQuery.or.detail(reponse.donnees.ordreReparation.id), reponse.donnees.ordreReparation);
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
    },
  });
}
