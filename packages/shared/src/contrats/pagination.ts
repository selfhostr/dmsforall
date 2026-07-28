import { z } from 'zod';

/**
 * Pagination par curseur, standard sur TOUTES les collections de l'API DFA.
 *
 * Le curseur est opaque côté client. Un curseur illisible doit toujours produire
 * `400 VALIDATION_ECHOUEE`, jamais une erreur 500 (voir apps/api/src/common/pagination/).
 *
 * ÉTAPE 1 — extension ADDITIVE (contrats-api-etape-1.md §6.1) : le curseur apprend à trier
 * autrement que par date de création. Aucun champ existant n'a changé.
 */
export interface PageCurseur<T> {
  readonly donnees: readonly T[];
  /** Opaque base64url ; `null` = fin de liste. */
  readonly curseurSuivant: string | null;
  readonly limite: number;
}

/**
 * Charge utile HISTORIQUE du curseur (socle, étape 0) : base64url de `{"c":"<cree_le ISO>","i":"<uuid>"}`
 * pour le tri fixe `(cree_le DESC, id DESC)`.
 *
 * Elle reste DÉCODABLE indéfiniment et équivaut à `t = TRI_DEFAUT_CREATION`. Aucun client
 * existant n'est affecté ; la migration vers v2 est invisible. Le décodeur essaie v2 puis v1.
 */
export interface DonneesCurseurV1 {
  /** `cree_le` au format ISO 8601 UTC. */
  readonly c: string;
  /** uuid, départage stable. */
  readonly i: string;
}

/**
 * Charge utile v2 du curseur : base64url de `{"t":"…","v":…,"i":"…"}`.
 *
 * - `t` : le tri auquel APPARTIENT le curseur, forme `<champ>:<asc|desc>` (voir `REGEX_TRI`).
 * - `v` : la valeur de la clé de tri du dernier élément rendu — chaîne, entier ou `null`.
 * - `i` : l'`id`, départage stable.
 *
 * Règle de contrat associée, non négociable : un curseur dont `t` ≠ le paramètre `tri` de la
 * requête produit `400 VALIDATION_ECHOUEE` avec `erreurs[0].champ = "curseur"`. Sans cette
 * vérification, changer de tri en cours de pagination rend des pages silencieusement fausses —
 * un bug qu'on ne voit qu'en production et qu'on ne reproduit jamais.
 *
 * Tout tri exposé doit être TOTAL : la clé de tri est toujours complétée par `id`, et toute
 * colonne nullable trie en `NULLS LAST` documenté.
 */
export interface DonneesCurseurV2 {
  readonly t: string;
  readonly v: string | number | null;
  readonly i: string;
}

export const SENS_TRI = ['asc', 'desc'] as const;
export type SensTri = (typeof SENS_TRI)[number];

/**
 * Forme d'un paramètre `tri` : `<champ>:<asc|desc>`, le champ en camelCase comme tous les noms
 * de champs de l'API (§1.3 — seuls les ENUMS sont en snake_case).
 *
 * ÉCART SIGNALÉ, tranché ici en faveur du camelCase : `contrats-api-etape-1.md` §6.1 donne deux
 * exemples en snake_case (`restitution_promise:asc`, `cree_le:desc`) alors que la table §6.2,
 * qui est la liste normative des tris par collection, est intégralement en camelCase
 * (`creeLe:desc`, `restitutionPromiseLe:asc`, `ouvertLe:desc`…), et que `plan-lot1-execution.md`
 * §6.1 écrit `creeLe:desc`. Le camelCase l'emporte : c'est la règle §1.3, c'est la table
 * normative, et c'est l'arbitrage le plus récent.
 */
export const REGEX_TRI = /^[a-z][a-zA-Z0-9]*:(asc|desc)$/;

/**
 * Tri par défaut hérité du socle, valeur de `t` attribuée à tout curseur v1 décodé.
 * Reste le défaut de toute collection qui n'en déclare pas d'autre.
 */
export const TRI_DEFAUT_CREATION = 'creeLe:desc';

/**
 * Paramètres communs à toutes les collections. `tri` est facultatif au niveau du schéma commun ;
 * chaque collection restreint ensuite les valeurs acceptées à sa LISTE FERMÉE (voir les
 * constantes `TRIS_*` des modules) — un tri non listé produit `400`, jamais un tri
 * silencieusement ignoré.
 */
export const schemaParametresPage = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
  tri: z.string().max(64).regex(REGEX_TRI).optional(),
});
export type ParametresPage = z.infer<typeof schemaParametresPage>;
