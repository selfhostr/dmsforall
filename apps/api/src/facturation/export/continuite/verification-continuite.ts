/**
 * Continuité de numérotation AVANT export (RF-28, RF-105, `packages/shared/…/export.ts` en tête
 * de `schemaLancerExport` : « vérifiée AVANT l'appel à l'adaptateur, de façon BLOQUANTE… un trou ne
 * part jamais chez la fiduciaire »). Vérifiée PAR SÉRIE — `(tenant, type_document, exercice)`,
 * exactement la granularité de `compteur_document` (MD-26) : une série `facture` et une série
 * `avoir` sont indépendantes, un trou dans l'une n'empêche pas d'exporter l'autre.
 *
 * Ce que « trou » veut dire ICI, précisément : parmi les documents déjà ÉMIS de cette série dont
 * le `numeroSequence` est ≤ au plus grand numéro du lot candidat, TOUS doivent être soit déjà
 * exportés (`exporte_le` non nul, un lot antérieur), soit présents dans CE lot. Un document émis
 * non exporté et ABSENT du lot (parce qu'il tombe hors de la période demandée, par exemple) est un
 * trou : l'exporter plus tard casserait l'ordre chronologique de transmission à la fiduciaire.
 *
 * `annule_par_avoir` compte comme "émis" pour cette vérification (RF-32 : une facture annulée
 * garde sa place dans la série et doit donc, elle aussi, finir par être exportée une fois).
 */

import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../../../db';
import { documentVente } from '../../../db/schema';

export interface CandidatContinuite {
  readonly id: string;
  readonly typeDocument: 'facture' | 'avoir';
  readonly exercice: number;
  readonly numeroSequence: number;
  readonly numero: string;
}

const STATUTS_COMPTES_POUR_CONTINUITE = ['emis', 'annule_par_avoir'] as const;

/** Une série `(type, exercice)` où des documents émis, non exportés, manquent au lot. */
export interface TrouDetecte {
  readonly typeDocument: 'facture' | 'avoir';
  readonly exercice: number;
  readonly documents: readonly { readonly id: string; readonly numero: string }[];
}

/**
 * Trous de numérotation du lot candidat, SANS rien lever (aperçu ET déclenchement).
 *
 * Un document est « absent du lot » s'il est émis, d'un numéro ≤ au plus grand du lot, jamais
 * exporté (`exporte_le is null` — un document déjà parti dans un lot antérieur n'est pas un trou,
 * sans quoi le deuxième export mensuel échouerait toujours) et exportable par cet adaptateur
 * (CHF : un document en devise étrangère n'est jamais candidat, le compter bloquerait l'export
 * à vie sans issue possible).
 */
export async function trouverTrousNumerotation(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  candidats: readonly CandidatContinuite[],
): Promise<readonly TrouDetecte[]> {
  const idsCandidats = new Set(candidats.map((c) => c.id));

  const series = new Map<
    string,
    { typeDocument: 'facture' | 'avoir'; exercice: number; maxSeq: number }
  >();
  for (const c of candidats) {
    const cle = `${c.typeDocument}::${String(c.exercice)}`;
    const existante = series.get(cle);
    if (!existante || c.numeroSequence > existante.maxSeq) {
      series.set(cle, {
        typeDocument: c.typeDocument,
        exercice: c.exercice,
        maxSeq: c.numeroSequence,
      });
    }
  }

  const trous: TrouDetecte[] = [];
  for (const { typeDocument, exercice, maxSeq } of series.values()) {
    const emisNonExportes = await tx
      .select({
        id: documentVente.id,
        numero: documentVente.numero,
        numeroSequence: documentVente.numeroSequence,
      })
      .from(documentVente)
      .where(
        and(
          eq(documentVente.tenantId, ctx.tenantId),
          eq(documentVente.typeDocument, typeDocument),
          eq(documentVente.exercice, exercice),
          inArray(documentVente.statut, [...STATUTS_COMPTES_POUR_CONTINUITE]),
          isNull(documentVente.exporteLe),
          eq(documentVente.devise, 'CHF'),
          lte(documentVente.numeroSequence, maxSeq),
        ),
      )
      .orderBy(asc(documentVente.numeroSequence));

    const documents = emisNonExportes
      .filter((d) => !idsCandidats.has(d.id))
      .flatMap((d) => (d.numero === null ? [] : [{ id: d.id, numero: d.numero }]));
    if (documents.length > 0) trous.push({ typeDocument, exercice, documents });
  }
  return trous;
}

export function decrireTrous(trous: readonly TrouDetecte[]): string {
  return trous
    .map(
      (t) =>
        `série ${t.typeDocument}/${String(t.exercice)} : ${t.documents.map((d) => d.numero).join(', ')}`,
    )
    .join(' ; ');
}
