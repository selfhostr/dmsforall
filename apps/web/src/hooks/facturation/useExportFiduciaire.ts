import { useRef } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeLancerExport } from '@dfa/shared';

import { genererCleIdempotence } from '@/api/idempotence';

import { lancerExportFiduciaire, type ReponseExportFiduciaire } from './export-fiduciaire.api';

/**
 * Lance l'export fiduciaire. Un export MARQUE les documents comme exportés et le fichier n'est
 * renvoyé qu'une fois (aucun stockage serveur) : un rejeu après timeout avec une NOUVELLE clé
 * rendrait un lot vide alors que le premier a bien eu lieu, fichier perdu. La clé d'idempotence
 * est donc STABLE tant que la requête (même corps) n'a pas réussi, et ne change que si la période
 * ou le format change — un clic répété, ou un « Réessayer » après coupure réseau, rejoue la même
 * requête et le serveur renvoie le même résultat.
 */
export function useExportFiduciaire(): UseMutationResult<
  ReponseExportFiduciaire,
  unknown,
  EntreeLancerExport
> {
  const queryClient = useQueryClient();
  const cle = useRef<{ signature: string; valeur: string } | null>(null);

  return useMutation({
    mutationFn: (entree: EntreeLancerExport) => {
      const signature = JSON.stringify(entree);
      if (cle.current?.signature !== signature) {
        cle.current = { signature, valeur: genererCleIdempotence() };
      }
      return lancerExportFiduciaire(entree, cle.current.valeur);
    },
    onSuccess: () => {
      cle.current = null;
      // Les documents exportés changent d'état : toute liste de documents est périmée.
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents'] });
    },
  });
}
