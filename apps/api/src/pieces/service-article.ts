import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  EntreeCreationArticle,
  EntreeCreationReferenceArticle,
  EntreeDesactivationArticle,
  EntreeMarquageObsolete,
  FiltresReferencesArticle,
  PageCurseur,
  ReponseArticle,
  ReponseArticleReference,
  ReponseAvecAvertissements,
  ResultatRechercheComptoirArticle,
  RoleUtilisateur,
} from '@dfa/shared';
import { schemaModificationArticle, SEUIL_REFERENCES_EMBARQUEES_ARTICLE } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { article, articleReference, reservationPiece, stockArticle } from '../db/schema';
import type {
  LigneArticle,
  LigneArticleReference,
  LigneStockArticle,
  NouvelArticle,
} from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { JETON_IDEMPOTENCE } from '../common/idempotence';
import type {
  ReponseMemorisable,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import { neGarderQueChampsEnvoyes, PipeZod } from '../common/validation';

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
} from '../common/pagination';
import type { ParametresListeArticles } from './schemas';

/**
 * RP-01 → RP-08. Seuil de troncature des références/stocks embarqués — la CONSTANTE PARTAGÉE
 * (`@dfa/shared`), jamais une seconde copie locale : une valeur dupliquée peut diverger de celle du
 * contrat au fil des lots (constat réel, corrigé dans ce lot — la copie locale valait encore `50`,
 * la même valeur que `SEUIL_REFERENCES_EMBARQUEES_ARTICLE` par coïncidence, mais rien ne garantissait
 * que ça dure).
 */
const SEUIL_REFERENCES_EMBARQUEES = SEUIL_REFERENCES_EMBARQUEES_ARTICLE;

