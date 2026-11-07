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
      // Garantit l'existence de la ligne (ou lève 404 si le site n'est pas à ce tenant) AVANT
      // l'UPDATE : sur un garage créé avant les défauts, l'UPDATE seul ne toucherait rien.
      const ligneActuelle = await this.chargerLigne(tx, ctx.tenantId, siteId);
      if (Object.keys(colonnes).length === 0) {
        return versDtoParametresSite(ligneActuelle);
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

  /**
   * Charge la ligne du site ; si le site existe dans ce tenant mais n'a pas encore de ligne de
   * paramètres (garage créé avant `creer-garage` à jour), la crée avec les valeurs par défaut.
   * Un site inconnu de ce tenant reste un `404` : on ne crée jamais de paramètres pour lui.
   */
  private async chargerLigne(
    tx: TransactionDfa,
    tenantId: string,
    siteId: string,
  ): Promise<schema.LigneParametreSite> {
    const lire = (): Promise<schema.LigneParametreSite[]> =>
      tx
        .select()
        .from(schema.parametreSite)
        .where(
          and(eq(schema.parametreSite.tenantId, tenantId), eq(schema.parametreSite.siteId, siteId)),
        );

    const [existante] = await lire();
    if (existante) return existante;

    const [site] = await tx
      .select({ id: schema.site.id })
      .from(schema.site)
      .where(and(eq(schema.site.tenantId, tenantId), eq(schema.site.id, siteId)));
    if (site) {
      await tx.insert(schema.parametreSite).values({ tenantId, siteId }).onConflictDoNothing();
      const [creee] = await lire();
      if (creee) return creee;
    }
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Paramètres du site "${siteId}" introuvables pour ce tenant.`,
    );
  }
}
