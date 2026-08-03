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

import { and, eq, inArray, lte } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../../../db';
import { documentVente } from '../../../db/schema';
import { ErreurMetier } from '../../../common/erreurs';

export interface CandidatContinuite {
  readonly id: string;
  readonly typeDocument: 'facture' | 'avoir';
  readonly exercice: number;
  readonly numeroSequence: number;
  readonly numero: string;
}

const STATUTS_COMPTES_POUR_CONTINUITE = ['emis', 'annule_par_avoir'] as const;

export async function verifierContinuiteNumerotation(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  candidats: readonly CandidatContinuite[],
): Promise<void> {
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
          lte(documentVente.numeroSequence, maxSeq),
        ),
      );

    const trous = emisNonExportes.filter((d) => !idsCandidats.has(d.id));
    if (trous.length > 0) {
      const numeros = trous.map((d) => d.numero).filter((n): n is string => n !== null);
      throw new ErreurMetier(
        'EXPORT_TROU_NUMEROTATION',
        `Trou de numérotation détecté sur la série ${typeDocument}/${String(exercice)} avant export : ` +
          `${numeros.join(', ')} — émis, non exportés, et absents de ce lot (hors période ou déjà traités séparément).`,
        {
          detail: `type_document=${typeDocument};exercice=${String(exercice)};numeros=${numeros.join(',')}`,
        },
      );
    }
  }
}
