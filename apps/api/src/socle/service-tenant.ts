import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { TenantCourant } from '@dfa/shared';
import type { AccesBase, ContexteTenant } from '../db/db.types';
import { JETON_DB } from '../db/db.jetons';
import { tenant } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import { ServiceJournal } from '../common/journal';

/**
 * Lecture du tenant courant. Ne prend jamais de `tenantId` en paramètre : il vient
 * exclusivement du `ContexteTenant` construit par `ServiceContexteRequete.contexteTenant()`
 * à partir de la session — voir §4 du contrat, "aucun endpoint n'accepte de tenantId".
 */
@Injectable()
export class ServiceTenant {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly journal: ServiceJournal,
  ) {}

  async courant(ctx: ContexteTenant): Promise<TenantCourant> {
    return this.acces.enTenant(ctx, async (tx) => {
      // Le RLS filtre déjà sur `tenant.id = tenant_courant()` (politique posée sur `id`, pas
      // `tenant_id`, pour cette table précisément) : on rescope quand même explicitement, le
      // RLS est le filet, jamais le mécanisme.
      const lignes = await tx.select().from(tenant).where(eq(tenant.id, ctx.tenantId)).limit(1);
      const ligne = lignes[0];

      if (!ligne) {
        // Ne devrait jamais arriver pour une session valide (le tenant existe forcément si la
        // session a été résolue) : incohérence interne, pas une erreur métier attendue côté
        // client — §4 endpoint 4 ne documente que 401/403 pour cette route.
        this.journal.error(
          "Tenant introuvable pour un ContexteTenant issu d'une session valide",
          undefined,
          {
            tenantId: ctx.tenantId,
          },
        );
        throw new ErreurMetier('ERREUR_INTERNE', 'Tenant courant introuvable.');
      }

      return {
        id: ligne.id,
        slug: ligne.slug,
        raisonSociale: ligne.raisonSociale,
        langueDefaut: ligne.langueDefaut,
        modeSignalement: ligne.modeSignalement,
      };
    });
  }
}
