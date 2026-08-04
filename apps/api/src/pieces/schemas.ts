import { z } from 'zod';
import {
  schemaFiltresArticles,
  schemaFiltresCommandesFournisseur,
  schemaFiltresConsignes,
  schemaFiltresFournisseurs,
  schemaFiltresLignesCommandeFournisseur,
  schemaFiltresMouvementsStock,
  schemaFiltresReapprovisionnement,
  schemaFiltresReferencesArticle,
  schemaFiltresReservations,
  schemaParametresPage,
} from '@dfa/shared';

/**
 * Schémas de requête composés localement à `apps/api/src/pieces/**`, même doctrine que
 * `clients/schemas.ts` : `schemaFiltresArticles` (contrat gelé) porte les filtres ET un `tri`
 * restreint à sa liste fermée, mais PAS `limite`/`curseur` (communs à toute collection,
 * `schemaParametresPage`) — composer les deux ici est la seule façon d'obtenir un schéma de
 * requête complet sans dupliquer `tri` avec deux formes différentes.
 *
 * `schemaFiltresMouvementsStock`/`schemaFiltresReapprovisionnement`/`schemaFiltresReservations`
 * étendent déjà `schemaParametresPage` directement dans le contrat (`@dfa/shared`,
 * `contrats/pieces/{mouvement,stock,reservation}.ts`) — pas de composition supplémentaire requise
 * pour elles, réexportées ici pour que tout ce module lise ses schémas de liste au même endroit.
 * `schemaFiltresReferencesArticle`/`schemaFiltresLignesCommandeFournisseur` (sous-collections
 * paginées `GET /articles/{id}/references` et `GET /commandes-fournisseur/{id}/lignes`, ajoutées
 * pour donner une suite à `referencesTronquees`/`lignesTronquees`) suivent la même doctrine.
 */
export const schemaListeArticles = schemaParametresPage
  .omit({ tri: true })
  .extend(schemaFiltresArticles.shape);
export type ParametresListeArticles = z.infer<typeof schemaListeArticles>;

export {
  schemaFiltresCommandesFournisseur,
  schemaFiltresConsignes,
  schemaFiltresFournisseurs,
  schemaFiltresLignesCommandeFournisseur,
  schemaFiltresMouvementsStock,
  schemaFiltresReapprovisionnement,
  schemaFiltresReferencesArticle,
  schemaFiltresReservations,
};
export type {
  FiltresCommandesFournisseur,
  FiltresConsignes,
  FiltresFournisseurs,
  FiltresLignesCommandeFournisseur,
  FiltresMouvementsStock,
  FiltresReapprovisionnement,
  FiltresReferencesArticle,
  FiltresReservations,
} from '@dfa/shared';

/** Identifiant de chemin, réutilisé sur chaque contrôleur (`:articleId`, `:siteId`, `:id`…). */
export const schemaUuid = z.string().uuid();
