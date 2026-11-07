import { sql, type SQL } from 'drizzle-orm';
import type { FiltresDocumentsVente } from '@dfa/shared';

import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  erreurCurseurInvalide,
  valeurCurseurTimestamptz,
} from '../../common/pagination';
import { documentVente } from '../../db/schema';

/**
 * Pagination keyset de `GET /documents-vente` — remplace l'ancien curseur d'offset déguisé
 * (`.offset(n)` : coût linéaire en la profondeur de page, et page qui saute ou répète une ligne si
 * un document est créé entre deux requêtes).
 *
 * POURQUOI PAS `common/pagination/keyset.ts` tel quel : l'ordre historique de cette liste est
 * `(date_document desc, cree_le desc)`. `date_document` est une DATE (des dizaines de factures par
 * jour) : le départage par `id` seul (UUID aléatoire) ferait perdre « les plus récentes d'abord à
 * l'intérieur d'une journée ». Le tri total est donc `(clé, cree_le, id)`, tous dans le MÊME sens.
 * Le curseur reste l'enveloppe v2 opaque `{t, v, i}` de `common/pagination` ; `v` porte
 * `"<clé>|<cree_le>"` (clé vide = `NULL`, rangé en dernier — contrat §6.1, `NULLS LAST` dans les
 * deux sens).
 *
 * `numeroSequence`, `soldeCentimes` et `relanceLe` étaient ACCEPTÉS par le contrat mais jamais
 * appliqués (la liste triait toujours par date) : ils le sont désormais.
 *
 * SÉCURITÉ : `colonne`/`texte` sont des constantes du code choisies dans une table fermée selon un
 * `tri` déjà validé par zod — jamais un fragment construit depuis l'entrée utilisateur. Les valeurs
 * de curseur, elles, sont toujours liées en paramètres ET validées en forme avant usage (un curseur
 * forgé rend 400, jamais une erreur PostgreSQL 500).
 */
type TypeCle = 'date' | 'entier' | 'horodatage';

interface DefinitionTriDocument {
  readonly colonne: SQL;
  /** Même expression rendue en texte natif PostgreSQL (jamais `Date`/`number` du pilote). */
  readonly texte: SQL;
  readonly sens: 'asc' | 'desc';
  readonly type: TypeCle;
}

const DATE = documentVente.dateDocument;
const NUMERO = documentVente.numeroSequence;
const SOLDE = documentVente.soldeCentimes;
const RELANCE = documentVente.relanceLe;

export const DEFINITIONS_TRI_DOCUMENTS: Readonly<
  Record<FiltresDocumentsVente['tri'], DefinitionTriDocument>
> = {
  'dateDocument:desc': {
    colonne: sql`${DATE}`,
    texte: sql`${DATE}::text`,
    sens: 'desc',
    type: 'date',
  },
  'dateDocument:asc': {
    colonne: sql`${DATE}`,
    texte: sql`${DATE}::text`,
    sens: 'asc',
    type: 'date',
  },
  'numeroSequence:desc': {
    colonne: sql`${NUMERO}`,
    texte: sql`${NUMERO}::text`,
    sens: 'desc',
    type: 'entier',
  },
  'numeroSequence:asc': {
    colonne: sql`${NUMERO}`,
    texte: sql`${NUMERO}::text`,
    sens: 'asc',
    type: 'entier',
  },
  'soldeCentimes:desc': {
    colonne: sql`${SOLDE}`,
    texte: sql`${SOLDE}::text`,
    sens: 'desc',
    type: 'entier',
  },
  'relanceLe:asc': {
    colonne: sql`${RELANCE}`,
    texte: sql`${RELANCE}::text`,
    sens: 'asc',
    type: 'horodatage',
  },
};

/** `ORDER BY clé <sens> NULLS LAST, cree_le <sens>, id <sens>` — tri total. */
export function ordreDocuments(tri: FiltresDocumentsVente['tri']): SQL {
  const def = DEFINITIONS_TRI_DOCUMENTS[tri];
  const dir = def.sens === 'asc' ? sql`asc` : sql`desc`;
  return sql`${def.colonne} ${dir} nulls last, ${documentVente.creeLe} ${dir}, ${documentVente.id} ${dir}`;
}

