import { sql, type SQL } from 'drizzle-orm';
import { decoderCurseurTrie } from './curseur';
import { valeurCurseurTimestamptz } from './valeur-temporelle';

/**
 * Support générique du curseur v2 triable (contrats-api-etape-1.md §6.1) pour les listes qui ne
 * peuvent pas s'exprimer avec le seul query-builder Drizzle : tri sur une expression calculée
 * (nom d'affichage, sous-requête) ou colonne potentiellement `NULL`.
 *
 * FACTORISÉ ICI le 27.08.2026 : cette mécanique existait en cinq copies locales quasi identiques
 * (`clients/`, `pieces/`, `ventes/`, `pneus/`, `facturation/paiements/`), chacune réimplémentant la
 * même comparaison keyset. Un défaut d'opérateur corrigé dans une copie (`clients/`, banc de charge
 * du 27.08.2026 — voir `construireConditionKeyset` ci-dessous) n'a jamais été propagé aux quatre
 * autres, qui l'ont laissé traîner des semaines avant d'être réalignées séparément le même jour :
 * la démonstration empirique du coût de la duplication. `pointage/pagination-pointages.ts` porte
 * encore sa propre copie bespoke (hors périmètre de cette factorisation, voir le rapport associé).
 *
 * Chaque domaine garde sa propre table `DEFINITIONS_TRI_*` (expressions SQL réelles, propres à ses
 * colonnes) — seule la MÉCANIQUE de comparaison est partagée ici. RÈGLE DE SÉCURITÉ NON
 * NÉGOCIABLE : `DefinitionTri.expression` est TOUJOURS une constante du code choisie par
 * l'appelant via un lookup dans une table fermée (`DEFINITIONS_TRI_*`) — jamais un fragment SQL
 * construit depuis l'entrée utilisateur. Les fonctions ci-dessous reçoivent cette expression déjà
 * résolue, elles ne l'inventent ni ne la dérivent d'un paramètre de requête.
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
   * `dernierPassageLe`, `ouvertLe`… La valeur de curseur correspondante DOIT alors transiter par
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
 * départagée par id, DANS LE MÊME SENS que `expr` (`construireOrderBy` applique `${direction}` à
 * `idExpr` aussi, `NULLS LAST` ne change que la position du bloc NULL, jamais l'ordre interne du
 * bloc) — d'où `${operateur}` ici, PAS un opérateur figé.
 *
 * DÉFAUT CORRIGÉ (mesure/revue du 27.08.2026, banc de charge) : cette branche renvoyait autrefois
 * TOUJOURS `${idExpr} < ${id}`, correct seulement quand `operateur` vaut aussi `<` (`sens: 'desc'`)
 * — faux pour `sens: 'asc'` avec `nullable: true` (`ouvertLe:asc`, `plaque:asc`) : la queue NULL
 * d'un tri ASCENDANT continue en `id ASC`, donc `id > curseur.id`, jamais `id < curseur.id`. Avec
 * l'ancien code, reprendre la pagination une fois entré dans la queue NULL rejouait les MÊMES
 * lignes en boucle (`id < curseur.id` répète indéfiniment le même sous-ensemble) au lieu
 * d'avancer. Corrigé une première fois dans `clients/pagination-triee.ts`, puis réappliqué
 * séparément le même jour dans `pieces/`, `ventes/` et `pneus/` — trois copies sur quatre avaient
 * laissé passer le défaut pendant des semaines, faute de source unique. C'est le motif direct de
 * cette factorisation.
 *
 * FORME DE COMPARAISON — ROW (tuple) `(expr, id) OP (valeur, id)`, PAS la forme `OR` explicite
 * (`(expr OP v) OR (expr = v AND id OP id)`) : ÉQUIVALENCE ALGÉBRIQUE EXACTE pour toute paire non
 * nulle — c'est la définition même de la comparaison ROW de PostgreSQL (doc : « the row
 * constructor forms compose using the natural row-comparison semantics, equivalent to
 * a > c OR (a = c AND b > d) »), pas une réécriture approximative. Mesuré (banc de charge du
 * 27.08.2026 puis migration 0073, `apps/api/src/db/migrations/`) : la forme `OR` empêche
 * PostgreSQL de pousser le `LIMIT` à travers un index composite `(tenant_id, expr, id)` — un
 * `Bitmap Heap Scan` réévalue la clause sur QUASIMENT TOUTES les lignes restantes avant de trier,
 * exactement le défaut qui rendait `GET /clients?curseur=…` aussi lent que la première page
 * (`clients-page10`/`page50` à 400-500 ms). La forme ROW, elle, se traduit en un parcours d'index
 * ORDONNÉ avec arrêt anticipé au `LIMIT` — PROUVÉ par comparaison directe ancien/nouveau sur les
 * 9916 clients et les 336 véhicules du client de test réels de `dfa_dev` (zéro écart, zéro
 * doublon, y compris pages frontière/profondes et tris temporels), pas seulement par `EXPLAIN`.
 * `pneus/pagination-triee.ts` était resté sur la forme `OR` malgré cette mesure (comparaison
 * directe faite à l'occasion de cette factorisation) : la migration vers cette fonction commune la
 * corrige au passage.
 *
 * NE S'APPLIQUE JAMAIS À `expr IS NULL` : une comparaison ROW dont un membre est NULL rend
 * `unknown` (jamais `true`), donc EXCLUT structurellement les lignes NULL — exactement le
 * comportement voulu ici (la queue NULL est déjà couverte par `... OR ${expr} IS NULL` séparément,
 * ci-dessous, puis par la branche `valeur === null` ci-dessus une fois qu'on y est).
 */
export function construireConditionKeyset(
  def: DefinitionTri,
  idExpr: SQL,
  valeur: string | number | null,
  id: string,
): SQL {
  const operateur = def.sens === 'asc' ? sql`>` : sql`<`;

  if (valeur === null) {
    return sql`(${def.expression} is null and ${idExpr} ${operateur} ${id})`;
  }

  const suite = sql`(${def.expression}, ${idExpr}) ${operateur} (${valeur}, ${id})`;
  return def.nullable ? sql`(${suite} or ${def.expression} is null)` : suite;
}

/**
 * Décode le curseur de la requête pour le `tri` demandé — `null` si aucun curseur fourni.
 *
 * `definitions` est la table `DEFINITIONS_TRI_*` PROPRE À L'APPELANT : seul l'appelant sait, via
 * `DefinitionTri.temporel`, si le tri demandé porte sur une colonne temporelle — ce module ne fait
 * que router cette information vers `decoderCurseurTrie`, qui porte la validation elle-même
 * (`common/pagination/curseur.ts`, défaut `500 ERREUR_INTERNE` sur curseur forgé déjà corrigé là).
 */
export function decoderCurseurPourTri(
  curseur: string | undefined,
  triDemande: string,
  definitions: Readonly<Record<string, DefinitionTri>>,
): { readonly valeur: string | number | null; readonly id: string } | null {
  if (!curseur) return null;
  const typeValeur = definitions[triDemande]?.temporel ? 'temporel' : 'texte';
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande, typeValeur);
  return { valeur, id };
}
