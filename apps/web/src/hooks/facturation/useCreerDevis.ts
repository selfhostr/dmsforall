import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseAvecAvertissements, ReponseDocumentVente } from '@dfa/shared';

import { genererCleIdempotence } from '@/api/idempotence';

import { clesFacturation } from './cles';
import { creerDocumentVente } from './documents-vente.api';

export interface VariablesCreationDevis {
  readonly siteId: string;
  readonly clientId: string;
  /** Facultatif : un devis se fait aussi pour un client dont la voiture n'est pas encore connue. */
  readonly vehiculeId?: string;
}

/**
 * « Nouveau devis » : `POST /documents-vente` avec `typeDocument: 'devis'`, brouillon sans ligne,
 * en CHF. Une clé d'idempotence par intention (générée à l'appel) : un double-clic ne crée pas deux
 * devis tant que l'appelant garde la mutation en cours (bouton désactivé pendant l'envoi).
 */
export function useCreerDevis(): UseMutationResult<
  ReponseAvecAvertissements<ReponseDocumentVente>,
  unknown,
  VariablesCreationDevis
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, clientId, vehiculeId }: VariablesCreationDevis) =>
      creerDocumentVente(
        {
          typeDocument: 'devis',
          siteId,
          clientId,
          vehiculeId: vehiculeId ?? null,
          devise: 'CHF',
          lignes: [],
        },
        genererCleIdempotence(),
      ),
    onSuccess: (reponse) => {
      queryClient.setQueryData(
        clesFacturation.documents.detail(reponse.donnees.id),
        reponse.donnees,
      );
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
    },
  });
}
