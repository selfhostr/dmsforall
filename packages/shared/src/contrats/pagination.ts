import { z } from 'zod';

/**
 * Pagination par curseur, standard sur tous les endpoints de liste de l'API DFA.
 *
 * Le curseur est opaque côté client : base64url de `{"c":"<cree_le ISO>","i":"<uuid>"}`,
 * pour un tri stable `(cree_le DESC, id DESC)`. Un curseur illisible doit toujours produire
 * `400 VALIDATION_ECHOUEE`, jamais une erreur 500 (voir apps/api/src/common/pagination/).
 */
export interface PageCurseur<T> {
  readonly donnees: readonly T[];
  /** Opaque base64url ; `null` = fin de liste. */
  readonly curseurSuivant: string | null;
  readonly limite: number;
}

export const schemaParametresPage = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
export type ParametresPage = z.infer<typeof schemaParametresPage>;
