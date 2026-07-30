import { sql, type SQL } from 'drizzle-orm';
import { decoderCurseurTrie, encoderCurseurTrie, valeurCurseurTimestamptz } from '../common/pagination';

/**
 * Support générique du curseur v2 triable (contrats-api-etape-1.md §6.1) pour les listes qui ne
 * peuvent pas s'exprimer avec le seul query-builder Drizzle : tri sur une expression calculée
 * (nom d'affichage, sous-requête `dernierPassageLe`) ou colonne potentiellement `NULL`.
 *
 * Partagé par les trois listes de `apps/api/src/clients/**` qui exposent un `tri` fermé :
 * `GET /clients`, `GET /clients/{id}/vehicules`, `GET /clients/{id}/ordres-reparation`.
 */
export interface DefinitionTri {
  /** Expression SQL de la clé de tri — TOUJOURS une constante du code, jamais un fragment construit depuis l'entrée utilisateur. */
  readonly expression: SQL;
  readonly sens: 'asc' | 'desc';
  /**
   * `true` si l'expression peut rendre `NULL` : trie alors `NULLS LAST` (contrat §6.1 — « toute
   * colonne nullable trie avec NULLS LAST documenté »), quel que soit `sens`.
   */
  readonly nullable: boolean;
  /**
   * `true` si `expression` désigne (ou dérive d') une colonne `timestamptz` — `creeLe`,
   * `dernierPassageLe`, `ouvertLe`. La valeur de curseur correspondante DOIT alors transiter par
   * du texte natif PostgreSQL (`::text` en sortie de `SELECT`, via `expressionTriValeur()`
   * ci-dessous) et par `valeurCurseurTimestamptz()` à l'encodage (via `valeurCurseurDepuisTri()`),
   * jamais par un objet `Date` JavaScript : le pilote `pg` rend bien un `timestamptz` en `Date`
   * (mesuré, pas déduit), mais `Date` n'a qu'une résolution MILLISECONDE quand PostgreSQL stocke à
   * la MICROSECONDE — un aller-retour par `Date` tronque silencieusement la valeur de curseur et
   * fait sauter des lignes entières de pagination dès que plusieurs lignes partagent la même
   * milliseconde (voir `common/pagination/valeur-temporelle.ts`). Par défaut `false` : `expression`
   * rend alors une chaîne ou un nombre déjà sans perte possible (nom, numéro…).
   */
  readonly temporel?: boolean;
}

/**
 * Expression de la colonne `triValeur` en sortie de `SELECT` : castée en texte natif PostgreSQL
 * pour une expression temporelle (`::text`, AVANT que le pilote n'ait la moindre chance de la
 * convertir en `Date` et d'en tronquer la microseconde), inchangée sinon.
 */
export function expressionTriValeur(def: DefinitionTri): SQL {
  return def.temporel ? sql`(${def.expression})::text` : def.expression;
}

/**
 * Valeur de curseur à encoder à partir de la `triValeur` brute rendue par la requête. Pour une
 * expression temporelle, la ligne DOIT avoir été sélectionnée via `expressionTriValeur()`
 * ci-dessus (donc être une chaîne texte native PostgreSQL) : `valeurCurseurTimestamptz()` lève
 * délibérément si ce n'est pas le cas, plutôt que de laisser passer un `Date` qui aurait déjà
 * perdu sa microseconde.
 */
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

/**
 * Condition de reprise keyset à partir d'un curseur v2 déjà décodé (`{valeur, id}`).
 *
 * `NULLS LAST`, `valeur !== null` : toute ligne dont l'expression est `NULL` est encore « à
 * venir » (elle n'a pas pu être rendue avant une valeur non nulle) — elle doit donc rester dans
 * le résultat de la page suivante.
 * `NULLS LAST`, `valeur === null` : le curseur précédent s'est arrêté DANS la queue des `NULL`,
 * départagée par id.
 */
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
