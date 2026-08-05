import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { FiltresConsignes, PageCurseur, ReponseConsigneEchangeStandard } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { article, consigneEchangeStandard, mouvementStock } from '../db/schema';
import type {
  LigneArticle,
  LigneConsigneEchangeStandard,
  NouveauMouvementStock,
  NouvelleConsigneEchangeStandard,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import { versConsigneResponse } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';

const DEFINITIONS_TRI_CONSIGNES: Readonly<Record<FiltresConsignes['tri'], DefinitionTri>> = {
  'creeLe:desc': { expression: sql`c.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`c.cree_le`, sens: 'asc', nullable: false, temporel: true },
};

const COLONNES_CONSIGNE_ALIASEES = sql`
  c.id as "id", c.tenant_id as "tenantId", c.ligne_or_id as "ligneOrId", c.ordre_reparation_id as "ordreReparationId",
  c.article_id as "articleId", c.site_id as "siteId", c.statut as "statut",
  c.montant_consigne_ttc_centimes as "montantConsigneTtcCentimes",
  c.document_vente_ligne_consigne_id as "documentVenteLigneConsigneId", c.mouvement_entree_id as "mouvementEntreeId",
  c.retournee_fournisseur_le as "retourneeFournisseurLe", c.mouvement_retour_id as "mouvementRetourId",
  c.avoir_document_id as "avoirDocumentId", c.cree_le as "creeLe"
`;

/**
 * Service consigne d'échange standard (RP-37 → RP-42, §6.4) — priorité 3 du lot. AUCUN `POST
 * /consignes` côté contrat HTTP : la pose de la consigne est un effet de bord serveur de la
 * réalisation d'une ligne d'OR de dépose (`atelier/service-ligne-or.ts::marquerRealisee`, GELÉ côté
 * contrat, hors ressource propre) — couverte ici par `creerDepuisRealisationTx`, une variante
 * composable SANS entrypoint HTTP à elle (voir sa doc). Ce service couvre par ailleurs la lecture
 * transverse (§7.7 : « une consigne jamais rendue est de l'argent qui dort ») et l'unique action
 * HTTP nommée du cycle de vie, `marquer-retour-fournisseur`.
 */
@Injectable()
export class ServiceConsigne {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    params: FiltresConsignes,
  ): Promise<PageCurseur<ReponseConsigneEchangeStandard>> {
    const definition = DEFINITIONS_TRI_CONSIGNES[params.tri];
    const idExpr = sql`c.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`c.tenant_id = ${ctx.tenantId}`];
      if (params.statut && params.statut.length > 0) {
        conditions.push(
          sql`c.statut::text in (${sql.join(
            params.statut.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      if (params.siteId) conditions.push(sql`c.site_id = ${params.siteId}`);
      // §7.7 : « une liste de consignes non soldées après N jours (P) » — filtre serveur sur
      // `creeLe`, AUCUNE action de ce service ne solde une consigne automatiquement (RP-41,
      // non tranché — voir `contrats/pieces/parametrage.ts::delaiConsigneAcquisitionJours`).
      if (params.ancienneteJoursMin !== undefined) {
        conditions.push(
          sql`c.cree_le <= now() - make_interval(days => ${params.ancienneteJoursMin})`,
        );
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneConsigneEchangeStandard & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_CONSIGNE_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.consigne_echange_standard c
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versConsigneResponse(l)),
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
   * `POST /consignes/{id}/marquer-retour-fournisseur` — le geste de comptoir de RP-40. Ouvre SA
   * PROPRE transaction — entrypoint HTTP autonome, voir `marquerRetourFournisseurTx`.
   */
  async marquerRetourFournisseur(
    ctx: ContexteTenant,
    id: string,
  ): Promise<ReponseConsigneEchangeStandard> {
    return this.acces.enTenant(ctx, (tx) => this.marquerRetourFournisseurTx(tx, ctx, id));
  }

  /**
   * Variante composable de `marquerRetourFournisseur`, `tx` déjà ouvert en premier paramètre (même
   * convention que `chargerXxx`/`listerXxx` et que `ServiceReservation.satisfaireTx`). Génère le
   * mouvement `retour_consigne` (quantité = celle de la ligne d'OR d'origine,
   * `ligne_or.quantiteMillieme` — `consigne_echange_standard` ne porte elle-même aucune quantité,
   * seulement un montant), `statut → retournee_fournisseur` (TERMINAL).
   *
   * RP-40 exige que ce geste et l'avoir partiel côté facturation arrivent ENSEMBLE, « jamais l'un
   * sans l'autre » — ce service ne peut garantir QUE la moitié stock de cette atomicité (même
   * limite que le CHECK `consigne_echange_standard_terminal_coherent_chk`, 0027) : la coordination
   * avec l'avoir de facturation (RF-100) reste un point d'intégration cross-module NON résolu ici,
   * signalé au rapport de livraison, pas tranché seul.
   */
  async marquerRetourFournisseurTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<ReponseConsigneEchangeStandard> {
    const { consigne, quantiteLigneOrMillieme } = await this.chargerAvecQuantiteOu404PourVerrou(
      tx,
      ctx,
      id,
    );
    if (consigne.statut !== 'en_attente_retour_fournisseur') {
      throw new ErreurMetier(
        'CONSIGNE_TRANSITION_INTERDITE',
        `Transition interdite : la consigne est "${consigne.statut}", pas "en_attente_retour_fournisseur" (§6.4).`,
      );
    }

    const valeursMouvement: NouveauMouvementStock = {
      tenantId: ctx.tenantId,
      articleId: consigne.articleId,
      type: 'retour_consigne',
      quantiteMillieme: -quantiteLigneOrMillieme,
      siteId: consigne.siteId,
      auteurId: ctx.utilisateurId,
    };
    const [mouvement] = await tx.insert(mouvementStock).values(valeursMouvement).returning();
    if (!mouvement)
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        'Échec de création du mouvement de retour de consigne.',
      );

    await tx.execute(sql`
      update public.consigne_echange_standard
         set statut = 'retournee_fournisseur', retournee_fournisseur_le = now(), mouvement_retour_id = ${mouvement.id}
       where tenant_id = ${ctx.tenantId} and id = ${id}
    `);

    const ligneMaj = await this.chargerOu404(tx, ctx, id);
    return versConsigneResponse(ligneMaj);
  }

  /**
   * RP-38 (§6.4) : « la ligne d'OR facture pièce + consigne, ET la vieille pièce est réceptionnée
   * en stock, dans le même geste ». Appelée par `ServiceLigneOr.marquerRealisee` (`atelier/`),
   * DANS LA MÊME TRANSACTION que la réservation satisfaite qui la précède (`tx` déjà ouvert, en
   * premier paramètre — même convention que partout ailleurs dans ce fichier) : un mouvement de
   * sortie qui commite sans sa consigne, ou l'inverse, laisserait le stock incohérent, exactement
   * ce que la composition par `tx` unique interdit.
   *
   * `null` si l'article déposé n'est PAS `estEchangeStandard` — pas une consigne, rien à créer.
   *
   * TYPE DE MOUVEMENT SIGNALÉ, PAS TRANCHÉ (hérité du rapport de livraison précédent) :
   * `TYPES_MOUVEMENT_STOCK` (`pieces/mouvement.ts`, GELÉ) n'a AUCUN type dédié à « réception d'un
   * cœur d'échange standard ». Choix retenu ICI : `retour_consigne`, quantité POSITIVE — symétrique
   * du retour au fournisseur (`marquerRetourFournisseurTx`, MÊME type, quantité NÉGATIVE) : les
   * deux jambes du cycle de consigne partagent un type, distinguées par le signe (RP-17 : « signée,
   * positive à l'entrée, négative à la sortie »). À confirmer par expert-api/expert-database —
   * l'enum reste extensible (RP-16) si un type dédié est préféré.
   */
  async creerDepuisRealisationTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    parametres: ParametresCreationConsigneDepuisRealisation,
  ): Promise<ReponseConsigneEchangeStandard | null> {
    const articleLigne = await this.chargerArticleOu404(tx, ctx, parametres.articleId);
    if (!articleLigne.estEchangeStandard) return null;
    if (articleLigne.montantConsigneTtcCentimes === null) {
      // Défensif : `article_consigne_coherente_chk` (migration 0022) garantit que
      // `estEchangeStandard = true` implique `montantConsigneTtcCentimes` non nul en base.
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        `Article ${parametres.articleId} d'échange standard sans montant de consigne (RP-38).`,
      );
    }

    const entreeConsigne: NouveauMouvementStock = {
      tenantId: ctx.tenantId,
      articleId: parametres.articleId,
      type: 'retour_consigne',
      quantiteMillieme: parametres.quantiteMillieme,
      siteId: parametres.siteId,
      ligneOrId: parametres.ligneOrId,
      auteurId: parametres.auteurId,
    };
    const [mouvementEntree] = await tx.insert(mouvementStock).values(entreeConsigne).returning();
    if (!mouvementEntree) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        "Échec de création du mouvement d'entrée de consigne (RP-38).",
      );
    }

    const consigne: NouvelleConsigneEchangeStandard = {
      tenantId: ctx.tenantId,
      ligneOrId: parametres.ligneOrId,
      ordreReparationId: parametres.ordreReparationId,
      articleId: parametres.articleId,
      siteId: parametres.siteId,
      montantConsigneTtcCentimes: articleLigne.montantConsigneTtcCentimes,
      mouvementEntreeId: mouvementEntree.id,
    };
    const [ligneConsigne] = await tx.insert(consigneEchangeStandard).values(consigne).returning();
    if (!ligneConsigne) {
      throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création de la consigne (RP-38).');
    }
    return versConsigneResponse(ligneConsigne);
  }

  private async chargerOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<LigneConsigneEchangeStandard> {
    const resultat = await tx.execute<LigneConsigneEchangeStandard>(sql`
      select ${COLONNES_CONSIGNE_ALIASEES} from public.consigne_echange_standard c
       where c.tenant_id = ${ctx.tenantId} and c.id = ${id}
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Consigne introuvable.');
    return ligne;
  }

  /** `select … for update` sur la consigne, jointe à `ligne_or` pour la quantité (voir `marquerRetourFournisseur`). */
  private async chargerAvecQuantiteOu404PourVerrou(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<{ consigne: LigneConsigneEchangeStandard; quantiteLigneOrMillieme: number }> {
    const resultat = await tx.execute<
      LigneConsigneEchangeStandard & { quantiteLigneOrMillieme: number }
    >(sql`
      select ${COLONNES_CONSIGNE_ALIASEES}, lo.quantite_millieme as "quantiteLigneOrMillieme"
        from public.consigne_echange_standard c
        join public.ligne_or lo on lo.tenant_id = c.tenant_id and lo.id = c.ligne_or_id
       where c.tenant_id = ${ctx.tenantId} and c.id = ${id}
       for update of c
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Consigne introuvable.');
    const { quantiteLigneOrMillieme, ...consigne } = ligne;
    return { consigne, quantiteLigneOrMillieme };
  }

  /** Même doctrine que `ServiceStock`/`ServiceMouvement` (`pieces/`) : chaque service porte sa
   *  propre lecture d'article tenant-scopée plutôt qu'un helper partagé — pas de dépendance de
   *  compilation supplémentaire pour une seule requête. */
  private async chargerArticleOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
  ): Promise<LigneArticle> {
    const [ligne] = await tx
      .select()
      .from(article)
      .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)))
      .limit(1);
    if (!ligne)
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Article ${articleId} introuvable.`);
    return ligne;
  }
}

/** Paramètres de `ServiceConsigne.creerDepuisRealisationTx` — l'appelant (`atelier/`) ne connaît
 *  ni le montant de consigne (dérivé de l'article) ni le mouvement d'entrée (créé ici) : seuls les
 *  identifiants et quantités issus de la ligne d'OR et de sa réservation satisfaite sont à fournir. */
export interface ParametresCreationConsigneDepuisRealisation {
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  readonly articleId: string;
  readonly siteId: string;
  readonly quantiteMillieme: number;
  /** `string | null`, même type que `ContexteTenant.utilisateurId`/`NouveauMouvementStock.auteurId`
   *  (colonne `auteur_id` nullable, `pieces/stock.ts`) — pas de resserrement de type ici. */
  readonly auteurId: string | null;
}
