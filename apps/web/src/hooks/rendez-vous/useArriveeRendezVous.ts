import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import type {
  CodeConfirmation,
  EntreeActionArriveeRendezVous,
  ReponseRendezVous,
  ReponseRendezVousAvecAvertissements,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { clesQuery } from '@/api/cles';
import { genererCleIdempotence } from '@/api/idempotence';

import { arriveeRendezVous } from './rendez-vous.api';

interface VariablesArrivee {
  readonly entree: EntreeActionArriveeRendezVous;
  readonly idempotencyKey: string;
}

/** `POST /rendez-vous/{id}/arrivee` — couche TanStack Query pure. Crée (ou réceptionne) l'OR lié :
 *  invalide donc AUSSI les listes d'OR (`['or', 'liste']`), pas seulement la période/capacité du
 *  rendez-vous — c'est le cœur du chantier (amorce `restitutionPromiseLe`, § rapport de livraison). */
function useArriveeRendezVousMutation(
  rdvId: string,
): UseMutationResult<ReponseRendezVousAvecAvertissements, unknown, VariablesArrivee> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesArrivee) =>
      arriveeRendezVous(rdvId, entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesQuery.rdv.detail(rdvId), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'plage'] });
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'charge'] });
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
      if (reponse.donnees.ordreReparationId) {
        queryClient.removeQueries({
          queryKey: clesQuery.or.detail(reponse.donnees.ordreReparationId),
        });
      }
    },
  });
}

export interface ArriveeRendezVous {
  readonly enCours: boolean;
  readonly erreur: unknown;
  readonly erreurActive: ErreurApi | null;
  readonly confirmationsRequises: readonly CodeConfirmation[];
  readonly soumettre: (
    entree: EntreeActionArriveeRendezVous,
    options: { readonly onSuccess: (rdv: ReponseRendezVous) => void },
  ) => void;
  readonly confirmerEtResoumettre: (options: {
    readonly onSuccess: (rdv: ReponseRendezVous) => void;
  }) => void;
}

/**
 * Orchestration de l'arrivée — même patron d'idempotence/confirmation que
 * `hooks/rendez-vous/useCreationRendezVous.ts` (l'action peut créer une ressource rare, l'OR).
 */
export function useArriveeRendezVous(rdvId: string): ArriveeRendezVous {
  const mutation = useArriveeRendezVousMutation(rdvId);
  const cleIdempotenceRef = useRef(genererCleIdempotence());
  const [derniereEntree, setDerniereEntree] = useState<EntreeActionArriveeRendezVous | null>(null);

  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(
    entree: EntreeActionArriveeRendezVous,
    options: { readonly onSuccess: (rdv: ReponseRendezVous) => void },
  ) {
    setDerniereEntree(entree);
    mutation.mutate(
      { entree, idempotencyKey: cleIdempotenceRef.current },
      {
        onSuccess: (reponse) => {
          cleIdempotenceRef.current = genererCleIdempotence();
          setDerniereEntree(null);
          options.onSuccess(reponse.donnees);
        },
      },
    );
  }

  function confirmerEtResoumettre(options: {
    readonly onSuccess: (rdv: ReponseRendezVous) => void;
  }) {
    if (!derniereEntree) return;
    cleIdempotenceRef.current = genererCleIdempotence();
    soumettre({ ...derniereEntree, confirmations: [...confirmationsRequises] }, options);
  }

  return {
    enCours: mutation.isPending,
    erreur: confirmationsRequises.length > 0 ? null : mutation.error,
    erreurActive,
    confirmationsRequises,
    soumettre,
    confirmerEtResoumettre,
  };
}
