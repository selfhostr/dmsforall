import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCorrectionPointage,
  ReponseAvecAvertissements,
  ReponsePointage,
} from '@dfa/shared';

import { clesPointage } from './cles';
import { corrigerPointage } from './pointage.api';

interface VariablesCorrectionPointage {
  readonly id: string;
  readonly entree: EntreeCorrectionPointage;
  readonly idempotencyKey: string;
}

/**
 * `POST /pointages/{id}/corriger` — RM-94, réservé à `atelier.pointage.corriger_autrui`
 * (`ecrans/pointage/droits.ts`). PAS d'optimisme ici, à la différence de démarrer/arrêter : une
 * correction n'est pas un geste au rythme du chrono (elle se fait après coup, depuis l'écran
 * chef d'atelier), et son succès dépend d'une condition serveur non prévisible côté client
 * (`400 POINTAGE_MOTIF_REQUIS` si le motif manque ALORS QU'un champ change réellement — voir le
 * commentaire de `schemaCorrectionPointage`) : mieux vaut attendre la réponse réelle qu'afficher un
 * état optimiste qui devrait parfois être immédiatement défait.
 */
export function useCorrigerPointage(): UseMutationResult<
  ReponseAvecAvertissements<ReponsePointage>,
  unknown,
  VariablesCorrectionPointage
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree, idempotencyKey }: VariablesCorrectionPointage) =>
      corrigerPointage(id, entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPointage.detail(reponse.donnees.id), reponse.donnees);
      queryClient.setQueryData(
        clesPointage.ouvertTechnicien(reponse.donnees.technicienId),
        (actuel: ReponsePointage | null | undefined) =>
          actuel?.id === reponse.donnees.id ? reponse.donnees : actuel,
      );
      void queryClient.invalidateQueries({ queryKey: ['pointages', 'liste'] });
      void queryClient.invalidateQueries({
        queryKey: ['pointages', 'technicienJour', reponse.donnees.technicienId],
      });
    },
  });
}
