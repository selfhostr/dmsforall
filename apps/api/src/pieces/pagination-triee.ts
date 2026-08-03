import { sql, type SQL } from 'drizzle-orm';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';

/**
 * Support générique du curseur v2 triable (contrats-api-etape-1.md §6.1) pour les listes qui ne
 * peuvent pas s'exprimer avec le seul query-builder Drizzle : tri sur une expression calculée ou
 * colonne potentiellement `NULL`.
 *
 * Copie module-locale de `apps/api/src/clients/pagination-triee.ts` — même doctrine que cette
 * dernière (voir son en-tête) : chaque domaine possède sa propre composition de tri sur les
 * primitives partagées de `common/pagination/` (`curseur.ts`, `valeur-temporelle.ts`), pas de
 * module transverse à réimporter entre domaines disjoints (`clients/` n'est pas dans le périmètre
 * de cet agent, et l'inverse n'est pas souhaitable : deux propriétaires sur le même fichier).
 */
export interface DefinitionTri {
  /** Expression SQL de la clé de tri — TOUJOURS une constante du code, jamais un fragment construit depuis l'entrée utilisateur. */
  readonly expression: SQL;
  readonly sens: 'asc' | 'desc';
  /** `true` si l'expression peut rendre `NULL` : trie alors `NULLS LAST`, quel que soit `sens`. */
  readonly nullable: boolean;
  /**
   * `true` si `expression` désigne (ou dérive d') une colonne `timestamptz` — la valeur de curseur
   * DOIT alors transiter par du texte natif PostgreSQL (`::text`, via `expressionTriValeur()`) et
   * par `valeurCurseurTimestamptz()` (via `valeurCurseurDepuisTri()`), jamais par un `Date`
   * JavaScript (perte de microseconde, voir `common/pagination/valeur-temporelle.ts`).
   */
  readonly temporel?: boolean;
}

/** Expression de la colonne `triValeur` en sortie de `SELECT` : `::text` pour une expression temporelle, inchangée sinon. */
export function expressionTriValeur(def: DefinitionTri): SQL {
  return def.temporel ? sql`(${def.expression})::text` : def.expression;
}

/** Valeur de curseur à encoder à partir de la `triValeur` brute rendue par la requête. */
export function valeurCurseurDepuisTri(
  def: DefinitionTri,
  triValeur: string | number | null,
): string | number | null {
  if (triValeur === null) return null;
  if (def.temporel) {
    if (typeof triValeur !== 'string') {
      throw new Error(
        `valeurCurseurDepuisTri : expression temporelle attendue en texte (SELECT via expressionTriValeur()), ` +
          `reçu ${typeof triValeur}.`,
      );
    }
    return valeurCurseurTimestamptz(triValeur);
  }
  return triValeur;
}

/** `ORDER BY <expr> <sens> [NULLS LAST], <idExpr> <sens>` — tri total, départagé par id. */
export function construireOrderBy(def: DefinitionTri, idExpr: SQL): SQL {
  const direction = def.sens === 'asc' ? sql`asc` : sql`desc`;
  const nulls = def.nullable ? sql`nulls last` : sql``;
  return sql`${def.expression} ${direction} ${nulls}, ${idExpr} ${direction}`;
}

/** Condition de reprise keyset à partir d'un curseur v2 déjà décodé (`{valeur, id}`). */
export function construireConditionKeyset(
  def: DefinitionTri,
  idExpr: SQL,
  valeur: string | number | null,
  id: string,
): SQL {
  const operateur = def.sens === 'asc' ? sql`>` : sql`<`;

  if (valeur === null) {
    return sql`(${def.expression} is null and ${idExpr} < ${id})`;
  }

  const suite = sql`((${def.expression} ${operateur} ${valeur}) or (${def.expression} = ${valeur} and ${idExpr} ${operateur} ${id}))`;
  return def.nullable ? sql`(${suite} or ${def.expression} is null)` : suite;
}

/** Décode le curseur de la requête pour le `tri` demandé — `null` si aucun curseur fourni. */
export function decoderCurseurPourTri(
  curseur: string | undefined,
  triDemande: string,
): { readonly valeur: string | number | null; readonly id: string } | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande);
  return { valeur, id };
}

export { encoderCurseurTrie };
