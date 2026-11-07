import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import type {
  CodeConfirmation,
  EntreeCreationOrdreDepuisDevis,
  ReponseAvecAvertissements,
  ReponseCreationOrdreDepuisDevis,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';

import { clesFacturation } from './cles';
import { creerOrdreDepuisDevis } from './documents-vente.api';

interface Variables {
  readonly devisId: string;
  readonly entree: EntreeCreationOrdreDepuisDevis;
}

/**
 * « Créer l'OR » depuis un devis : `POST /documents-vente/{id}/creer-ordre-reparation`.
 *
 * Idempotence (un rejeu ne doit ni créer un second OR ni brûler un numéro) : la clé vit dans un
 * `useRef` et ne change qu'après un succès ou avant un rejeu qui AJOUTE des `confirmations[]`
 * (elles entrent dans l'empreinte — réutiliser la clé donnerait `IDEMPOTENCE_CONFLIT`), même règle
 * que `useCreationOrdreReparation`.
 */
export function useCreerOrdreDepuisDevis() {
  const queryClient = useQueryClient();
  const cleRef = useRef(genererCleIdempotence());

  const mutation = useMutation<
    ReponseAvecAvertissements<ReponseCreationOrdreDepuisDevis>,
    unknown,
    Variables
  >({
    meta: { succes: 'commun:toasts.orCree' },
    mutationFn: ({ devisId, entree }) => creerOrdreDepuisDevis(devisId, entree, cleRef.current),
    onSuccess: (reponse) => {
      cleRef.current = genererCleIdempotence();
      const { ordreReparation, devisId } = reponse.donnees;
      queryClient.setQueryData(clesQuery.or.detail(ordreReparation.id), ordreReparation);
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: clesFacturation.documents.detail(devisId) });
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
    },
  });

  const erreurApi = mutation.error instanceof ErreurApi ? mutation.error : null;

  return {
    enCours: mutation.isPending,
    erreur: mutation.error,
    confirmationsRequises: erreurApi?.confirmationsRequises ?? [],
    /** Première tentative, ou nouvelle tentative après modification de la saisie. */
    soumettre: (variables: Variables, onSucces: (orId: string) => void) =>
      mutation.mutate(variables, { onSuccess: (r) => onSucces(r.donnees.ordreReparation.id) }),
    /** Rejeu APRÈS accord explicite sur `confirmationsRequises` : nouvelle clé avant l'envoi. */
    confirmerEtResoumettre: (
      variables: Variables,
      confirmations: readonly CodeConfirmation[],
      onSucces: (orId: string) => void,
    ) => {
      cleRef.current = genererCleIdempotence();
      mutation.mutate(
        { ...variables, entree: { ...variables.entree, confirmations: [...confirmations] } },
        { onSuccess: (r) => onSucces(r.donnees.ordreReparation.id) },
      );
    },
  };
}
