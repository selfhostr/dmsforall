import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  EntreeCreationArticle,
  EntreeCreationReferenceArticle,
  EntreeDesactivationArticle,
  EntreeMarquageObsolete,
  EntreeModificationArticle,
  PageCurseur,
  ReponseArticle,
  ReponseAvecAvertissements,
  ResultatRechercheComptoirArticle,
  RoleUtilisateur,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { article, articleReference, reservationPiece, stockArticle } from '../db/schema';
import type { LigneArticle, LigneArticleReference, LigneStockArticle, NouvelArticle } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { JETON_IDEMPOTENCE } from '../common/idempotence';
import type { ReponseMemorisable, ResultatIdempotent, ServiceIdempotence } from '../common/idempotence';

import {
  versArticleReferenceResponse,
  versArticleResponse,
  versRechercheComptoirResultat,
  versStockResumeArticle,
} from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';
import type { ParametresListeArticles } from './schemas';

/** RP-01 → RP-08. Seuil de troncature des références/stocks embarqués (`SEUIL_REFERENCES_EMBARQUEES_ARTICLE`, `@dfa/shared`). */
const SEUIL_REFERENCES_EMBARQUEES = 50;

const DEFINITIONS_TRI_ARTICLES: Readonly<Record<ParametresListeArticles['tri'], DefinitionTri>> = {
  'creeLe:desc': { expression: sql`a.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`a.cree_le`, sens: 'asc', nullable: false, temporel: true },
  'designation:asc': { expression: sql`a.designation`, sens: 'asc', nullable: false },
  'designation:desc': { expression: sql`a.designation`, sens: 'desc', nullable: false },
  // Nullable par construction du schéma Drizzle (voir schema/pieces/article.ts) même si toujours
  // renseigné en pratique par le trigger `attribuer_numero_article()` (0022) — NULLS LAST défensif.
  'numeroArticle:asc': { expression: sql`a.numero_article`, sens: 'asc', nullable: true },
};

const COLONNES_ARTICLE_ALIASEES = sql`
  a.id as "id", a.tenant_id as "tenantId", a.numero_article as "numeroArticle",
  a.designation as "designation", a.marque as "marque", a.categorie as "categorie",
  a.statut as "statut", a.reference_principale as "referencePrincipale",
  a.code_barres as "codeBarres", a.prix_achat_centimes as "prixAchatCentimes",
  a.prix_vente_ttc_centimes as "prixVenteTtcCentimes", a.taux_tva_pourmille as "tauxTvaPourmille",
  a.est_echange_standard as "estEchangeStandard",
  a.montant_consigne_ttc_centimes as "montantConsigneTtcCentimes",
  a.reference_remplacement_id as "referenceRemplacementId",
  a.cree_le as "creeLe", a.modifie_le as "modifieLe"
`;

export interface EntreeCreationArticleResultat {
  readonly statutHttp: number;
  readonly corps: ReponseAvecAvertissements<ReponseArticle>;
}

/**
 * Service cœur du référentiel article (RP-01 → RP-08) : recherche/liste paginée, fiche, création,
 * modification, références alternatives, cycle de vie (obsolète/désactivé/réactivé) — priorité 1
 * du lot (`docs/specification-etape-3-pieces.md`).
 */
@Injectable()
export class ServiceArticle {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
  ) {}

  async lister(ctx: ContexteTenant, role: RoleUtilisateur, params: ParametresListeArticles): Promise<PageCurseur<ReponseArticle>> {
    const definition = DEFINITIONS_TRI_ARTICLES[params.tri];
    const idExpr = sql`a.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`a.tenant_id = ${ctx.tenantId}`];

      if (params.categorie && params.categorie.length > 0) {
        conditions.push(sql`a.categorie::text in (${sql.join(params.categorie.map((c) => sql`${c}`), sql`, `)})`);
      }
      if (params.statut && params.statut.length > 0) {
        conditions.push(sql`a.statut::text in (${sql.join(params.statut.map((s) => sql`${s}`), sql`, `)})`);
      }
      if (params.estEchangeStandard !== undefined) {
        conditions.push(sql`a.est_echange_standard = ${params.estEchangeStandard}`);
      }
      if (params.q) {
        const motif = `%${params.q}%`;
        conditions.push(sql`(
          a.designation ilike ${motif}
          or a.reference_principale ilike ${motif}
          or exists (
            select 1 from public.article_reference ar
             where ar.tenant_id = a.tenant_id and ar.article_id = a.id and ar.reference ilike ${motif}
          )
        )`);
      }
      if (curseurDecode) {
        conditions.push(construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id));
      }

      const requete = sql`
        select ${COLONNES_ARTICLE_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.article a
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `;

      const resultat = await tx.execute<LigneArticle & { triValeur: string | number | null }>(requete);
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      const idsPage = pageLignes.map((l) => l.id);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(tx, ctx, idsPage);

      return {
        donnees: pageLignes.map((ligne) => this.assemblerReponse(ligne, role, referencesParArticle, stocksParArticle)),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({ tri: params.tri, valeur: valeurCurseurDepuisTri(definition, derniere.triValeur), id: derniere.id })
            : null,
        limite: params.limite,
      };
    });
  }

  async rechercheComptoir(
    ctx: ContexteTenant,
    params: { readonly q: string; readonly siteId: string; readonly limite: number },
  ): Promise<readonly ResultatRechercheComptoirArticle[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      const motif = `%${params.q}%`;
      const resultat = await tx.execute<{
        articleId: string;
        numeroArticle: string;
        designation: string;
        referencePrincipale: string;
        prixVenteTtcCentimes: number;
        quantiteDisponibleMillieme: number;
        emplacement: string | null;
        estEchangeStandard: boolean;
        montantConsigneTtcCentimes: number | null;
      }>(sql`
        select a.id as "articleId", coalesce(a.numero_article, '') as "numeroArticle",
               a.designation as "designation", a.reference_principale as "referencePrincipale",
               a.prix_vente_ttc_centimes as "prixVenteTtcCentimes",
               coalesce(s.quantite_physique_millieme, 0) - coalesce(s.quantite_reservee_millieme, 0) as "quantiteDisponibleMillieme",
               s.emplacement as "emplacement", a.est_echange_standard as "estEchangeStandard",
               a.montant_consigne_ttc_centimes as "montantConsigneTtcCentimes"
          from public.article a
          left join public.stock_article s
            on s.tenant_id = a.tenant_id and s.article_id = a.id and s.site_id = ${params.siteId}
         where a.tenant_id = ${ctx.tenantId}
           and a.statut = 'actif'
           and (
             a.designation ilike ${motif}
             or a.reference_principale ilike ${motif}
             or exists (
               select 1 from public.article_reference ar
                where ar.tenant_id = a.tenant_id and ar.article_id = a.id and ar.reference ilike ${motif}
             )
           )
         order by a.designation asc, a.id asc
         limit ${params.limite}
      `);
      return resultat.rows.map((ligne) => versRechercheComptoirResultat(ligne));
    });
  }

  async creer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    entree: EntreeCreationArticle,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<EntreeCreationArticleResultat & ReponseMemorisable>> {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/articles', cle: cleIdempotence, corps: entree },
      async (tx) => {
        const valeurs: NouvelArticle = {
          tenantId: ctx.tenantId,
          designation: entree.designation,
          marque: entree.marque ?? null,
          categorie: entree.categorie,
          referencePrincipale: entree.referencePrincipale,
          codeBarres: entree.codeBarres ?? null,
          // RP-33 : jamais renseigné à la création — uniquement par mouvement_stock_appliquer_physique().
          prixAchatCentimes: null,
          prixVenteTtcCentimes: entree.prixVenteTtcCentimes,
          tauxTvaPourmille: entree.tauxTvaPourmille,
          estEchangeStandard: entree.estEchangeStandard,
          montantConsigneTtcCentimes: entree.montantConsigneTtcCentimes ?? null,
        };

        const [ligne] = await tx.insert(article).values(valeurs).returning();
        if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', "Échec de création de l'article.");

        return {
          statutHttp: 201,
          corps: new CollecteurAvertissements().envelopper(versArticleResponse(ligne, role, [], false, [])),
        };
      },
    );
  }

  async parId(ctx: ContexteTenant, role: RoleUtilisateur, articleId: string): Promise<ReponseArticle> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(tx, ctx, [articleId]);
      return this.assemblerReponse(ligne, role, referencesParArticle, stocksParArticle);
    });
  }

  async modifier(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeModificationArticle,
  ): Promise<ReponseAvecAvertissements<ReponseArticle>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      const valeurs: Partial<NouvelArticle> = {};
      if ('designation' in entree && entree.designation !== undefined) valeurs.designation = entree.designation;
      if ('marque' in entree) valeurs.marque = entree.marque ?? null;
      if ('categorie' in entree && entree.categorie !== undefined) valeurs.categorie = entree.categorie;
      if ('referencePrincipale' in entree && entree.referencePrincipale !== undefined) {
        valeurs.referencePrincipale = entree.referencePrincipale;
      }
      if ('codeBarres' in entree) valeurs.codeBarres = entree.codeBarres ?? null;
      if ('prixVenteTtcCentimes' in entree && entree.prixVenteTtcCentimes !== undefined) {
        valeurs.prixVenteTtcCentimes = entree.prixVenteTtcCentimes;
      }
      if ('tauxTvaPourmille' in entree && entree.tauxTvaPourmille !== undefined) {
        valeurs.tauxTvaPourmille = entree.tauxTvaPourmille;
      }
      if ('estEchangeStandard' in entree && entree.estEchangeStandard !== undefined) {
        valeurs.estEchangeStandard = entree.estEchangeStandard;
      }
      if ('montantConsigneTtcCentimes' in entree) {
        valeurs.montantConsigneTtcCentimes = entree.montantConsigneTtcCentimes ?? null;
      }

      if (Object.keys(valeurs).length > 0) {
        await tx.update(article).set(valeurs).where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)));
      }

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(tx, ctx, [articleId]);
      return new CollecteurAvertissements().envelopper(this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle));
    });
  }

  /**
   * `POST /articles/{id}/references` — upsert sur `(tenantId, reference)`, PAS sur
   * `(articleId, type, reference)` (RP-03, voir la note de contrat sur `article_reference`) :
   * une référence déjà portée par CET article se met à jour (type/fournisseurId) ; portée par un
   * AUTRE article, refusée (`409 ARTICLE_REFERENCE_COLLISION`).
   *
   * GAP DE CONTRAT signalé (voir rapport de livraison) : `article.ts` ne déclare aucun type de
   * réponse explicite pour cet endpoint. Inféré ici, par cohérence avec les autres actions
   * d'écriture de ce contrôleur (`marquer-obsolete`, `desactiver`, `reactiver`) : la fiche article
   * complète, rafraîchie, enveloppée d'avertissements — jamais figé sans confirmation.
   */
  async ajouterReference(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationReferenceArticle,
  ): Promise<ReponseAvecAvertissements<ReponseArticle>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      const existantes = await tx
        .select()
        .from(articleReference)
        .where(and(eq(articleReference.tenantId, ctx.tenantId), eq(articleReference.reference, entree.reference)))
        .limit(1);
      const existante = existantes[0];

      if (existante && existante.articleId !== articleId) {
        throw new ErreurMetier(
          'ARTICLE_REFERENCE_COLLISION',
          `La référence "${entree.reference}" est déjà portée par un autre article (RP-03).`,
        );
      }

      if (existante) {
        await tx
          .update(articleReference)
          .set({ type: entree.type, fournisseurId: entree.fournisseurId ?? null })
          .where(and(eq(articleReference.tenantId, ctx.tenantId), eq(articleReference.id, existante.id)));
      } else {
        await tx.insert(articleReference).values({
          tenantId: ctx.tenantId,
          articleId,
          type: entree.type,
          reference: entree.reference,
          fournisseurId: entree.fournisseurId ?? null,
        });
      }

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(tx, ctx, [articleId]);
      return new CollecteurAvertissements().envelopper(this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle));
    });
  }

  /** `POST /articles/{id}/marquer-obsolete` — RP-04. */
  async marquerObsolete(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeMarquageObsolete,
  ): Promise<ReponseAvecAvertissements<ReponseArticle>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      const remplacantsDeclares = await tx
        .select({ id: articleReference.id })
        .from(articleReference)
        .where(
          and(
            eq(articleReference.tenantId, ctx.tenantId),
            eq(articleReference.articleId, articleId),
            eq(articleReference.type, 'remplace_par'),
          ),
        )
        .limit(1);

      if (remplacantsDeclares.length > 0 && !entree.referenceRemplacementId) {
        throw new ErreurMetier(
          'ARTICLE_REMPLACANT_REQUIS',
          'Une référence de remplacement existe pour cet article : `referenceRemplacementId` est requis (RP-04).',
        );
      }

      await tx
        .update(article)
        .set({
          statut: 'obsolete',
          referenceRemplacementId: entree.referenceRemplacementId ?? null,
        })
        .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)));

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(tx, ctx, [articleId]);
      return new CollecteurAvertissements().envelopper(this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle));
    });
  }

  /** `POST /articles/{id}/desactiver` — refusé si une réservation `active` porte sur cet article (§6.1). */
  async desactiver(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    _entree: EntreeDesactivationArticle,
  ): Promise<ReponseAvecAvertissements<ReponseArticle>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      const reservationsActives = await tx
        .select({ id: reservationPiece.id })
        .from(reservationPiece)
        .where(
          and(
            eq(reservationPiece.tenantId, ctx.tenantId),
            eq(reservationPiece.articleId, articleId),
            eq(reservationPiece.statut, 'active'),
          ),
        )
        .limit(1);

      if (reservationsActives.length > 0) {
        throw new ErreurMetier(
          'ARTICLE_DESACTIVATION_IMPOSSIBLE',
          'Désactivation impossible : au moins une réservation active porte sur cet article (§6.1).',
        );
      }

      await tx.update(article).set({ statut: 'desactive' }).where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)));

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(tx, ctx, [articleId]);
      return new CollecteurAvertissements().envelopper(this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle));
    });
  }

  /** `POST /articles/{id}/reactiver` — retour à `actif` depuis `obsolete` ou `desactive` (§6.1). */
  async reactiver(ctx: ContexteTenant, role: RoleUtilisateur, articleId: string): Promise<ReponseAvecAvertissements<ReponseArticle>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      await tx
        .update(article)
        .set({ statut: 'actif', referenceRemplacementId: null })
        .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)));

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(tx, ctx, [articleId]);
      return new CollecteurAvertissements().envelopper(this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle));
    });
  }

  private assemblerReponse(
    ligne: LigneArticle,
    role: RoleUtilisateur,
    referencesParArticle: ReadonlyMap<string, readonly LigneArticleReference[]>,
    stocksParArticle: ReadonlyMap<string, readonly LigneStockArticle[]>,
  ): ReponseArticle {
    const referencesToutes = referencesParArticle.get(ligne.id) ?? [];
    const referencesTronquees = referencesToutes.length > SEUIL_REFERENCES_EMBARQUEES;
    const references = referencesToutes.slice(0, SEUIL_REFERENCES_EMBARQUEES).map(versArticleReferenceResponse);
    const stocksResume = (stocksParArticle.get(ligne.id) ?? []).map(versStockResumeArticle);
    return versArticleResponse(ligne, role, references, referencesTronquees, stocksResume);
  }

  /** Deux requêtes bornées par page (jamais une par article) — voir la doctrine `service-client.ts`. */
  private async chargerSousCollections(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleIds: readonly string[],
  ): Promise<{
    referencesParArticle: ReadonlyMap<string, readonly LigneArticleReference[]>;
    stocksParArticle: ReadonlyMap<string, readonly LigneStockArticle[]>;
  }> {
    if (articleIds.length === 0) {
      return { referencesParArticle: new Map(), stocksParArticle: new Map() };
    }

    const references = await tx
      .select()
      .from(articleReference)
      .where(and(eq(articleReference.tenantId, ctx.tenantId), inArray(articleReference.articleId, [...articleIds])))
      .orderBy(articleReference.creeLe);
    const stocks = await tx
      .select()
      .from(stockArticle)
      .where(and(eq(stockArticle.tenantId, ctx.tenantId), inArray(stockArticle.articleId, [...articleIds])));

    const referencesParArticle = new Map<string, LigneArticleReference[]>();
    for (const r of references) {
      const liste = referencesParArticle.get(r.articleId) ?? [];
      liste.push(r);
      referencesParArticle.set(r.articleId, liste);
    }
    const stocksParArticle = new Map<string, LigneStockArticle[]>();
    for (const s of stocks) {
      const liste = stocksParArticle.get(s.articleId) ?? [];
      liste.push(s);
      stocksParArticle.set(s.articleId, liste);
    }

    return { referencesParArticle, stocksParArticle };
  }

  private async chargerOu404(tx: TransactionDfa, ctx: ContexteTenant, articleId: string): Promise<LigneArticle> {
    const lignes = await tx
      .select()
      .from(article)
      .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)))
      .limit(1);
    const ligne = lignes[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Article introuvable.');
    return ligne;
  }
}
