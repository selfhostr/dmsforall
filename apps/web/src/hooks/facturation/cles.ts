/**
 * Clés TanStack Query du domaine facturation — même convention que `clesQuery` (`@/api/cles.ts`,
 * tuple plat `[domaine, sous-ressource, ...paramètres]`), mais délibérément TENUES ICI plutôt que
 * fusionnées dans `api/cles.ts` : ce fichier n'est pas dans le périmètre d'écriture confié à cet
 * agent (« `apps/web/src/api/cles.ts` ne t'appartient pas »). À REMONTER : une fois validé, ce
 * module devrait fusionner dans `clesQuery.facturation` pour que toute la fabrique de clés reste au
 * même endroit — jusque-là, une invalidation croisée (ex. un futur écran hors de ce module qui
 * voudrait invalider `clesFacturation.documents.liste`) devra importer ce fichier explicitement.
 */

import type { FiltresDocumentsVente } from '@dfa/shared';

export const clesFacturation = {
  documents: {
    /** `filtres` est celui, complet, envoyé à `GET /documents-vente` (`FiltresDocumentsVente`,
     *  `@dfa/shared`) — jamais un type local réinventé : plusieurs champs (`typeDocument`,
     *  `statut`, `statutReglement`) sont des tableaux, qu'un `Record<string, primitif>` ad hoc ne
     *  peut pas représenter. Seul appelant à ce jour : `useListeDocumentsVente`, qui construit
     *  toujours l'objet complet (`tri` inclus) — pas de valeur par défaut ici. */
    liste: (filtres: FiltresDocumentsVente) => ['facturation', 'documents', 'liste', filtres] as const,
    detail: (id: string) => ['facturation', 'documents', 'detail', id] as const,
    /** Factures ouvertes d'un client — source de l'écran 3 (encaissement) quand l'entrée se fait
     *  depuis la fiche client plutôt que depuis une facture précise (§5, point d'entrée 2). */
    ouvertesClient: (clientId: string) => ['facturation', 'documents', 'ouvertesClient', clientId] as const,
  },
} as const;