const DEFINITIONS_TRI_ARTICLES: Readonly<Record<ParametresListeArticles['tri'], DefinitionTri>> = {
  'creeLe:desc': { expression: sql`a.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`a.cree_le`, sens: 'asc', nullable: false, temporel: true },
  'designation:asc': { expression: sql`a.designation`, sens: 'asc', nullable: false },
  'designation:desc': { expression: sql`a.designation`, sens: 'desc', nullable: false },
  // Nullable par construction du schéma Drizzle (voir schema/pieces/article.ts) même si toujours
  // renseigné en pratique par le trigger `attribuer_numero_article()` (0022) — NULLS LAST défensif.
  'numeroArticle:asc': { expression: sql`a.numero_article`, sens: 'asc', nullable: true },
};

/** `GET /articles/{id}/references` — pagination v2, tri fixé sur `cree_le` (`timestamptz`, piège
 *  documenté `common/pagination/valeur-temporelle.ts` : la valeur de curseur DOIT transiter par
 *  `expressionTriValeur()`/`valeurCurseurDepuisTri()`, jamais par le `Date` rendu par le pilote `pg`
 *  sur la colonne affichée). */
const DEFINITIONS_TRI_REFERENCES: Readonly<Record<FiltresReferencesArticle['tri'], DefinitionTri>> =
  {
    'creeLe:asc': { expression: sql`ar.cree_le`, sens: 'asc', nullable: false, temporel: true },
    'creeLe:desc': { expression: sql`ar.cree_le`, sens: 'desc', nullable: false, temporel: true },
  };

const COLONNES_REFERENCE_ALIASEES = sql`
  ar.id as "id", ar.tenant_id as "tenantId", ar.article_id as "articleId", ar.type as "type",
  ar.reference as "reference", ar.fournisseur_id as "fournisseurId", ar.cree_le as "creeLe"
`;

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

  async lister(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    params: ParametresListeArticles,
  ): Promise<PageCurseur<ReponseArticle>> {
    const definition = DEFINITIONS_TRI_ARTICLES[params.tri];
    const idExpr = sql`a.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_ARTICLES,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`a.tenant_id = ${ctx.tenantId}`];

      if (params.categorie && params.categorie.length > 0) {
        // DÉFAUT CONSTATÉ (corrigé, balayage du 27.08.2026) : `a.categorie::text in (...)` castait
        // l'enum en `text` avant comparaison, opaque aux statistiques PostgreSQL de la colonne —
        // même défaut que `client.statut` (`service-client.ts`). Comparaison native sur l'enum.
        conditions.push(
          sql`a.categorie = any(${sql.param(params.categorie)}::public.categorie_article[])`,
        );
      }
      if (params.statut && params.statut.length > 0) {
        conditions.push(sql`a.statut = any(${sql.param(params.statut)}::public.statut_article[])`);
      }
      if (params.estEchangeStandard !== undefined) {
        conditions.push(sql`a.est_echange_standard = ${params.estEchangeStandard}`);
      }
      if (params.q) {
        // `public.normaliser_recherche(...)` des deux côtés — même idiome que
        // `recherche/service-recherche.ts`, `clients/service-client.ts`, `vehicules/service-vehicule.ts` :
        // un `ilike` nu ne gomme QUE la casse, jamais les accents (« fréin » ne trouve pas « Filtre à
        // huile »/« frein »). Migration 0003 §2 pour la fonction elle-même, non touchée ici (hors
        // périmètre `db/`).
        const motif = `%${params.q}%`;
        conditions.push(sql`(
          public.normaliser_recherche(a.designation) like public.normaliser_recherche(${motif})
          or public.normaliser_recherche(a.reference_principale) like public.normaliser_recherche(${motif})
          or exists (
            select 1 from public.article_reference ar
             where ar.tenant_id = a.tenant_id and ar.article_id = a.id
               and public.normaliser_recherche(ar.reference) like public.normaliser_recherche(${motif})
          )
        )`);
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const requete = sql`
        select ${COLONNES_ARTICLE_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.article a
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `;

      const resultat = await tx.execute<LigneArticle & { triValeur: string | number | null }>(
        requete,
      );
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      const idsPage = pageLignes.map((l) => l.id);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(
        tx,
        ctx,
        idsPage,
      );

      return {
        donnees: pageLignes.map((ligne) =>
          this.assemblerReponse(ligne, role, referencesParArticle, stocksParArticle),
        ),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: params.tri,
                valeur: valeurCurseurDepuisTri(definition, derniere.triValeur),
                id: derniere.id,
              })
            : null,
        limite: params.limite,
      };
    });
  }

  /**
   * `GET /articles/recherche-comptoir` — recherche par référence ET désignation, tolérante à la
   * casse et aux accents (`public.normaliser_recherche`, même idiome que `lister()` ci-dessus et
   * que `recherche/service-recherche.ts`). `quantite{Physique,Reservee}Millieme` restent NULLABLES
   * côté SQL (jamais `coalesce()`é) : c'est cette nullité qui distingue « aucune ligne
   * `stock_article` pour CE site » d'un stock réellement nul — `suiviQuelquePart` (sous-requête
   * corrélée) complète la distinction entre « non suivi ici » et « jamais mis en stock » — voir
   * `StatutSuiviStockArticle`/`mappers.ts::versRechercheComptoirResultat`.
   */
  async rechercheComptoir(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
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
        prixAchatCentimes: number | null;
        quantitePhysiqueMillieme: number | null;
        quantiteReserveeMillieme: number | null;
        suiviQuelquePart: boolean;
        emplacement: string | null;
        rayon: string | null;
        tiroir: string | null;
        estEchangeStandard: boolean;
        montantConsigneTtcCentimes: number | null;
      }>(sql`
        select a.id as "articleId", coalesce(a.numero_article, '') as "numeroArticle",
               a.designation as "designation", a.reference_principale as "referencePrincipale",
               a.prix_vente_ttc_centimes as "prixVenteTtcCentimes",
               a.prix_achat_centimes as "prixAchatCentimes",
               s.quantite_physique_millieme as "quantitePhysiqueMillieme",
               s.quantite_reservee_millieme as "quantiteReserveeMillieme",
               exists (
                 select 1 from public.stock_article s2
                  where s2.tenant_id = a.tenant_id and s2.article_id = a.id
               ) as "suiviQuelquePart",
               s.emplacement as "emplacement", s.rayon as "rayon", s.tiroir as "tiroir",
               a.est_echange_standard as "estEchangeStandard",
               a.montant_consigne_ttc_centimes as "montantConsigneTtcCentimes"
          from public.article a
          left join public.stock_article s
            on s.tenant_id = a.tenant_id and s.article_id = a.id and s.site_id = ${params.siteId}
         where a.tenant_id = ${ctx.tenantId}
           and a.statut = 'actif'
           and (
             public.normaliser_recherche(a.designation) like public.normaliser_recherche(${motif})
             or public.normaliser_recherche(a.reference_principale) like public.normaliser_recherche(${motif})
             or exists (
               select 1 from public.article_reference ar
                where ar.tenant_id = a.tenant_id and ar.article_id = a.id
                  and public.normaliser_recherche(ar.reference) like public.normaliser_recherche(${motif})
             )
           )
         order by a.designation asc, a.id asc
         limit ${params.limite}
      `);
      return resultat.rows.map((ligne) => versRechercheComptoirResultat(ligne, role));
    });
  }

  /**
   * `GET /articles/{id}/references` — la suite de `ReponseArticle.references` au-delà de
   * `SEUIL_REFERENCES_EMBARQUEES_ARTICLE` (`referencesTronquees`). Pagination v2 par curseur,
   * même patron que `lister()` ci-dessus — 404 explicite si l'article n'existe pas pour ce tenant
   * (cohérent avec toute autre sous-ressource de ce module, ex. `service-stock.ts::disponibilite`).
   */
  async listerReferences(
    ctx: ContexteTenant,
    articleId: string,
    params: FiltresReferencesArticle,
  ): Promise<PageCurseur<ReponseArticleReference>> {
    const definition = DEFINITIONS_TRI_REFERENCES[params.tri];
    const idExpr = sql`ar.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_REFERENCES,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      const conditions = [sql`ar.tenant_id = ${ctx.tenantId}`, sql`ar.article_id = ${articleId}`];
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneArticleReference & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_REFERENCE_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.article_reference ar
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versArticleReferenceResponse(l)),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: params.tri,
                valeur: valeurCurseurDepuisTri(definition, derniere.triValeur),
                id: derniere.id,
              })
            : null,
        limite: params.limite,
      };
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
          corps: new CollecteurAvertissements().envelopper(
            versArticleResponse(ligne, role, [], false, []),
          ),
        };
      },
    );
  }

  async parId(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
  ): Promise<ReponseArticle> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(
        tx,
        ctx,
        [articleId],
      );
      return this.assemblerReponse(ligne, role, referencesParArticle, stocksParArticle);
    });
  }

  /**
   * `PATCH /articles/{id}` — `corpsBrut` reste NON PARSÉ à l'entrée du service, jamais un
   * `EntreeModificationArticle` déjà passé par zod côté contrôleur (F-01-bis, même défaut que
   * `ServiceClient.modifier` / `ServiceClientSousCollections.modifierAdresse`, voir
   * `common/validation/champs-envoyes.ts`) : `schemaModificationArticle` porte
   * `estEchangeStandard.default(false)`, que `.partial()` rend FACULTATIF sans annuler le défaut.
   * Un `PATCH` qui ne mentionne jamais `estEchangeStandard` ressort du `.parse()` avec
   * `estEchangeStandard: false` injecté — et cette valeur fantôme désynchronise
   * `montantConsigneTtcCentimes` (toujours en base), ce qui fait taire
   * `ServiceConsigne.consigneAGenerer` (`RP-37` : plus de consigne facturée/restituée à la
   * réalisation d'une ligne d'échange standard). `neGarderQueChampsEnvoyes` ne retient que les
   * clés réellement présentes dans `corpsBrut` — c'est elle, jamais `entree.champ !== undefined`
   * (toujours vrai après coup pour un champ à défaut), qui distingue « non envoyé » de « envoyé
   * false ».
   */
  async modifier(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    corpsBrut: Record<string, unknown>,
  ): Promise<ReponseAvecAvertissements<ReponseArticle>> {
    const entreeParsee = new PipeZod(schemaModificationArticle).transform(corpsBrut);
    const entree = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);

    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      const valeurs: Partial<NouvelArticle> = {};
      if ('designation' in entree && entree.designation !== undefined)
        valeurs.designation = entree.designation;
      if ('marque' in entree) valeurs.marque = entree.marque ?? null;
      if ('categorie' in entree && entree.categorie !== undefined)
        valeurs.categorie = entree.categorie;
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
        await tx
          .update(article)
          .set(valeurs)
          .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)));
      }

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(
        tx,
        ctx,
        [articleId],
      );
      return new CollecteurAvertissements().envelopper(
        this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle),
      );
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
        .where(
          and(
            eq(articleReference.tenantId, ctx.tenantId),
            eq(articleReference.reference, entree.reference),
          ),
        )
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
          .where(
            and(eq(articleReference.tenantId, ctx.tenantId), eq(articleReference.id, existante.id)),
          );
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
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(
        tx,
        ctx,
        [articleId],
      );
      return new CollecteurAvertissements().envelopper(
        this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle),
      );
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
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(
        tx,
        ctx,
        [articleId],
      );
      return new CollecteurAvertissements().envelopper(
        this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle),
      );
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

      await tx
        .update(article)
        .set({ statut: 'desactive' })
        .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)));

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(
        tx,
        ctx,
        [articleId],
      );
      return new CollecteurAvertissements().envelopper(
        this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle),
      );
    });
  }

  /** `POST /articles/{id}/reactiver` — retour à `actif` depuis `obsolete` ou `desactive` (§6.1). */
  async reactiver(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
  ): Promise<ReponseAvecAvertissements<ReponseArticle>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, articleId);

      await tx
        .update(article)
        .set({ statut: 'actif', referenceRemplacementId: null })
        .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)));

      const ligneMaj = await this.chargerOu404(tx, ctx, articleId);
      const { referencesParArticle, stocksParArticle } = await this.chargerSousCollections(
        tx,
        ctx,
        [articleId],
      );
      return new CollecteurAvertissements().envelopper(
        this.assemblerReponse(ligneMaj, role, referencesParArticle, stocksParArticle),
      );
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
    const references = referencesToutes
      .slice(0, SEUIL_REFERENCES_EMBARQUEES)
      .map(versArticleReferenceResponse);
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
      .where(
        and(
          eq(articleReference.tenantId, ctx.tenantId),
          inArray(articleReference.articleId, [...articleIds]),
        ),
      )
      .orderBy(articleReference.creeLe);
    const stocks = await tx
      .select()
      .from(stockArticle)
      .where(
        and(
          eq(stockArticle.tenantId, ctx.tenantId),
          inArray(stockArticle.articleId, [...articleIds]),
        ),
      );

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

  private async chargerOu404(
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
}