/** Colonnes à ajouter au `SELECT` pour pouvoir encoder le curseur sans perte de précision. */
export function colonnesCurseurDocuments(tri: FiltresDocumentsVente['tri']): {
  cle: SQL<string | null>;
  creeLeTexte: SQL<string>;
} {
  const def = DEFINITIONS_TRI_DOCUMENTS[tri];
  return {
    cle: sql<string | null>`${def.texte}`,
    creeLeTexte: sql<string>`${documentVente.creeLe}::text`,
  };
}

interface CurseurDocumentDecode {
  readonly cle: string | null;
  readonly creeLe: string;
  readonly id: string;
}

const FORME_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORME_ENTIER = /^-?\d{1,18}$/;

function cleValide(cle: string, type: TypeCle): boolean {
  if (type === 'date') return FORME_DATE.test(cle) && !Number.isNaN(Date.parse(`${cle}T00:00:00Z`));
  if (type === 'entier') return FORME_ENTIER.test(cle);
  try {
    valeurCurseurTimestamptz(cle);
    return true;
  } catch {
    return false;
  }
}

/** Décode et VALIDE le curseur (forme ET fond) — `undefined` en entrée = première page. */
export function decoderCurseurDocuments(
  curseur: string | undefined,
  tri: FiltresDocumentsVente['tri'],
): CurseurDocumentDecode | null {
  if (!curseur) return null;
  const { valeur, id } = decoderCurseurTrie(curseur, tri);
  if (typeof valeur !== 'string') throw erreurCurseurInvalide();
  const separateur = valeur.indexOf('|');
  if (separateur < 0) throw erreurCurseurInvalide();
  const cleBrute = valeur.slice(0, separateur);
  const creeLeBrut = valeur.slice(separateur + 1);
  const type = DEFINITIONS_TRI_DOCUMENTS[tri].type;
  if (cleBrute !== '' && !cleValide(cleBrute, type)) throw erreurCurseurInvalide();
  let creeLe: string;
  try {
    creeLe = valeurCurseurTimestamptz(creeLeBrut);
  } catch {
    throw erreurCurseurInvalide();
  }
  return { cle: cleBrute === '' ? null : cleBrute, creeLe, id };
}

export function encoderCurseurDocuments(
  tri: FiltresDocumentsVente['tri'],
  ligne: { readonly id: string; readonly cle: string | null; readonly creeLeTexte: string },
): string {
  return encoderCurseurTrie({
    tri,
    valeur: `${ligne.cle ?? ''}|${valeurCurseurTimestamptz(ligne.creeLeTexte)}`,
    id: ligne.id,
  });
}

/**
 * Reprise après le curseur. Comparaison ROW `(clé, cree_le, id) OP (…)` (parcours d'index ordonné
 * avec arrêt au `LIMIT`, même raison que `construireConditionKeyset`) ; la queue `NULL` (déjà
 * entamée ou encore à venir) est traitée à part. Une clé `NULL` n'entre jamais dans la comparaison
 * ROW (elle rendrait `unknown`).
 */
export function conditionReprise(
  tri: FiltresDocumentsVente['tri'],
  curseur: CurseurDocumentDecode,
): SQL {
  const def = DEFINITIONS_TRI_DOCUMENTS[tri];
  const op = def.sens === 'asc' ? sql`>` : sql`<`;
  if (curseur.cle === null) {
    return sql`(${def.colonne} is null and (${documentVente.creeLe}, ${documentVente.id}) ${op} (${curseur.creeLe}::timestamptz, ${curseur.id}::uuid))`;
  }
  return sql`((${def.colonne}, ${documentVente.creeLe}, ${documentVente.id}) ${op} (${curseur.cle}::${castCle(def.type)}, ${curseur.creeLe}::timestamptz, ${curseur.id}::uuid) or ${def.colonne} is null)`;
}

function castCle(type: TypeCle): SQL {
  if (type === 'date') return sql`date`;
  if (type === 'entier') return sql`bigint`;
  return sql`timestamptz`;
}
