import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ReponseEtatDemarrage } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';

type LigneEtat = {
  readonly coordonnees: boolean;
  readonly iban: boolean;
  readonly numero_tva: boolean;
  readonly taux_horaire: boolean;
  readonly motifs_rdv: boolean;
  readonly premier_collaborateur: boolean;
  readonly borne: boolean;
};

/**
 * `GET /accueil/etat-demarrage` — une seule requête, une sous-requête scalaire par table (bloc
 * créancier, tenant, taux horaire, motifs, utilisateurs). Scopée explicitement par `tenant_id`
 * (la RLS n'est que le filet). `utilisateurId` vient de la session, jamais d'un paramètre.
 */
@Injectable()
export class ServiceEtatDemarrage {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant, utilisateurId: string): Promise<ReponseEtatDemarrage> {
    const ligne = await this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneEtat>(sql`
        select
          coalesce((select btrim(coalesce(c.nom, '')) <> '' and btrim(coalesce(c.rue, '')) <> ''
                           and btrim(coalesce(c.npa, '')) <> '' and btrim(coalesce(c.localite, '')) <> ''
                      from public.tenant_bloc_creancier c where c.tenant_id = ${ctx.tenantId}), false) as coordonnees,
          coalesce((select btrim(coalesce(c.iban, '')) <> '' or btrim(coalesce(c.qr_iban, '')) <> ''
                      from public.tenant_bloc_creancier c where c.tenant_id = ${ctx.tenantId}), false) as iban,
          coalesce((select btrim(coalesce(t.numero_tva, '')) <> ''
                      from public.tenant t where t.id = ${ctx.tenantId}), false) as numero_tva,
          exists (select 1 from public.taux_horaire th where th.tenant_id = ${ctx.tenantId}) as taux_horaire,
          exists (select 1 from public.motif_rendez_vous m
                   where m.tenant_id = ${ctx.tenantId} and m.actif) as motifs_rdv,
          exists (select 1 from public.utilisateur u
                   where u.tenant_id = ${ctx.tenantId} and u.id <> ${utilisateurId}
                     and u.role <> 'poste_atelier' and u.statut in ('invite', 'actif')) as premier_collaborateur,
          exists (select 1 from public.utilisateur u
                   where u.tenant_id = ${ctx.tenantId}
                     and u.role = 'poste_atelier' and u.statut = 'actif') as borne
      `);
      return resultat.rows[0];
    });
    return {
      etapes: {
        coordonnees: ligne?.coordonnees ?? false,
        iban: ligne?.iban ?? false,
        numeroTva: ligne?.numero_tva ?? false,
        tauxHoraire: ligne?.taux_horaire ?? false,
        motifsRdv: ligne?.motifs_rdv ?? false,
        premierCollaborateur: ligne?.premier_collaborateur ?? false,
        borne: ligne?.borne ?? false,
      },
    };
  }
}
