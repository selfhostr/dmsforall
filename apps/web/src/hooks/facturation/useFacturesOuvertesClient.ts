import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { DocumentVenteResume, PageCurseur } from '@dfa/shared';

import { clesFacturation } from './cles';
import { listerDocumentsVente } from './documents-vente.api';

const LIMITE_FACTURES_OUVERTES = 100;

/** `GET /documents-vente?clientId=&statutReglement=non_regle,partiel&typeDocument=facture` —
 *  source de l'écran 3 (encaissement) quand il s'ouvre depuis la fiche client, sans facture
 *  présélectionnée (§5, point d'entrée 2). Triée par ancienneté croissante côté serveur (`RF-69`,
 *  `TRIS_DOCUMENTS_VENTE` ne porte pas ce tri directement — filtré client-side ci-dessous par
 *  `dateDocument` faute d'un tri dédié dans le contrat gelé). */
export function useFacturesOuvertesClient(clientId: string | undefined): UseQueryResult<readonly DocumentVenteResume[]> {
  return useQuery({
    queryKey: clesFacturation.documents.ouvertesClient(clientId ?? ''),
    queryFn: async () => {
      const page: PageCurseur<DocumentVenteResume> = await listerDocumentsVente(
        {
          clientId: clientId as string,
          typeDocument: ['facture'],
          statutReglement: ['non_regle', 'partiel'],
          tri: 'dateDocument:asc',
        },
        { limite: LIMITE_FACTURES_OUVERTES },
      );
      return page.donnees;
    },
    enabled: Boolean(clientId),
  });
}
