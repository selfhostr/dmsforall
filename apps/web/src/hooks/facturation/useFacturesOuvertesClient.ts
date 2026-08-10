import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { DocumentVenteResume, PageCurseur } from '@dfa/shared';

import { clesFacturation } from './cles';
import { listerDocumentsVente } from './documents-vente.api';

const LIMITE_FACTURES_OUVERTES = 100;

/** `GET /documents-vente?clientId=&statut=emis&statutReglement=non_regle,partiel&typeDocument=facture`
 *  — source de l'écran 3 (encaissement) quand il s'ouvre depuis la fiche client, sans facture
 *  présélectionnée (§5, point d'entrée 2). Triée par ancienneté croissante côté serveur (`RF-69`,
 *  `TRIS_DOCUMENTS_VENTE` ne porte pas ce tri directement — filtré client-side ci-dessous par
 *  `dateDocument` faute d'un tri dédié dans le contrat gelé).
 *
 * DÉFAUT CORRIGÉ (parcours navigateur) : `statutReglement` seul ne suffit PAS à définir « ouverte ».
 * Une facture `annule_par_avoir` (`RF-32` ne nettoie ni `statutReglement` ni `soldeCentimes` à
 * l'annulation, voir `apps/api/src/facturation/documents/service-documents.ts`) conservait son
 * `statutReglement` d'avant l'annulation — `non_regle` ou `partiel` — et passait donc ce filtre. Le
 * panneau d'encaissement la proposait alors cochable, avec un « reste dû » qui n'est plus dû : une
 * créance éteinte se retrouvait sélectionnable et pouvait porter le total encaissé. `statut: ['emis']`
 * restreint aux documents qui peuvent encore recevoir un règlement — même doctrine que le filtre
 * `enRetard` du serveur (`service-documents.ts`, commentaire « une facture annulée par avoir en est
 * exclue ») : une fois émise, une facture ne reste ouverte qu'à l'état `emis` ; `annule_par_avoir` est
 * terminal (`MD-15`), et une correction ne se fait plus que par avoir, jamais par un nouveau paiement
 * sur la facture annulée. Ce filtre CLIENT est un filet de présentation, pas la frontière de sécurité
 * — c'est `POST /paiements` côté serveur qui doit refuser l'imputation sur un document non `emis`
 * (correctif porté par ailleurs).
 *
 * Les factures annulées par avoir restent visibles ailleurs (l'onglet « Toutes » de l'écran 5, et la
 * fiche facture elle-même via `BadgeEtatDocument`) — ce filtre ne fait disparaître une facture que
 * de CE panneau d'encaissement, jamais de l'application. */
export function useFacturesOuvertesClient(
  clientId: string | undefined,
): UseQueryResult<readonly DocumentVenteResume[]> {
  return useQuery({
    queryKey: clesFacturation.documents.ouvertesClient(clientId ?? ''),
    queryFn: async () => {
      const page: PageCurseur<DocumentVenteResume> = await listerDocumentsVente(
        {
          clientId: clientId as string,
          typeDocument: ['facture'],
          statut: ['emis'],
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
