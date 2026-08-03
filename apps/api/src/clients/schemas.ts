import { z } from 'zod';
import {
  schemaFiltresClients,
  schemaFiltresVehiculesDuClient,
  schemaParametresPage,
} from '@dfa/shared';
import { STATUTS_ORDRE_REPARATION } from '@dfa/shared';

/**
 * Schémas de requête composés localement à `apps/api/src/clients/**` — jamais dans
 * `@dfa/shared`, fermé pour le lot 1. `schemaFiltresClients` (contrat gelé) porte les filtres
 * ET un `tri` restreint à sa liste fermée, mais PAS `limite`/`curseur` (communs à toute
 * collection, `schemaParametresPage`). Composer les deux ici est la seule façon d'obtenir un
 * schéma de requête complet sans dupliquer `tri` avec deux formes différentes.
 */
export const schemaListeClients = schemaParametresPage
  .omit({ tri: true })
  .extend(schemaFiltresClients.shape);
export type ParametresListeClients = z.infer<typeof schemaListeClients>;

export const schemaListeVehiculesDuClient = schemaParametresPage
  .omit({ tri: true })
  .extend(schemaFiltresVehiculesDuClient.shape);
export type ParametresListeVehiculesDuClient = z.infer<typeof schemaListeVehiculesDuClient>;

/**
 * `GET /clients/{id}/ordres-reparation` (contrats-api-etape-1.md §6.2 : filtre `statut` multi,
 * tri `ouvertLe:desc`/`ouvertLe:asc`) — GAP DE CONTRAT signalé en réponse de tâche :
 * `packages/shared` ne définit aucun `schemaFiltresOrDuClient` ni `TRIS_OR_DU_CLIENT`
 * correspondant à un schéma de filtre (seules les constantes `TRIS_OR_DU_CLIENT` /
 * `TRI_DEFAUT_OR_DU_CLIENT` existent, réutilisées ci-dessous). Schéma reconstruit localement.
 */
export const schemaListeOrDuClient = schemaParametresPage.omit({ tri: true }).extend({
  statut: z.array(z.enum(STATUTS_ORDRE_REPARATION)).optional(),
  tri: z.enum(['ouvertLe:desc', 'ouvertLe:asc']).default('ouvertLe:desc'),
});
export type ParametresListeOrDuClient = z.infer<typeof schemaListeOrDuClient>;

/**
 * Sous-collections sans tri métier déclaré au contrat (adresses, contacts, conditions,
 * consentements, notes) : pagination par curseur v1 (`creeLe desc, id desc`), pas de `tri`
 * exposé — §6.2 du contrat ne leur attribue aucune liste de tris fermée.
 */
export const schemaPageSousCollection = schemaParametresPage.omit({ tri: true });
export type ParametresPageSousCollection = z.infer<typeof schemaPageSousCollection>;

/** Identifiant de chemin, réutilisé sur chaque contrôleur (`:clientId`, `:adresseId`…). */
export const schemaUuid = z.string().uuid();
