import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { PageCurseur, SiteResume } from '@dfa/shared';
import type { AccesBase, ContexteTenant } from '../db/db.types';
import { JETON_DB } from '../db/db.jetons';
import { site, type LigneSite } from '../db/schema';
import { decoderCurseur, encoderCurseur } from '../common/pagination';
import { ErreurMetier } from '../common/erreurs';

export interface ParametresListeSites {
  readonly limite: number;
  readonly curseur?: string;
}

function versSiteResume(ligne: LigneSite): SiteResume {
  return { id: ligne.id, code: ligne.code, nom: ligne.nom, actif: ligne.actif };
}

/**
 * Lecture des sites du tenant courant. Comme `ServiceTenant`, aucune méthode ne reçoit de
 * `tenantId` en paramètre client : uniquement le `ContexteTenant` construit depuis la session.
 */
@Injectable()
export class ServiceSite {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(ctx: ContexteTenant, params: ParametresListeSites): Promise<PageCurseur<SiteResume>> {
    const { limite } = params;
    const curseurDecode = params.curseur ? decoderCurseur(params.curseur) : null;

    return this.acces.enTenant(ctx, async (tx) => {
      // Rescope explicite sur tenant_id, même si le RLS filtre déjà via le GUC posé par
      // enTenant() : le RLS est le filet, jamais le mécanisme — un `where` manquant est un
      // défaut de revue même s'il est rattrapé côté base.
      const conditionTenant = eq(site.tenantId, ctx.tenantId);
      const conditionCurseur = curseurDecode
        ? or(
            lt(site.creeLe, curseurDecode.creeLe),
            and(eq(site.creeLe, curseurDecode.creeLe), lt(site.id, curseurDecode.id)),
          )
        : undefined;
      const conditionFinale = conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant;

      const lignes = await tx
        .select()
        .from(site)
        .where(conditionFinale)
        .orderBy(desc(site.creeLe), desc(site.id))
        .limit(limite + 1);

      const aUnePageSuivante = lignes.length > limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map(versSiteResume),
        curseurSuivant:
          aUnePageSuivante && derniere ? encoderCurseur({ creeLe: derniere.creeLe, id: derniere.id }) : null,
        limite,
      };
    });
  }

  async parId(ctx: ContexteTenant, siteId: string): Promise<SiteResume> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(site)
        .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
        .limit(1);
      const ligne = lignes[0];

      if (!ligne) {
        // 404, jamais 403 : un site d'un autre tenant ne doit même pas laisser deviner qu'il existe.
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Site introuvable.');
      }

      return versSiteResume(ligne);
    });
  }
}
