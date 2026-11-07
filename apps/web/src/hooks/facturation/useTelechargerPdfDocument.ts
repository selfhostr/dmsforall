import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { recupererPdfDocument } from './pdf-courriel-document.api';

interface VariablesPdf {
  readonly id: string;
  /** Nom du fichier proposé au téléchargement (sans extension). */
  readonly nom: string;
}

/** Déclenche le téléchargement du PDF d'un document de vente. L'échec (`DOCUMENT_PDF_INDISPONIBLE`,
 *  réseau) reste dans `error` pour que l'écran l'affiche — jamais un onglet vide. */
export function useTelechargerPdfDocument(): UseMutationResult<void, unknown, VariablesPdf> {
  return useMutation({
    mutationFn: async ({ id, nom }: VariablesPdf) => {
      const blob = await recupererPdfDocument(id);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = `${nom}.pdf`;
      lien.rel = 'noopener';
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
}
