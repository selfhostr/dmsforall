import { asc, desc, sql, type SQL } from 'drizzle-orm';

import { pointage } from '../db/schema';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';
import { ErreurMetier } from '../common/erreurs';

/**
 * Support du curseur v2 triable (§6.1) pour `GET /pointages` — copie locale volontaire, MÊME
 * DOCTRINE que `clients/pagination-triee.ts`, `pieces/pagination-triee.ts`,
 * `facturation/paiements/pagination-paiements.ts` (pas de fichier partagé entre modules
 * d'experts parallèles, seuls les bas niveaux de `common/pagination` sont mutualisés).
 *
 * SIMPLIFIÉ par rapport à `clients/pagination-triee.ts` : `TRIS_POINTAGES` (`contrats/pointage/
 * pointage.ts`) n'expose qu'UN SEUL champ triable, `debutLe` (`pointage.debut_le`), qui est
 * `NOT NULL` — aucune gestion `NULLS LAST` à prévoir, à la différence des colonnes nullable de
 * `clients/`.
 *
 * `pointage.debut_le` est un `timestamptz` : la valeur de curseur DOIT transiter par le texte natif
 * PostgreSQL (`::text`), jamais par un `Date` JavaScript — le pilote `pg` rend un `timestamptz` en
 * `Date` (résolution milliseconde) alors que Postgres stocke à la microseconde ; un aller-retour par
 * `Date` ferait sauter des lignes de pagination dès que deux pointages partagent la même
 * milliseconde — CAS NOMINAL ICI (une synchronisation hors ligne en lot insère plusieurs pointages
 * dans le même appel réseau). Voir `common/pagination/valeur-temporelle.ts`.
 */

export interface CurseurPointageDecode {
  readonly valeur: string;
  readonly id: string;
}

/**
 * DEUX DÉFAUTS CORRIGÉS ICI :
 *
 * 1. (même classe que `common/pagination/curseur.ts`, déjà corrigé dans `clients/`, `vehicules/`,
 *    `socle/`, `pneus/`) — `debut_le` est un `timestamptz` (voir `conditionKeysetPointage`
 *    ci-dessous, qui caste `valeur::timestamptz` dans la clause `WHERE`) : un curseur
 *    syntaxiquement valide dont la valeur n'était pas un horodatage PostgreSQL bien formé
 *    traversait ce décodage intact et atteignait PostgreSQL, qui levait `22007` — non intercepté,
 *    `500` sur une simple liste de pointages. `typeValeur: 'temporel'` ferme ce trou au décodage.
 *
 * 2. Le garde-fou local ci-dessous (type de `valeur` inattendu pour une colonne `NOT NULL`) levait
 *    une `Error` générique plutôt qu'une `ErreurMetier` — un curseur forgé avec une valeur d'un
 *    type inattendu (numérique/`null` sur un tri qui n'admet que du texte) produisait donc, lui
 *    aussi, un `500 ERREUR_INTERNE` non mappé, alors qu'il s'agit exactement de la même classe de
 *    donnée cliente malformée que le reste de ce module traite en `400 VALIDATION_ECHOUEE`.
 */
export function decoderCurseurPointages(
  curseur: string | undefined,
  triDemande: string,
): CurseurPointageDecode | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande, 'temporel');
  if (typeof valeur !== 'string') {
    // `debut_le` est NOT NULL : un curseur légitimement construit par `encoderCurseurTrie` ci-dessous
    // porte toujours une chaîne ici. Une valeur d'un autre type ne peut venir que d'un curseur forgé
    // à la main — `decoderCurseurTrie` a déjà validé la FORME (t/v/i) et, avec `'temporel'` ci-dessus,
    // le CONTENU d'une chaîne le cas échéant ; ce garde-fou local referme le dernier trou (un `null`
    // ou un nombre, valides pour `decoderCurseurTrie` en général, ne le sont pas pour CE domaine, où
    // la colonne est `NOT NULL`) sans dupliquer la validation générique.
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return { valeur, id };
}

/** `ORDER BY debut_le <sens>, id <sens>` — tri total, départagé par id (aucun `NULLS LAST` requis).
 *  Deux termes distincts (`asc`/`desc` de `drizzle-orm`), PAS un unique fragment `sql` composé à la
 *  main : `.orderBy(...)` accepte plusieurs arguments typés, plus sûr qu'un texte pré-joint. */
export function ordreParDebutLe(sens: 'asc' | 'desc'): readonly SQL[] {
  return sens === 'asc'
    ? [asc(pointage.debutLe), asc(pointage.id)]
    : [desc(pointage.debutLe), desc(pointage.id)];
}

/** Condition de reprise keyset — `valeur` est le texte natif PostgreSQL rendu par `expressionTriValeurPointage`. */
export function conditionKeysetPointage(sens: 'asc' | 'desc', valeur: string, id: string): SQL {
  const operateur = sens === 'asc' ? sql`>` : sql`<`;
  return sql`((${pointage.debutLe} ${operateur} ${valeur}::timestamptz) or (${pointage.debutLe} = ${valeur}::timestamptz and ${pointage.id} ${operateur} ${id}))`;
}

/** Expression de `debutLe` en sortie de `SELECT`, castée en texte natif AVANT que le pilote n'ait la
 *  moindre chance de la convertir en `Date` (voir l'en-tête de ce fichier). */
export const expressionTriValeurPointage = sql<string>`(${pointage.debutLe})::text`;

export function valeurCurseurDepuisTriPointage(triValeur: string): string {
  return valeurCurseurTimestamptz(triValeur);
}

export { encoderCurseurTrie };
