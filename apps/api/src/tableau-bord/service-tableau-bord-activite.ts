import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  FiltreTableauBord,
  ReponseActiviteTableauBord,
  RepartitionStatutOrdreReparationTableauBord,
  RoleUtilisateur,
} from '@dfa/shared';
import { STATUTS_OR_TABLEAU_BORD } from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { JETON_DB } from '../db';

import { ROLES_TABLEAU_BORD_ACTIVITE, verifierRoleAutorise } from './droits-provisoires';
import { resoudrePeriodeTableauBord } from './periode';

/** Projection brute d'UNE SEULE ligne agrégée — voir `obtenir()` : une unique requête, huit
 *  sous-requêtes scalaires, AUCUNE boucle applicative, AUCUNE transaction par élément (piège
 *  déjà rencontré deux fois sur ce dépôt, rappelé explicitement dans la consigne de ce lot). */
type LigneActiviteBrute = {
  readonly planifie: number;
  readonly ouvert: number;
  readonly en_cours: number;
  readonly controle: number;
  readonly termine: number;
  readonly facture: number;
  readonly ouvertsPeriode: number;
  readonly restituesPeriode: number;
  readonly delaiMoyenRestitutionMinutes: number | null;
  readonly lignesEnAttenteValidation: number;
  readonly articlesSousSeuilReapprovisionnement: number;
};

/**
 * `GET /tableau-bord/activite` — indicateurs d'activité atelier + stock, en quantités/comptes
 * SEULEMENT (voir `ReponseActiviteTableauBord`, `@dfa/shared`, pour le détail champ par champ et
 * la doctrine « `null` ≠ `0` »). Aucun montant : ce service n'a JAMAIS besoin de connaître le rôle
 * au-delà de la vérification d'accès elle-même — contrairement à `ServiceTableauBordFinancier`.
 */
@Injectable()
export class ServiceTableauBordActivite {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    filtre: FiltreTableauBord,
  ): Promise<ReponseActiviteTableauBord> {
    // Vérification AVANT tout accès base — voir `droits-provisoires.ts`.
    verifierRoleAutorise(role, ROLES_TABLEAU_BORD_ACTIVITE, 'tableau_bord.activite.lire');

    const periode = resoudrePeriodeTableauBord(filtre);
    const siteId = filtre.siteId ?? null;

    return this.acces.enTenant(ctx, async (tx) => {
      // Une seule expression : la sous-requête sur `ligne_or` joint `ordre_reparation` sous le
      // même alias `o`, le filtre de site s'y applique donc identiquement.
      const filtreSiteOr = siteId ? sql`and o.site_id = ${siteId}` : sql``;
      const filtreSiteStock = siteId ? sql`and s.site_id = ${siteId}` : sql``;

      const resultat = await tx.execute<LigneActiviteBrute>(sql`
        select
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr} and o.statut = 'planifie') as "planifie",
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr} and o.statut = 'ouvert') as "ouvert",
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr} and o.statut = 'en_cours') as "en_cours",
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr} and o.statut = 'controle') as "controle",
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr} and o.statut = 'termine') as "termine",
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr} and o.statut = 'facture') as "facture",
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr}
               and o.ouvert_le >= ${periode.duDebutUtc} and o.ouvert_le < ${periode.auFinExclusiveUtc}
          ) as "ouvertsPeriode",
          (select count(*)::int from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr}
               and o.restitue_le >= ${periode.duDebutUtc} and o.restitue_le < ${periode.auFinExclusiveUtc}
          ) as "restituesPeriode",
          (select round(avg(extract(epoch from (o.restitue_le - o.ouvert_le))) / 60)::int
             from public.ordre_reparation o
             where o.tenant_id = ${ctx.tenantId} ${filtreSiteOr}
               and o.restitue_le >= ${periode.duDebutUtc} and o.restitue_le < ${periode.auFinExclusiveUtc}
               and o.ouvert_le is not null
          ) as "delaiMoyenRestitutionMinutes",
          (select count(*)::int from public.ligne_or l
             join public.ordre_reparation o on o.tenant_id = l.tenant_id and o.id = l.ordre_reparation_id
             where l.tenant_id = ${ctx.tenantId} ${filtreSiteOr}
               and l.statut = 'a_valider' and o.statut not in ('annule', 'cloture')
          ) as "lignesEnAttenteValidation",
          (select count(*)::int from public.stock_article s
             join public.article a on a.tenant_id = s.tenant_id and a.id = s.article_id
             where s.tenant_id = ${ctx.tenantId} ${filtreSiteStock}
               and s.stock_minimum_millieme is not null
               and (s.quantite_physique_millieme - s.quantite_reservee_millieme) < s.stock_minimum_millieme
               and a.statut = 'actif'
          ) as "articlesSousSeuilReapprovisionnement"
      `);

      const ligne = resultat.rows[0];
      if (!ligne) {
        // Impossible en pratique : huit sous-requêtes SCALAIRES (chacune renvoie toujours
        // exactement une valeur, y compris `0`/`null`) composent une seule ligne — il n'existe
        // aucun filtre qui puisse faire disparaître la ligne elle-même. Garde défensive, jamais
        // censée se déclencher.
        throw new Error(
          "tableau-bord/activite : l'agrégation n'a rendu aucune ligne (huit sous-requêtes scalaires — impossible).",
        );
      }

      const ordresReparationParStatut: RepartitionStatutOrdreReparationTableauBord[] =
        STATUTS_OR_TABLEAU_BORD.map((statut) => ({ statut, nombre: ligne[statut] }));

      return {
        periode: { du: periode.du, au: periode.au },
        siteId,
        ordresReparationParStatut,
        ordresReparationOuvertsPeriode: ligne.ouvertsPeriode,
        ordresReparationRestituesPeriode: ligne.restituesPeriode,
        delaiMoyenRestitutionMinutes: ligne.delaiMoyenRestitutionMinutes,
        lignesEnAttenteValidation: ligne.lignesEnAttenteValidation,
        articlesSousSeuilReapprovisionnement: ligne.articlesSousSeuilReapprovisionnement,
      };
    });
  }
}
