import { asc, desc, sql, type SQL } from 'drizzle-orm';

import { pointage } from '../db/schema';
import { decoderCurseurTrie, encoderCurseurTrie, valeurCurseurTimestamptz } from '../common/pagination';

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

export function decoderCurseurPointages(curseur: string | undefined, triDemande: string): CurseurPointageDecode | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande);
  if (typeof valeur !== 'string') {
    // `debut_le` est NOT NULL : un curseur légitimement construit par `encoderCurseurTrie` ci-dessous
    // porte toujours une chaîne ici. Une valeur d'un autre type ne peut venir que d'un curseur forgé
    // à la main — `decoderCurseurTrie` a déjà validé la FORME (t/v/i), pas le TYPE attendu par CE
    // domaine ; ce garde-fou local referme ce trou sans dupliquer la validation générique.
    throw new Error("Curseur de pagination pointage : valeur de tri d'un type inattendu pour une colonne NOT NULL.");
  }
  return { valeur, id };
}

/** `ORDER BY debut_le <sens>, id <sens>` — tri total, départagé par id (aucun `NULLS LAST` requis).
 *  Deux termes distincts (`asc`/`desc` de `drizzle-orm`), PAS un unique fragment `sql` composé à la
 *  main : `.orderBy(...)` accepte plusieurs arguments typés, plus sûr qu'un texte pré-joint. */
export function ordreParDebutLe(sens: 'asc' | 'desc'): readonly SQL[] {
  return sens === 'asc' ? [asc(pointage.debutLe), asc(pointage.id)] : [desc(pointage.debutLe), desc(pointage.id)];
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
