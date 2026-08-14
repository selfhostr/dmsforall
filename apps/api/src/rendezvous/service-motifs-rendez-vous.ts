import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { ReponseMotifRendezVous } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { motifRendezVous } from '../db/schema';

import { versDtoMotifRendezVous } from './mappeurs';

/**
 * `GET /motifs-rendez-vous` — catalogue `motif_rendez_vous` (existant depuis la migration 0005,
 * jamais consommé avant ce lot). Petit référentiel par tenant (quelques entrées) : pas de
 * pagination — même doctrine que `GET /parametres-atelier` (liste courte, pas une collection).
 */
@Injectable()
export class ServiceMotifsRendezVous {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(ctx: ContexteTenant): Promise<readonly ReponseMotifRendezVous[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(motifRendezVous)
        .where(eq(motifRendezVous.tenantId, ctx.tenantId))
        .orderBy(asc(motifRendezVous.libelleFr));
      return lignes.map(versDtoMotifRendezVous);
    });
  }
}
