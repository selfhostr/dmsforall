import { sql, type SQL } from 'drizzle-orm';
import { TRIS_PAIEMENTS, type FiltresPaiements } from '@dfa/shared';

import { decoderCurseurTrie, encoderCurseurTrie } from '../../common/pagination';
import { ErreurMetier } from '../../common/erreurs';

/**
 * Support du curseur v2 triable pour `GET /paiements`, sur le même principe que
 * `apps/api/src/clients/pagination-triee.ts` (dupliqué plutôt qu'importé : deux périmètres
 * d'agents distincts, aucune dépendance `facturation/ → clients/` dans ce dépôt — voir le rapport
 * de livraison). Seules les primitives réellement génériques (`decoderCurseurTrie`/
 * `encoderCurseurTrie`, `common/pagination`) sont réutilisées : elles sont explicitement conçues
 * pour l'être.
 *
 * Aucun des trois tris de `TRIS_PAIEMENTS` n'est nullable (`date_valeur` est `not null` ; l'écart
 * non imputé est une expression `coalesce(...)`), donc pas de `NULLS LAST` à gérer ici — plus
 * simple que la version clients.
 *
 * VALIDATION DE CONTENU DU CURSEUR — AXE LOCAL, PAS `typeValeur: 'temporel'` DE
 * `common/pagination/curseur.ts` : contrairement à `clients/`/`vehicules/`/`socle/`/`pneus/`/
 * `parametrage/`/`pointage/`, AUCUN des tris de ce module ne porte sur une colonne `timestamptz` —
 *   - `date_valeur` est une colonne `date` (granularité JOUR, `db/schema/facturation/paiement.ts`,
 *     `migrations/0010_facturation.sql`) : le pilote `pg`, en configuration par défaut, la parse
 *     déjà en `Date` JS AVANT même que `service-paiement.ts` s'exécute (`pg-types` enregistre son
 *     parseur sur l'OID 1082 « date » comme sur les `timestamptz` — mesuré dans les sources de
 *     `pg-types`, pas déduit). `valeurCurseurBrute()` (`service-paiement.ts`) rend donc ce `Date`
 *     tel quel, et `encoderCurseurTrie` l'encode via `JSON.stringify` → `Date.prototype.toJSON`,
 *     soit un ISO complet à minuit UTC (`"2026-07-29T00:00:00.000Z"`), PAS le texte natif
 *     PostgreSQL `"2026-07-29"` qu'on pourrait attendre. `valeurCurseurTimestamptz()` (le
 *     mécanisme `'temporel'`) exige une composante horaire ET refuse tout ce qui n'est pas déjà le
 *     texte natif PostgreSQL d'un `timestamptz` : l'utiliser ici rejetterait donc les curseurs
 *     RÉELLEMENT produits par ce module — un mécanisme conçu pour un piège de précision
 *     (microseconde `timestamptz` vs milliseconde `Date`) ne s'applique pas tel quel à une colonne
 *     `date`, qui n'a pas cette précision à préserver ;
 *   - `montantNonImputeCentimes` est une expression numérique (`abs(...) - coalesce(...)`), jamais
 *     une date : hors du périmètre de `'temporel'` par construction.
 * Le risque réel n'est donc pas la perte de précision (`common/pagination/valeur-temporelle.ts`)
 * mais le MÊME défaut de fond que celui déjà corrigé ailleurs, décliné sur deux natures de
 * colonnes distinctes : un curseur v2 syntaxiquement valide (forme `{t,v,i}` correcte) dont `v`
 * n'est pas un contenu compatible avec la colonne triée traverse le décodage générique intact et
 * atteint PostgreSQL, qui lève une erreur native non interceptée —
 *   - `dateValeur:*` : une chaîne qui n'est pas une date/date-heure ISO valide → `22007`/`22008` ;
 *   - `montantNonImputeCentimes:desc` : une valeur qui n'est pas un NOMBRE (une chaîne, même
 *     d'apparence numérique — JSON distingue `"42"` de `42`) → `22P02`, comparant l'expression
 *     numérique à une chaîne.
 * `validerContenuValeurPaiement` ci-dessous referme ce trou, LOCALEMENT à ce module — `'texte' |
 * 'temporel'` (`common/pagination/curseur.ts`, hors périmètre d'écriture de cet agent) ne suffit
 * pas à distinguer ces deux natures ; l'étendre serait le bon geste à terme (un troisième membre
 * `'numerique'`, ou un type discriminé par nature de colonne plutôt que par seul risque de
 * précision), mais reste une décision pour le propriétaire de `common/pagination/`, pas improvisée
 * ici sur un fichier interdit.
 * `null` reste toujours accepté (même doctrine défensive que `common/pagination/curseur.ts`) :
 * aucun des trois tris n'est nullable en pratique, mais un curseur forgé prétendant `null` ne
 * cause aucun risque ici — `construireConditionKeysetPaiement` ne gère pas de branche NULLS LAST,
 * la comparaison `expression > NULL` est simplement toujours indéterminée (aucune ligne ne
 * matche), jamais une erreur SQL.
 */
