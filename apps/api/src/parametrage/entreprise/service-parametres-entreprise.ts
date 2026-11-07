import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  EntreeModificationParametresEntreprise,
  ReponseParametresEntreprise,
} from '@dfa/shared';

import { JETON_DB, schema, type AccesBase, type ContexteTenant } from '../../db';
import { auditAtelier } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';

/**
 * Identité du tenant courant (`tenant.raison_sociale`, `numero_tva`, délai de paiement). Le tenant vient du contexte de session,
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
          delaiPaiementJoursDefaut: schema.tenant.delaiPaiementJoursDefaut,
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
    if (
      entree.raisonSociale === undefined &&
      entree.numeroTva === undefined &&
      entree.delaiPaiementJoursDefaut === undefined
    ) {
      return this.obtenir(ctx);
    }

    return this.acces.enTenant(ctx, async (tx) => {
      // Raison sociale : valeur AVANT lue dans la transaction pour le journal. Le slug n'est
      // jamais écrit ; les documents déjà émis gardent leur raison sociale figée (leur snapshot),
      // les nouveaux lisent la valeur courante.
      let avant: string | undefined;
      if (entree.raisonSociale !== undefined) {
        const [courante] = await tx
          .select({ raisonSociale: schema.tenant.raisonSociale })
          .from(schema.tenant)
          .where(eq(schema.tenant.id, ctx.tenantId));
        if (!courante) throw this.tenantIntrouvable();
        avant = courante.raisonSociale;
      }

      // Seuls les champs ENVOYÉS sont écrits (`undefined` est ignoré par Drizzle) : un PATCH du
      // délai ne touche pas au n° TVA, et inversement.
      const [ligne] = await tx
        .update(schema.tenant)
        .set({
          raisonSociale: entree.raisonSociale,
          numeroTva: entree.numeroTva,
          delaiPaiementJoursDefaut: entree.delaiPaiementJoursDefaut,
        })
        .where(eq(schema.tenant.id, ctx.tenantId))
        .returning({
          raisonSociale: schema.tenant.raisonSociale,
          numeroTva: schema.tenant.numeroTva,
          delaiPaiementJoursDefaut: schema.tenant.delaiPaiementJoursDefaut,
        });
      if (!ligne) throw this.tenantIntrouvable();
      if (avant !== undefined && avant !== ligne.raisonSociale) {
        await tx.insert(auditAtelier).values({
          tenantId: ctx.tenantId,
          entite: 'tenant',
          entiteId: ctx.tenantId,
          action: 'modification',
          champ: 'raison_sociale',
          valeurAvant: avant,
          valeurApres: ligne.raisonSociale,
          utilisateurId: ctx.utilisateurId,
          requeteId: ctx.requeteId,
        });
      }
      return ligne;
    });
  }

  private tenantIntrouvable(): ErreurMetier {
    return new ErreurMetier('RESSOURCE_INTROUVABLE', 'Garage introuvable pour cette session.');
  }
}
