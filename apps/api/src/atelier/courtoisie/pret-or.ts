import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ReponsePretCourtoisie } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { client, pretCourtoisie, vehiculeCourtoisie } from '../../db/schema';
import { versReponsePret } from './service-courtoisie';

/**
 * Prêt de courtoisie lié à chacun des OR donnés, en UNE requête (jamais une par OR). Même source
 * et même représentation que `GET /courtoisie/prets` (`versReponsePret`). Un OR peut avoir eu
 * plusieurs prêts : on retient celui qui est réservé/en cours, sinon le plus récent. Un OR sans
 * aucun prêt est absent de la table (l'appelant rend `null`).
 */
export async function chargerPretsParOr(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  orIds: readonly string[],
  maintenant: Date,
): Promise<Map<string, ReponsePretCourtoisie>> {
  const resultat = new Map<string, ReponsePretCourtoisie>();
  if (orIds.length === 0) return resultat;
  const lignes = await tx
    .select({ pret: pretCourtoisie, vehicule: vehiculeCourtoisie, client })
    .from(pretCourtoisie)
    .innerJoin(
      vehiculeCourtoisie,
      and(
        eq(vehiculeCourtoisie.tenantId, pretCourtoisie.tenantId),
        eq(vehiculeCourtoisie.id, pretCourtoisie.vehiculeCourtoisieId),
      ),
    )
    .innerJoin(
      client,
      and(eq(client.tenantId, pretCourtoisie.tenantId), eq(client.id, pretCourtoisie.clientId)),
    )
    .where(
      and(eq(pretCourtoisie.tenantId, ctx.tenantId), inArray(pretCourtoisie.ordreReparationId, [...orIds])),
    )
    .orderBy(desc(pretCourtoisie.debutLe), desc(pretCourtoisie.id));

  const actifs = new Set<string>();
  for (const l of lignes) {
    const orId = l.pret.ordreReparationId;
    if (!orId) continue;
    const actif = l.pret.statut === 'reserve' || l.pret.statut === 'en_cours';
    if (!resultat.has(orId) || (actif && !actifs.has(orId))) {
      resultat.set(orId, versReponsePret(l, maintenant));
      if (actif) actifs.add(orId);
    }
  }
  return resultat;
}
