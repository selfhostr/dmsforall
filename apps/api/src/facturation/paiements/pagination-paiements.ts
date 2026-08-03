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
 */
export interface DefinitionTriPaiement {
  readonly expression: SQL;
  readonly sens: 'asc' | 'desc';
}

const DEFINITIONS_TRI_PAIEMENTS: Readonly<
  Record<(typeof TRIS_PAIEMENTS)[number], DefinitionTriPaiement>
> = {
  'dateValeur:desc': { expression: sql`p.date_valeur`, sens: 'desc' },
  'dateValeur:asc': { expression: sql`p.date_valeur`, sens: 'asc' },
  'montantNonImputeCentimes:desc': {
    expression: sql`(abs(p.montant_centimes) - coalesce(ri.somme_reglement, 0))`,
    sens: 'desc',
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

/** Décode le curseur de la requête pour le `tri` demandé — `null` si aucun curseur fourni. */
export function decoderCurseurPourTriPaiement(
  curseur: string | undefined,
  triDemande: string,
): { readonly valeur: string | number | null; readonly id: string } | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, triDemande);
  return { valeur, id };
}

export { encoderCurseurTrie };
