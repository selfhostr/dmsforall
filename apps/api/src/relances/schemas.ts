import { z } from 'zod';
import { schemaParametresPage, schemaTypeRelance } from '@dfa/shared';

export { schemaTypeRelance };

/**
 * `GET /relances/facturation/historique` (issue #136). Composé localement, jamais dans
 * `@dfa/shared` — même doctrine que `apps/api/src/clients/schemas.ts#schemaPageSousCollection` :
 * cette collection ne déclare aucun `tri` fermé au contrat (tri fixe `envoyeLe:desc`, voir
 * `service-historique-envois.ts`), donc `tri` est omis de `schemaParametresPage`.
 *
 * `factureId` FACULTATIF : omis, la route rend l'historique COMPLET du tenant (c'est l'usage de
 * l'écran de configuration des relances, `EcranRelances.tsx`, bloc « Historique d'envoi » —
 * aucune facture n'y est sélectionnée) ; fourni, elle filtre sur cette seule facture (usage
 * attendu d'un futur écran de détail de facture — hors périmètre de cette issue, mais le filtre
 * existe déjà pour ne pas re-façonner la route à cette occasion, voir le rapport de livraison).
 */
export const schemaListeHistoriqueEnvois = schemaParametresPage.omit({ tri: true }).extend({
  factureId: z.string().uuid().optional(),
});
export type ParametresListeHistoriqueEnvois = z.infer<typeof schemaListeHistoriqueEnvois>;
