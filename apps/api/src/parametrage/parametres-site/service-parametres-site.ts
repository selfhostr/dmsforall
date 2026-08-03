import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { EntreeModificationParametresSite } from '@dfa/shared';

import {
  JETON_DB,
  schema,
  type AccesBase,
  type ContexteTenant,
  type TransactionDfa,
} from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import {
  versColonnesMiseAJourSite,
  versDtoParametresSite,
  type DtoParametresSite,
} from './mappeur-parametres-site';

@Injectable()
export class ServiceParametresSite {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant, siteId: string): Promise<DtoParametresSite> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerLigne(tx, ctx.tenantId, siteId);
      return versDtoParametresSite(ligne);
    });
  }

  async modifier(
    ctx: ContexteTenant,
    siteId: string,
    entree: EntreeModificationParametresSite,
  ): Promise<DtoParametresSite> {
    const colonnes = versColonnesMiseAJourSite(entree);

    return this.acces.enTenant(ctx, async (tx) => {
      if (Object.keys(colonnes).length === 0) {
        const ligne = await this.chargerLigne(tx, ctx.tenantId, siteId);
        return versDtoParametresSite(ligne);
      }

      const [ligne] = await tx
        .update(schema.parametreSite)
        .set(colonnes)
        .where(
          and(
            eq(schema.parametreSite.tenantId, ctx.tenantId),
            eq(schema.parametreSite.siteId, siteId),
          ),
        )
        .returning();

      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Paramètres du site "${siteId}" introuvables pour ce tenant.`,
        );
      }
      return versDtoParametresSite(ligne);
    });
  }

  private async chargerLigne(
    tx: TransactionDfa,
    tenantId: string,
    siteId: string,
  ): Promise<schema.LigneParametreSite> {
    const [ligne] = await tx
      .select()
      .from(schema.parametreSite)
      .where(
        and(eq(schema.parametreSite.tenantId, tenantId), eq(schema.parametreSite.siteId, siteId)),
      );

    if (!ligne) {
      throw new ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        `Paramètres du site "${siteId}" introuvables pour ce tenant.`,
      );
    }
    return ligne;
  }
}
