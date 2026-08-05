import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  EntreeModificationStockSite,
  FiltresReapprovisionnement,
  LigneReapprovisionnement,
  PageCurseur,
  ReponseDisponibiliteArticle,
  ReponseStockArticle,
  ReservationActiveResume,
} from '@dfa/shared';
import { SEUIL_RESERVATIONS_DISPONIBILITE } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { article, site, stockArticle } from '../db/schema';
import type { LigneArticle } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import {
  versDisponibiliteResponse,
  versLigneReapprovisionnement,
  versReservationActiveResume,
  versStockResponse,
  type DonneesReservationActive,
} from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  type DefinitionTri,
} from './pagination-triee';

const DEFINITION_TRI_ECART: Readonly<Record<FiltresReapprovisionnement['tri'], DefinitionTri>> = {
  'ecartMillieme:desc': {
    expression: sql`(s.stock_minimum_millieme - (s.quantite_physique_millieme - s.quantite_reservee_millieme))`,
    sens: 'desc',
    nullable: false,
  },
  'ecartMillieme:asc': {
    expression: sql`(s.stock_minimum_millieme - (s.quantite_physique_millieme - s.quantite_reservee_millieme))`,
    sens: 'asc',
    nullable: false,
  },
};

/**
 * Service stock (RP-09 → RP-15) : consultation par site, disponibilité (RP-14/RP-19, `CP-02` côté
 * lecture — la garantie d'écriture vit dans le trigger `reservation_piece_verrouiller_stock`,
 * 0026), réapprovisionnement (RP-12), réglages de site (emplacement, seuils). Priorités 2 et 3.
 */
@Injectable()
export class ServiceStock {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  /** `GET /articles/{id}/disponibilite?siteId=` — RP-14/RP-19, LE terrain de `CP-02`. */
  async disponibilite(
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
  ): Promise<ReponseDisponibiliteArticle> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerArticleOu404(tx, ctx, articleId);

      const stocks = await tx
        .select()
        .from(stockArticle)
        .where(
          and(
            eq(stockArticle.tenantId, ctx.tenantId),
            eq(stockArticle.articleId, articleId),
            eq(stockArticle.siteId, siteId),
          ),
        )
        .limit(1);
      const ligneStock = stocks[0] ?? null;

      const resultat = await tx.execute<DonneesReservationActive & { rang: number }>(sql`
        select r.id as "reservationId", r.ligne_or_id as "ligneOrId", r.ordre_reparation_id as "ordreReparationId",
               o.numero as "numeroOrdreReparation",
               coalesce(c.raison_sociale, trim(c.nom || ' ' || coalesce(c.prenom, ''))) as "clientNomAffichage",
               r.quantite_millieme as "quantiteMillieme", r.cree_le as "reserveeLe",
               row_number() over (order by r.cree_le asc, r.id asc) as "rang"
          from public.reservation_piece r
          join public.ordre_reparation o on o.tenant_id = r.tenant_id and o.id = r.ordre_reparation_id
          join public.client c on c.tenant_id = o.tenant_id and c.id = o.client_id
         where r.tenant_id = ${ctx.tenantId} and r.article_id = ${articleId} and r.site_id = ${siteId}
           and r.statut = 'active'
         order by r.cree_le asc, r.id asc
         limit ${SEUIL_RESERVATIONS_DISPONIBILITE + 1}
      `);

      const lignes = resultat.rows;
      const tronquees = lignes.length > SEUIL_RESERVATIONS_DISPONIBILITE;
      const reservationsActives: ReservationActiveResume[] = lignes
        .slice(0, SEUIL_RESERVATIONS_DISPONIBILITE)
        .map((l) => versReservationActiveResume(l));

