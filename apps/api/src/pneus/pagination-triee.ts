import { sql, type SQL } from 'drizzle-orm';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';

import { ErreurMetier } from '../common/erreurs';

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
 * DÉFAUT CORRIGÉ (constaté en exécution réelle, `500 ERREUR_INTERNE`, non reproduit par les tests
 * d'intégration existants) : `decoderCurseurTrie()` valide la FORME du curseur v2 (`t`/`v`/`i`
 * présents, `t` égal au tri demandé, `i` un uuid) mais PAS le contenu de `v` au-delà de
 * `typeof v === 'string' | 'number' | null` — voir `estValeurTriValide()`, `common/pagination/
 * curseur.ts`. Tous les tris de ce module portent sur une colonne `timestamptz`
 * (`DEFINITIONS_TRI_*` ci-dessous, `temporel: true` partout) : un curseur syntaxiquement valide
 * (forme v2 correcte, tri correspondant, uuid valide) mais dont `v` n'est PAS le texte natif
 * PostgreSQL d'un timestamptz — un nombre, ou une chaîne quelconque — passe ce premier contrôle
 * sans erreur, puis atteint `construireConditionKeyset()` telle quelle : elle devient un littéral
 * injecté tel quel dans la clause `WHERE` (`d.dernier_mouvement_le < '<valeur>'`). PostgreSQL lève
 * alors une erreur NATIVE (`22007 invalid_datetime_format` ou équivalent) au moment de l'exécution
 * de la requête — une erreur qui n'est interceptée nulle part dans `ServiceDepotPneus` (aucun
 * `catch` ne la reconnaît, contrairement à `estViolationUniciteActif`/`estViolationFk`) et remonte
 * donc telle quelle jusqu'au filtre d'exception global, qui la traduit en `500 ERREUR_INTERNE`
 * anonyme au lieu d'un `400 VALIDATION_ECHOUEE` imputable au client qui a fourni ce curseur.
 *
 * Pourquoi les 19 tests d'intégration existants ne l'ont pas vu : ils exercent tous des curseurs
 * soit ABSENTS, soit ENCODÉS PAR LE SERVEUR lui-même (`encoderCurseurTrie()` à partir d'une
 * `triValeur` déjà passée par `expressionTriValeur()`, donc déjà un texte PostgreSQL valide et
 * déjà validé par `valeurCurseurTimestamptz()` côté encodage, voir `valeurCurseurDepuisTri()`
 * ci-dessous) — jamais un curseur FORGÉ avec une valeur arbitraire dans le champ `v`, qui est
 * pourtant exactement ce qu'un client hostile, un bookmark périmé ou un bug côté appelant peut
 * envoyer. Le piège de pagination documenté dans `valeur-temporelle.ts` (deux lignes à la même
 * microseconde) est une classe de défaut DIFFÉRENTE : celui-là corrompt une valeur produite par le
 * SERVEUR ; celui-ci vient d'une valeur fournie par le CLIENT et jamais revalidée.
 *
 * Correction : revalider `valeur` ICI, au même format que celui qu'exige `valeurCurseurTimestamptz`
 * pour l'ENCODAGE — avant qu'elle n'atteigne la moindre requête SQL. Un rejet produit
 * `400 VALIDATION_ECHOUEE`, exactement ce que produit déjà `decoderCurseurTrie()` pour un curseur
 * malformé — le contrat côté client ne change pas, seul le classement d'un cas auparavant non
 * couvert passe de 500 à 400. */
export function decoderCurseurPourTri(
  curseur: string | undefined,
  triDemande: string,
): { readonly valeur: string | number | null; readonly id: string } | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande);
  validerValeurCurseurTemporelle(valeur);
  return { valeur, id };
}

/**
 * Toutes les définitions de tri de ce module (`DEFINITIONS_TRI_HANGAR/VEHICULE/RELANCE`,
 * `service-depot-pneus.ts`) sont `temporel: true` — aucun tri numérique n'existe côté pneus. La
 * valeur de curseur, si elle n'est pas `null` (colonne non nullable en pratique, mais un curseur
 * FORGÉ peut prétendre le contraire sans risque : voir la branche `valeur === null` de
 * `construireConditionKeyset`, qui ne rend simplement aucune ligne), DOIT donc être le texte natif
 * PostgreSQL d'un `timestamptz` — exactement ce que valide `valeurCurseurTimestamptz`. Un nombre
 * est rejeté directement (aucun tri temporel n'accepte une valeur numérique).
 */
function validerValeurCurseurTemporelle(valeur: string | number | null): void {
  if (valeur === null) return;
  if (typeof valeur === 'string') {
    try {
      valeurCurseurTimestamptz(valeur);
      return;
    } catch {
      // Tombe dans le rejet commun ci-dessous — même code/statut que `decoderCurseurTrie()`.
    }
  }
  throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
    erreurs: [
      { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
    ],
  });
}

export { encoderCurseurTrie };
