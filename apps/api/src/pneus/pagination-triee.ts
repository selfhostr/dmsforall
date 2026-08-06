import { sql, type SQL } from 'drizzle-orm';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';

/**
 * Support générique du curseur v2 triable (contrats-api-etape-1.md §6.1) pour les listes qui ne
 * s'expriment pas avec le seul query-builder Drizzle : tri sur colonne potentiellement NULL, ou
 * calculée.
 *
 * Copie module-locale de `apps/api/src/pieces/pagination-triee.ts` — même doctrine que cette
 * dernière (voir son en-tête) : chaque domaine compose son propre tri sur les primitives
 * partagées de `common/pagination/` (`curseur.ts`, `valeur-temporelle.ts`), pas de module
 * transverse réimporté entre domaines disjoints (`pieces/` n'est pas dans le périmètre de cet
 * agent, et l'inverse n'est pas souhaitable : deux propriétaires sur le même fichier).
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

/** Décode le curseur de la requête pour le `tri` demandé — `null` si aucun curseur fourni.
 *
 * DÉFAUT CORRIGÉ ICI EN PREMIER (constaté en exécution réelle, `500 ERREUR_INTERNE`, non
 * reproduit par les tests d'intégration existants), depuis généralisé dans
 * `common/pagination/curseur.ts` et adopté par `clients/`, `pieces/`, `ventes/` :
 * `decoderCurseurTrie()` valide la FORME du curseur v2 (`t`/`v`/`i` présents, `t` égal au tri
 * demandé, `i` un uuid) mais, sans le paramètre `typeValeur`, pas le CONTENU de `v` au-delà de
 * `typeof v === 'string' | 'number' | null`. Un curseur syntaxiquement valide (forme v2 correcte,
 * tri correspondant, uuid valide) mais dont `v` n'est pas le texte natif PostgreSQL d'un
 * timestamptz — un nombre, ou une chaîne quelconque — passait alors ce premier contrôle sans
 * erreur, puis atteignait `construireConditionKeyset()` telle quelle : un littéral injecté tel
 * quel dans la clause `WHERE` (`d.dernier_mouvement_le < '<valeur>'`). PostgreSQL levait une erreur
 * NATIVE (`22007 invalid_datetime_format`) non interceptée par `ServiceDepotPneus`, remontant en
 * `500 ERREUR_INTERNE` anonyme au lieu d'un `400 VALIDATION_ECHOUEE` imputable au client.
 *
 * Correction adoptée : `decoderCurseurTrie()` porte désormais elle-même cette validation de
 * contenu via son 3ᵉ paramètre `typeValeur` (voir `common/pagination/curseur.ts`,
 * `validerContenuValeur`). Tous les tris de ce module portent sur une colonne `timestamptz`
 * (`DEFINITIONS_TRI_HANGAR/VEHICULE/RELANCE`, `service-depot-pneus.ts` — `temporel: true`
 * partout, aucun tri numérique côté pneus) : `'temporel'` peut donc être passé directement, sans
 * détour par une table `definitions` comme le font `pieces/`/`ventes/` (qui, eux, mélangent des
 * tris temporels et non temporels). Le contrat côté client ne change pas : un rejet produit
 * toujours `400 VALIDATION_ECHOUEE`, exactement ce que produisait déjà la réimplémentation locale
 * ci-dessus — seul le CHEMIN change. */
export function decoderCurseurPourTri(
  curseur: string | undefined,
  triDemande: string,
): { readonly valeur: string | number | null; readonly id: string } | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande, 'temporel');
  return { valeur, id };
}

export { encoderCurseurTrie };