      return versDisponibiliteResponse(
        articleId,
        siteId,
        ligneStock,
        reservationsActives,
        tronquees,
      );
    });
  }

  /** `GET /stock/reapprovisionnement?siteId=` — RP-12, ne commande jamais automatiquement. */
  async reapprovisionnement(
    ctx: ContexteTenant,
    params: FiltresReapprovisionnement,
  ): Promise<PageCurseur<LigneReapprovisionnement>> {
    const definition = DEFINITION_TRI_ECART[params.tri];
    const idExpr = sql`a.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri, DEFINITION_TRI_ECART);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [
        sql`s.tenant_id = ${ctx.tenantId}`,
        sql`s.site_id = ${params.siteId}`,
        sql`s.stock_minimum_millieme is not null`,
        sql`(s.quantite_physique_millieme - s.quantite_reservee_millieme) < s.stock_minimum_millieme`,
      ];
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<{
        articleId: string;
        numeroArticle: string;
        designation: string;
        siteId: string;
        quantiteDisponibleMillieme: number;
        stockMinimumMillieme: number;
        quantiteCommandeStandardMillieme: number | null;
        triValeur: number;
      }>(sql`
        select a.id as "articleId", coalesce(a.numero_article, '') as "numeroArticle",
               a.designation as "designation", s.site_id as "siteId",
               (s.quantite_physique_millieme - s.quantite_reservee_millieme) as "quantiteDisponibleMillieme",
               s.stock_minimum_millieme as "stockMinimumMillieme",
               s.quantite_commande_standard_millieme as "quantiteCommandeStandardMillieme",
               ${definition.expression} as "triValeur"
          from public.stock_article s
          join public.article a on a.tenant_id = s.tenant_id and a.id = s.article_id
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versLigneReapprovisionnement(l)),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: params.tri,
                valeur: derniere.triValeur,
                id: derniere.articleId,
              })
            : null,
        limite: params.limite,
      };
    });
  }

  /**
   * `PATCH /articles/{id}/stock/{siteId}` — réglages de site (emplacement, seuils), JAMAIS la
   * quantité physique (`mouvement.ts`, `schemaModificationStockSite`). Upsert : crée la ligne
   * `stock_article` (quantité physique 0) si elle n'existe pas encore.
   */
  async modifierSite(
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
    entree: EntreeModificationStockSite,
  ): Promise<ReponseStockArticle> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerArticleOu404(tx, ctx, articleId);
      await this.chargerSiteOu404(tx, ctx, siteId);

      const valeurs: {
        emplacement?: string | null;
        stockMinimumMillieme?: number | null;
        quantiteCommandeStandardMillieme?: number | null;
      } = {};
      if ('emplacement' in entree) valeurs.emplacement = entree.emplacement ?? null;
      if ('stockMinimumMillieme' in entree)
        valeurs.stockMinimumMillieme = entree.stockMinimumMillieme ?? null;
      if ('quantiteCommandeStandardMillieme' in entree) {
        valeurs.quantiteCommandeStandardMillieme = entree.quantiteCommandeStandardMillieme ?? null;
      }

      await tx
        .insert(stockArticle)
        .values({ tenantId: ctx.tenantId, articleId, siteId, ...valeurs })
        .onConflictDoUpdate({
          target: [stockArticle.tenantId, stockArticle.articleId, stockArticle.siteId],
          set: valeurs,
        });

      const lignes = await tx
        .select()
        .from(stockArticle)
        .where(
          and(
            eq(stockArticle.tenantId, ctx.tenantId),
            eq(stockArticle.articleId, articleId),
            eq(stockArticle.siteId, siteId),
          ),
        )
        .limit(1);
      const ligne = lignes[0];
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de mise à jour du stock.');
      return versStockResponse(ligne);
    });
  }

  /** Lecture (verrouillante) du stock d'un (article, site) — utilisée par `ServiceMouvement` avant d'insérer une sortie. */
  static async chargerPourVerrou(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
  ): Promise<{ physique: number; reservee: number }> {
    const resultat = await tx.execute<{ physique: number; reservee: number }>(sql`
      select quantite_physique_millieme as "physique", quantite_reservee_millieme as "reservee"
        from public.stock_article
       where tenant_id = ${ctx.tenantId} and article_id = ${articleId} and site_id = ${siteId}
       for update
    `);
    const ligne = resultat.rows[0];
    return ligne
      ? { physique: ligne.physique, reservee: ligne.reservee }
      : { physique: 0, reservee: 0 };
  }

  private async chargerArticleOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
  ): Promise<LigneArticle> {
    const lignes = await tx
      .select()
      .from(article)
      .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)))
      .limit(1);
    const ligne = lignes[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Article introuvable.');
    return ligne;
  }

  private async chargerSiteOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    siteId: string,
  ): Promise<void> {
    const lignes = await tx
      .select({ id: site.id })
      .from(site)
      .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
      .limit(1);
    if (!lignes[0]) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Site introuvable.');
  }
}
