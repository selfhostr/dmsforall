/**
 * Chargement du plan comptable du tenant (`mapping_compte`, `mapping_code_tva` — MD-86) depuis la
 * base, un par date comptable distincte rencontrée dans le lot à exporter. Requêtes typées
 * Drizzle, même patron que `facturation/documents/document-requetes.ts` : rescoping explicite sur
 * `tenant_id` en plus du RLS.
 */

import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { CibleExport } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../../db';
import { mappingCodeTva, mappingCompte } from '../../../db/schema';
import { ComptesResolusADate, indexerCodesTva, indexerComptes } from '../ecritures/comptes-resolus';

/**
 * `mapping_compte` actif à `dateComptable` (`actif_du <= date < actif_au`, borne haute exclusive —
 * `mapping_compte_periode_excl`, migration 0010 §13.3). `mapping_code_tva` n'est PAS versionné par
 * date (une seule ligne par `(tenant, cible, régime, taux)`) — chargé une fois, indépendamment de
 * la date, et réutilisé pour toutes les dates du lot.
 */
export async function chargerComptesResolusADate(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  cible: CibleExport,
  dateComptable: string,
  codesTvaDejaCharges?: ReadonlyMap<string, string>,
): Promise<ComptesResolusADate> {
  const lignesComptes = await tx
    .select({
      usage: mappingCompte.usage,
      categorie: mappingCompte.categorie,
      compte: mappingCompte.compte,
    })
    .from(mappingCompte)
    .where(
      and(
        eq(mappingCompte.tenantId, ctx.tenantId),
        lte(mappingCompte.actifDu, dateComptable),
        or(isNull(mappingCompte.actifAu), gt(mappingCompte.actifAu, dateComptable)),
      ),
    );

  const codesTva = codesTvaDejaCharges ?? (await chargerCodesTva(tx, ctx, cible));
  return new ComptesResolusADate(indexerComptes(lignesComptes), codesTva);
}

export async function chargerCodesTva(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  cible: CibleExport,
): Promise<ReadonlyMap<string, string>> {
  const lignes = await tx
    .select({
      regimeTva: mappingCodeTva.regimeTva,
      tauxPourmille: mappingCodeTva.tauxPourmille,
      codeExterne: mappingCodeTva.codeExterne,
    })
    .from(mappingCodeTva)
    .where(and(eq(mappingCodeTva.tenantId, ctx.tenantId), eq(mappingCodeTva.cible, cible)));
  return indexerCodesTva(lignes);
}