export interface DefinitionTriPaiement {
  readonly expression: SQL;
  readonly sens: 'asc' | 'desc';
  /** Nature du CONTENU attendu de la valeur de curseur pour ce tri — voir l'en-tête de ce fichier. */
  readonly natureValeur: 'date' | 'numerique';
}

const DEFINITIONS_TRI_PAIEMENTS: Readonly<
  Record<(typeof TRIS_PAIEMENTS)[number], DefinitionTriPaiement>
> = {
  'dateValeur:desc': { expression: sql`p.date_valeur`, sens: 'desc', natureValeur: 'date' },
  'dateValeur:asc': { expression: sql`p.date_valeur`, sens: 'asc', natureValeur: 'date' },
  'montantNonImputeCentimes:desc': {
    expression: sql`(abs(p.montant_centimes) - coalesce(ri.somme_reglement, 0))`,
    sens: 'desc',
    natureValeur: 'numerique',
  },
};

export function definitionTriPaiement(tri: FiltresPaiements['tri']): DefinitionTriPaiement {
  const definition = DEFINITIONS_TRI_PAIEMENTS[tri];
  if (!definition) {
    throw new ErreurMetier('VALIDATION_ECHOUEE', `Tri "${tri}" inconnu pour /paiements.`, {
      erreurs: [{ champ: 'tri', code: 'tri_inconnu', message: 'Valeur de tri non supportée.' }],
    });
  }
  return definition;
}

/**
 * Date ou date-heure ISO-8601 — accepte à la fois le texte natif PostgreSQL d'une colonne `date`
 * (`"2026-07-29"`, au cas où un appelant futur caste explicitement en `::text`) et la forme
 * RÉELLEMENT produite aujourd'hui par `valeurCurseurBrute()` via `Date.prototype.toJSON`
 * (`"2026-07-29T00:00:00.000Z"`, voir l'en-tête de ce fichier) — jamais un fragment de date
 * partiel ou une chaîne arbitraire.
 */
const FORMAT_DATE_OU_DATETIME_ISO =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function erreurCurseurInvalide(): ErreurMetier {
  return new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
    erreurs: [
      { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
    ],
  });
}

/**
 * Valide le CONTENU (pas seulement la forme, déjà vérifiée par `decoderCurseurTrie`) de `valeur`
 * pour la nature portée par `definition` — voir l'en-tête de ce fichier pour la justification
 * complète de cet axe local. Lève `VALIDATION_ECHOUEE` (400) plutôt que de laisser une valeur
 * incompatible atteindre la requête SQL de `service-paiement.ts::lister`.
 */
function validerContenuValeurPaiement(
  definition: DefinitionTriPaiement,
  valeur: string | number | null,
): void {
  if (valeur === null) return;

  if (definition.natureValeur === 'numerique') {
    if (typeof valeur === 'number' && Number.isFinite(valeur)) return;
    throw erreurCurseurInvalide();
  }

  // `definition.natureValeur === 'date'`
  if (
    typeof valeur === 'string' &&
    FORMAT_DATE_OU_DATETIME_ISO.test(valeur) &&
    !Number.isNaN(Date.parse(valeur))
  ) {
    return;
  }
  throw erreurCurseurInvalide();
}

export function construireOrderByPaiement(def: DefinitionTriPaiement): SQL {
  const direction = def.sens === 'asc' ? sql`asc` : sql`desc`;
  return sql`${def.expression} ${direction}, p.id ${direction}`;
}

export function construireConditionKeysetPaiement(
  def: DefinitionTriPaiement,
  valeur: string | number | null,
  id: string,
): SQL {
  const operateur = def.sens === 'asc' ? sql`>` : sql`<`;
  return sql`((${def.expression} ${operateur} ${valeur}) or (${def.expression} = ${valeur} and p.id ${operateur} ${id}))`;
}

/**
 * Décode le curseur de la requête pour le `tri` demandé — `null` si aucun curseur fourni.
 *
 * `triDemande` typé `FiltresPaiements['tri']` (pas `string` générique) : ce module ne connaît que
 * les trois tris de `TRIS_PAIEMENTS`, `definitionTriPaiement` lève déjà `VALIDATION_ECHOUEE` sinon
 * — la validation de contenu ci-dessous peut donc s'appuyer sans garde supplémentaire sur la
 * `DefinitionTriPaiement` retournée.
 */
export function decoderCurseurPourTriPaiement(
  curseur: string | undefined,
  triDemande: FiltresPaiements['tri'],
): { readonly valeur: string | number | null; readonly id: string } | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande);
  validerContenuValeurPaiement(definitionTriPaiement(triDemande), valeur);
  return { valeur, id };
}

export { encoderCurseurTrie };
