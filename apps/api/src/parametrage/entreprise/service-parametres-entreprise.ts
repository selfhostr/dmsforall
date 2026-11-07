import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  EntreeModificationParametresEntreprise,
  ReponseParametresEntreprise,
} from '@dfa/shared';

import { JETON_DB, schema, type AccesBase, type ContexteTenant } from '../../db';
import { ErreurMetier } from '../../common/erreurs';

/**
 * Identité fiscale du tenant courant (`tenant.numero_tva`). Le tenant vient du contexte de session,
 * jamais d'un paramètre : il n'existe aucun `tenantId` dans cette API.
 */
@Injectable()
export class ServiceParametresEntreprise {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant): Promise<ReponseParametresEntreprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx
        .select({
          raisonSociale: schema.tenant.raisonSociale,
          numeroTva: schema.tenant.numeroTva,
        })
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      if (!ligne) throw this.tenantIntrouvable();
      return ligne;
    });
  }

  async modifier(
    ctx: ContexteTenant,
    entree: EntreeModificationParametresEntreprise,
  ): Promise<ReponseParametresEntreprise> {
    if (entree.numeroTva === undefined) return this.obtenir(ctx);

    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx
        .update(schema.tenant)
        .set({ numeroTva: entree.numeroTva })
        .where(eq(schema.tenant.id, ctx.tenantId))
        .returning({
          raisonSociale: schema.tenant.raisonSociale,
          numeroTva: schema.tenant.numeroTva,
        });
      if (!ligne) throw this.tenantIntrouvable();
      return ligne;
    });
  }

  private tenantIntrouvable(): ErreurMetier {
    return new ErreurMetier('RESSOURCE_INTROUVABLE', 'Garage introuvable pour cette session.');
  }
}
