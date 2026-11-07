import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  modulesActifsDepuis,
  normaliserModulesDesactives,
  type ModuleApp,
  type ReponseModules,
} from '@dfa/shared';

import { JETON_DB, schema, type AccesBase, type ContexteTenant } from '../../db';
import { auditAtelier } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';

function reponse(desactives: readonly ModuleApp[]): ReponseModules {
  return { modulesDesactives: desactives, modulesActifs: modulesActifsDepuis(desactives) };
}

/**
 * Modules activables du garage (`tenant.modules_desactives`, migration 0092). Le tenant vient du
 * contexte de session ; aucune donnée n'est supprimée en retirant un module.
 */
@Injectable()
export class ServiceModules {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant): Promise<ReponseModules> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx
        .select({ d: schema.tenant.modulesDesactives })
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      if (!ligne) throw this.tenantIntrouvable();
      return reponse(ligne.d);
    });
  }

  async modifier(
    ctx: ContexteTenant,
    entree: { readonly modulesDesactives: readonly ModuleApp[] },
  ): Promise<ReponseModules> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [avant] = await tx
        .select({ d: schema.tenant.modulesDesactives })
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      if (!avant) throw this.tenantIntrouvable();

      const apres = normaliserModulesDesactives(entree.modulesDesactives);
      const identique = avant.d.length === apres.length && avant.d.every((m, i) => apres[i] === m);
      if (identique) return reponse(avant.d);

      await tx
        .update(schema.tenant)
        .set({ modulesDesactives: [...apres] })
        .where(eq(schema.tenant.id, ctx.tenantId));

      await tx.insert(auditAtelier).values({
        tenantId: ctx.tenantId,
        entite: 'tenant',
        entiteId: ctx.tenantId,
        action: 'modification',
        champ: 'modules_desactives',
        valeurAvant: avant.d,
        valeurApres: apres,
        utilisateurId: ctx.utilisateurId,
        requeteId: ctx.requeteId,
      });
      return reponse(apres);
    });
  }

  private tenantIntrouvable(): ErreurMetier {
    return new ErreurMetier('RESSOURCE_INTROUVABLE', 'Garage introuvable pour cette session.');
  }
}
