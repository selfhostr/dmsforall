import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  EntreeCreationAjustementInventaire,
  EntreeCreationMouvementCasse,
  EntreeCreationMouvementPerte,
  EntreeCreationMouvementRetourClient,
  EntreeCreationMouvementSortieComptoir,
  EntreeCreationMouvementTransfert,
  EntreeCreationRetourFournisseur,
  FiltresMouvementsStock,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseMouvementStock,
  RoleUtilisateur,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { article, mouvementStock, parametrePieces, site } from '../db/schema';
import type { LigneMouvementStock, NouveauMouvementStock } from '../db/schema';
import { MATRICE_DROITS } from '../auth/matrice-droits';
import { CollecteurAvertissements } from '../common/avertissements';
import { remonterCausePg } from '../common/erreurs-pg/remonter-cause-pg';
import { ErreurMetier } from '../common/erreurs';
import { JETON_IDEMPOTENCE } from '../common/idempotence';
import type {
  ReponseMemorisable,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';

import { versMouvementResponse } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';
import { ServiceStock } from './service-stock';

const DEFINITIONS_TRI_MOUVEMENTS: Readonly<Record<FiltresMouvementsStock['tri'], DefinitionTri>> = {
  'creeLe:desc': { expression: sql`m.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`m.cree_le`, sens: 'asc', nullable: false, temporel: true },
};

const COLONNES_MOUVEMENT_ALIASEES = sql`
  m.id as "id", m.article_id as "articleId", m.type as "type", m.quantite_millieme as "quantiteMillieme",
  m.site_id as "siteId", m.site_source_id as "siteSourceId", m.site_destination_id as "siteDestinationId",
  m.prix_achat_reel_centimes as "prixAchatReelCentimes", m.auteur_id as "auteurId", m.motif as "motif",
  m.ligne_or_id as "ligneOrId", m.document_vente_ligne_id as "documentVenteLigneId",
  m.commande_fournisseur_ligne_id as "commandeFournisseurLigneId",
  m.inventaire_reference_id as "inventaireReferenceId", m.reservation_id as "reservationId",
  m.cree_le as "creeLe"
`;

export interface ResultatCreationMouvement {
  readonly statutHttp: number;
  readonly corps: ReponseMouvementStock;
}

export interface ResultatAjustementInventaire {
  readonly statutHttp: number;
  readonly corps: ReponseAvecAvertissements<ReponseMouvementStock | null>;
}

/**
 * Service mouvements de stock (RP-16 → RP-18) : historique et les SEPT actions à déclenchement
 * direct (`casse`, `perte`, `transfert`, `ajustement-inventaire`, `retour-fournisseur`,
 * `sortie-comptoir`, `retour-client` — `mouvement.ts`, note d'intégration en fin de fichier
 * partagé : le lien transactionnel vers un document de vente facturation reste hors périmètre,
 * seule la voie manuelle directe est couverte ici). `mouvement_stock` est IMMUABLE (0025) : ce
 * service n'insère jamais qu'une ligne, ne met jamais à jour ni ne supprime.
 *
 * GAP DE CONTRAT signalé (voir rapport de livraison) : aucune des cinq actions ne déclare de type
 * de réponse explicite. Inféré : le mouvement créé (`ReponseMouvementStock`), SAUF
 * `ajustement-inventaire` quand le compte correspond déjà au stock physique — la base interdit un
 * mouvement de quantité nulle (`mouvement_stock_quantite_non_nulle_chk`, 0025) ; dans ce cas précis
 * `donnees: null` est renvoyé, aucune ligne n'est créée.
 */
@Injectable()
export class ServiceMouvement {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
  ) {}

  async lister(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    params: FiltresMouvementsStock,
  ): Promise<PageCurseur<ReponseMouvementStock>> {
    const definition = DEFINITIONS_TRI_MOUVEMENTS[params.tri];
    const idExpr = sql`m.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_MOUVEMENTS,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerArticleOu404(tx, ctx, articleId);

      const conditions = [sql`m.tenant_id = ${ctx.tenantId}`, sql`m.article_id = ${articleId}`];
      if (params.type && params.type.length > 0) {
        conditions.push(
          sql`m.type::text in (${sql.join(
            params.type.map((t) => sql`${t}`),
            sql`, `,
          )})`,
        );
      }
      if (params.siteId) {
        conditions.push(
          sql`(m.site_id = ${params.siteId} or m.site_source_id = ${params.siteId} or m.site_destination_id = ${params.siteId})`,
        );
      }
      if (params.dateDe) conditions.push(sql`m.cree_le >= ${params.dateDe}::date`);
      if (params.dateA)
        conditions.push(sql`m.cree_le < (${params.dateA}::date + interval '1 day')`);
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneMouvementStock & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_MOUVEMENT_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.mouvement_stock m
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versMouvementResponse(l, role)),
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

  async casse(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationMouvementCasse,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationMouvement & ReponseMemorisable>> {
    return this.creerMouvementSortie(
      ctx,
      role,
      'casse',
      articleId,
      entree.siteId,
      entree.quantiteMillieme,
      entree.forcer,
      {
        motif: entree.motif,
        ligneOrId: entree.ligneOrId ?? null,
        chemin: '/articles/{id}/mouvements/casse',
        cleIdempotence,
        entree,
      },
    );
  }

  async perte(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationMouvementPerte,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationMouvement & ReponseMemorisable>> {
    return this.creerMouvementSortie(
      ctx,
      role,
      'perte',
      articleId,
      entree.siteId,
      entree.quantiteMillieme,
      entree.forcer,
      {
        motif: entree.motif,
        ligneOrId: entree.ligneOrId ?? null,
        chemin: '/articles/{id}/mouvements/perte',
        cleIdempotence,
        entree,
      },
    );
  }

  async retourFournisseur(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationRetourFournisseur,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationMouvement & ReponseMemorisable>> {
    return this.creerMouvementSortie(
      ctx,
      role,
      'retour_fournisseur',
      articleId,
      entree.siteId,
      entree.quantiteMillieme,
      false,
      {
        motif: entree.motif,
        commandeFournisseurLigneId: entree.commandeFournisseurLigneId ?? null,
        chemin: '/articles/{id}/mouvements/retour-fournisseur',
        cleIdempotence,
        entree,
      },
    );
  }

  /**
   * `POST /articles/{id}/mouvements/sortie-comptoir` — vente DIRECTE au comptoir, SANS ligne OR ni
   * document de vente (`documentVenteLigneId` reste `null`, voir la note d'intégration de
   * `mouvement.ts`). Même garantie de disponibilité que `casse`/`perte` (`verifierDisponible`,
   * verrou `for update`), mais PAS de `forcer` : une vente n'a pas la même légitimité qu'une casse
   * à contourner le refus (décision de contrat documentée dans `mouvement.ts`).
   */
  async sortieComptoir(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationMouvementSortieComptoir,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationMouvement & ReponseMemorisable>> {
    return this.creerMouvementSortie(
      ctx,
      role,
      'sortie_comptoir',
      articleId,
      entree.siteId,
      entree.quantiteMillieme,
      false,
      {
        motif: entree.motif ?? null,
        chemin: '/articles/{id}/mouvements/sortie-comptoir',
        cleIdempotence,
        entree,
      },
    );
  }

  /**
   * `POST /articles/{id}/mouvements/retour-client` — le client rapporte une pièce : remet la
   * quantité en stock PHYSIQUE du site (mouvement `+`). Aucune vérification de disponibilité (une
   * ENTRÉE n'est jamais refusée pour stock insuffisant) — même famille d'écriture que `transfert`
   * côté destination, pas `creerMouvementSortie`.
   */
  async retourClient(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationMouvementRetourClient,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationMouvement & ReponseMemorisable>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/articles/{id}/mouvements/retour-client',
        cle: cleIdempotence,
        corps: { articleId, ...entree },
      },
      async (tx) => {
        await this.chargerArticleOu404(tx, ctx, articleId);
        await this.chargerSiteOu404(tx, ctx, entree.siteId);

        const valeurs: NouveauMouvementStock = {
          tenantId: ctx.tenantId,
          articleId,
          type: 'retour_client',
          quantiteMillieme: entree.quantiteMillieme,
          siteId: entree.siteId,
          motif: entree.motif,
          auteurId: ctx.utilisateurId,
        };
        const [ligne] = await tx.insert(mouvementStock).values(valeurs).returning();
        if (!ligne) {
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            'Échec de création du mouvement de retour client.',
          );
        }
        return { statutHttp: 201, corps: versMouvementResponse(ligne, role) };
      },
    );
  }

  async transfert(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationMouvementTransfert,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationMouvement & ReponseMemorisable>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/articles/{id}/mouvements/transfert',
        cle: cleIdempotence,
        corps: { articleId, ...entree },
      },
      async (tx) => {
        await this.chargerArticleOu404(tx, ctx, articleId);
        await this.chargerSiteOu404(tx, ctx, entree.siteSourceId);
        await this.chargerSiteOu404(tx, ctx, entree.siteDestinationId);
        await this.verifierDisponible(
          tx,
          ctx,
          articleId,
          entree.siteSourceId,
          entree.quantiteMillieme,
          false,
        );

        const valeurs: NouveauMouvementStock = {
          tenantId: ctx.tenantId,
          articleId,
          type: 'transfert',
          quantiteMillieme: entree.quantiteMillieme,
          siteId: null,
          siteSourceId: entree.siteSourceId,
          siteDestinationId: entree.siteDestinationId,
          motif: entree.motif ?? null,
          auteurId: ctx.utilisateurId,
        };
        const [ligne] = await tx.insert(mouvementStock).values(valeurs).returning();
        if (!ligne)
          throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du mouvement de transfert.');
        return { statutHttp: 201, corps: versMouvementResponse(ligne, role) };
      },
    );
  }

  async ajustementInventaire(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    articleId: string,
    entree: EntreeCreationAjustementInventaire,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatAjustementInventaire & ReponseMemorisable>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/articles/{id}/mouvements/ajustement-inventaire',
        cle: cleIdempotence,
        corps: { articleId, ...entree },
      },
      async (tx) => {
        const ligneArticle = await this.chargerArticleOu404(tx, ctx, articleId);
        await this.chargerSiteOu404(tx, ctx, entree.siteId);

        const { physique } = await ServiceStock.chargerPourVerrou(
          tx,
          ctx,
          articleId,
          entree.siteId,
        );
        const delta = entree.quantiteCompteeMillieme - physique;

        if (delta === 0) {
          return { statutHttp: 200, corps: new CollecteurAvertissements().envelopper(null) };
        }

        const valeurs: NouveauMouvementStock = {
          tenantId: ctx.tenantId,
          articleId,
          type: 'ajustement_inventaire',
          quantiteMillieme: delta,
          siteId: entree.siteId,
          motif: entree.motif,
          auteurId: ctx.utilisateurId,
        };
        const [ligne] = await tx.insert(mouvementStock).values(valeurs).returning();
        if (!ligne)
          throw new ErreurMetier('ERREUR_INTERNE', "Échec de création du mouvement d'ajustement.");

        const collecteur = new CollecteurAvertissements();
        const seuil = await this.chargerSeuilAjustement(tx, ctx);
        if (seuil !== null && ligneArticle.prixAchatCentimes !== null) {
          const valeurEcart = Math.abs(delta / 1000) * ligneArticle.prixAchatCentimes;
          if (valeurEcart > seuil) {
            collecteur.ajouter(
              'INVENTAIRE_ECART_SIGNIFICATIF',
              `Écart d'inventaire significatif : ${String(Math.abs(delta))} millièmes (valeur estimée ${String(Math.round(valeurEcart))} centimes).`,
              {
                articleId,
                siteId: entree.siteId,
                deltaMillieme: delta,
                valeurEcartCentimes: Math.round(valeurEcart),
              },
            );
          }
        }

        return {
          statutHttp: 201,
          corps: collecteur.envelopper(versMouvementResponse(ligne, role)),
        };
      },
    );
  }

  private async creerMouvementSortie(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    type: 'casse' | 'perte' | 'retour_fournisseur' | 'sortie_comptoir',
    articleId: string,
    siteId: string,
    quantiteMillieme: number,
    forcer: boolean,
    options: {
      readonly motif: string | null;
      readonly ligneOrId?: string | null;
      readonly commandeFournisseurLigneId?: string | null;
      readonly chemin: string;
      readonly cleIdempotence: string;
      readonly entree: unknown;
    },
  ): Promise<ResultatIdempotent<ResultatCreationMouvement & ReponseMemorisable>> {
    // FAILLE CORRIGÉE (audit sécurité) : `forcer` exige désormais `pieces.mouvement.forcer` EN PLUS
    // du droit qui a laissé passer la requête jusqu'ici (`pieces.mouvement.creer`, vérifié par le
    // contrôleur). Vérifié AVANT toute écriture d'idempotence et tout accès base (même position que
    // `ServiceEmissionDocument.verifierDroitEmission`) — jamais quand `forcer` est absent/`false`,
    // sinon la création normale non forcée serait aussi bloquée. Voir `auth/matrice-droits.ts`
    // (`FORCAGE_MOUVEMENT_PIECES`) et `common/droits/allowlist-actions-non-decorees.ts` (entrée
    // `pieces.mouvement.forcer`) pour la doctrine complète.
    this.exigerDroitForcage(role, forcer);

    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: options.chemin,
        cle: options.cleIdempotence,
        corps: { articleId, ...(options.entree as object) },
      },
      async (tx) => {
        await this.chargerArticleOu404(tx, ctx, articleId);
        await this.chargerSiteOu404(tx, ctx, siteId);
        await this.verifierDisponible(tx, ctx, articleId, siteId, quantiteMillieme, forcer);

        const valeurs: NouveauMouvementStock = {
          tenantId: ctx.tenantId,
          articleId,
          type,
          quantiteMillieme: -quantiteMillieme,
          siteId,
          motif: options.motif,
          ligneOrId: options.ligneOrId ?? null,
          commandeFournisseurLigneId: options.commandeFournisseurLigneId ?? null,
          auteurId: ctx.utilisateurId,
        };
        try {
          const [ligne] = await tx.insert(mouvementStock).values(valeurs).returning();
          if (!ligne)
            throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du mouvement de stock.');
          return { statutHttp: 201, corps: versMouvementResponse(ligne, role) };
        } catch (erreur) {
          // Filet de sécurité DERRIÈRE `verifierDisponible` (qui tranche le refus normal, non
          // forcé, en amont sous verrou `for update`) : si malgré tout la ligne finale violait
          // `stock_article_reservee_leq_physique_chk` (0025 — ex. `forcer: true` qui rendrait
          // `physique < reservee`), ce refus ne doit JAMAIS fuiter en 500 `ERREUR_INTERNE`.
          // Drizzle enveloppe l'erreur `pg` brute sous `.cause` (`DrizzleQueryError`) —
          // `remonterCausePg` déballe cette chaîne avant comparaison, voir son en-tête.
          if (erreur instanceof ErreurMetier) throw erreur;
          if (estViolationStockInsuffisant(erreur)) {
            throw new ErreurMetier(
              'STOCK_INSUFFISANT',
              'Stock disponible insuffisant (contrainte base — filet de sécurité).',
              {
                detail: `tenant=${ctx.tenantId};article=${articleId};site=${siteId};type=${type}`,
              },
            );
          }
          throw erreur;
        }
      },
    );
  }

  /**
   * RP-15/PP-02 : refuse (`409 STOCK_INSUFFISANT`) si `quantiteDemandee` dépasse le disponible,
   * sauf `forcer: true` — l'AUTORISATION de forcer reste à arbitrer côté droits (non tranchée par
   * ce lot, voir le rapport de livraison) : tout appelant qui a `pieces.mouvement.creer` peut
   * forcer aujourd'hui. Verrouille la ligne `stock_article` (`ServiceStock.chargerPourVerrou`,
   * `select … for update`) — même garantie de concurrence que `reservation_piece_verrouiller_stock`
   * (0026), appliquée ici côté application puisqu'aucune contrainte de base n'interdit un
   * physique négatif (RP-15 l'autorise explicitement sous forçage, voir 0025 §tête).
   *
   * ARBITRAGE, MESURÉ EN EXÉCUTION (`pont-atelier-pieces.spec.ts`, section `pieces.mouvement.
   * forcer`) : `forcer: true` est structurellement INERTE pour `casse`/`perte`/
   * `retour_fournisseur` dès que `quantiteDemandee` dépasse le `disponible` — pas seulement dans
   * le cas extrême du 100%. Ces trois types NE touchent JAMAIS `quantite_reservee_millieme`
   * (contrairement à `ServiceReservation.appliquerSatisfaction`, `pieces/service-reservation.ts`,
   * qui libère la réservée dans LA MÊME opération) ; ignorer ce refus applicatif (ce que fait
   * `forcer`) revient alors TOUJOURS à tenter un `physique_après = physique − quantiteDemandee`
   * strictement inférieur à `reservee` (par définition de « dépasser le disponible » quand
   * `reservee` ne bouge pas) — `stock_article_reservee_leq_physique_chk` (0025, invariant ABSOLU
   * d'après 0026 §tête : « la réservation ne peut jamais dépasser le disponible ») le refuse alors
   * INCONDITIONNELLEMENT, `forcer` ou pas (`estViolationStockInsuffisant` traduit ce refus en
   * `409 STOCK_INSUFFISANT`, jamais un `500` — voir le `catch` de `creerMouvementSortie` — mais
   * l'ISSUE, elle, ne change jamais).
   *
   * CE N'EST PAS UN BUG À CONTOURNER : lever cette garde (ex. en faisant AUSSI reculer `reservee`
   * dans ces trois mouvements) reviendrait à laisser une casse/perte au comptoir consommer
   * SILENCIEUSEMENT une pièce déjà PROMISE à un OR ouvert — exactement ce que RP-14/CP-02
   * (`0026_pieces_reservation.sql` §tête) interdisent nommément. `forcer` garde donc un rôle réel
   * et borné : passer outre le refus applicatif PRÉCOCE pour les cas où `physique` seul (jamais
   * `reservee`) couvre encore la demande au-delà du calcul naïf `verifierDisponible` — aucun cas
   * de ce type n'existe aujourd'hui pour `casse`/`perte`/`retour_fournisseur` (le calcul EST déjà
   * exact), donc `forcer` n'a, EN PRATIQUE, aucun effet observable pour ces trois types tant que
   * `reservee` reste hors de leur portée. Ne pas « corriger » en affaiblissant l'invariant : le
   * paramètre doit rester sans pouvoir plutôt que de rendre le stock incohérent.
   */
  private async verifierDisponible(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
    quantiteDemandee: number,
    forcer: boolean,
  ): Promise<void> {
    const { physique, reservee } = await ServiceStock.chargerPourVerrou(tx, ctx, articleId, siteId);
    const disponible = physique - reservee;
    if (quantiteDemandee > disponible && !forcer) {
      throw new ErreurMetier(
        'STOCK_INSUFFISANT',
        `Stock disponible insuffisant : disponible ${String(disponible)}, demandé ${String(quantiteDemandee)}.`,
        {
          detail: `tenant=${ctx.tenantId};article=${articleId};site=${siteId};disponible=${String(disponible)};demande=${String(quantiteDemandee)}`,
        },
      );
    }
  }

  /**
   * FAILLE CORRIGÉE (audit sécurité) : `pieces.mouvement.forcer` gouverne EXCLUSIVEMENT le
   * passage outre `409 STOCK_INSUFFISANT` — n'a aucun effet et n'est jamais vérifié quand
   * `forcer` est absent/`false` (la création normale reste ouverte à tout rôle qui a
   * `pieces.mouvement.creer`, contrôlé par le contrôleur, pas ici).
   */
  private exigerDroitForcage(role: RoleUtilisateur, forcer: boolean): void {
    if (!forcer) return;
    const droitsDuRole = MATRICE_DROITS[role] ?? [];
    if (!droitsDuRole.includes('pieces.mouvement.forcer')) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        `Le rôle "${role}" n'a pas le droit de forcer un mouvement de stock au-delà du disponible (paramètre "forcer", RP-15/PP-02).`,
      );
    }
  }

  /**
   * Variante composable de `sortieComptoir`, `tx` déjà ouvert en PREMIER paramètre — même
   * convention que `ServiceReservation.satisfaireTx` (`pieces/service-reservation.ts`), pour LA
   * MÊME raison documentée là-bas : `AccesBase.enTenant`, appelé depuis l'intérieur d'un `tx` déjà
   * ouvert, acquiert une connexion NEUVE avec son propre BEGIN/COMMIT — aucune atomicité réelle.
   * Seule cette variante, qui reçoit le `tx` de l'appelant, pose un vrai point de reprise commun.
   *
   * Appelée par `ServiceDocumentsVente.inserterLigne` (`facturation/documents/service-documents.ts`)
   * DANS LA MÊME TRANSACTION que l'`INSERT` de la ligne de document (`RP-43`, note d'intégration de
   * `contrats/pieces/mouvement.ts`) — jamais depuis un second `POST` HTTP indépendant. AUCUN
   * `Idempotency-Key` ici : la déduplication appartient à l'appelant HTTP (`ajouterLigne`), qui n'en
   * porte pas lui-même aujourd'hui (gap signalé au rapport de livraison, hors périmètre de ce
   * fichier).
   *
   * PAS de `forcer` (même contrat que `sortieComptoir`, l'entrypoint HTTP direct) : une vente
   * comptoir n'a jamais la légitimité de `casse`/`perte` à contourner `409 STOCK_INSUFFISANT` —
   * décision de contrat déjà posée dans `mouvement.ts`, reconduite ici à l'identique.
   */
  async sortieComptoirPourLigneTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    params: {
      readonly articleId: string;
      readonly siteId: string;
      readonly quantiteMillieme: number;
      readonly documentVenteLigneId: string;
      readonly motif: string | null;
    },
  ): Promise<ReponseMouvementStock> {
    await this.chargerArticleOu404(tx, ctx, params.articleId);
    await this.chargerSiteOu404(tx, ctx, params.siteId);
    await this.verifierDisponible(
      tx,
      ctx,
      params.articleId,
      params.siteId,
      params.quantiteMillieme,
      false,
    );

    const valeurs: NouveauMouvementStock = {
      tenantId: ctx.tenantId,
      articleId: params.articleId,
      type: 'sortie_comptoir',
      quantiteMillieme: -params.quantiteMillieme,
      siteId: params.siteId,
      motif: params.motif,
      documentVenteLigneId: params.documentVenteLigneId,
      auteurId: ctx.utilisateurId,
    };
    try {
      const [ligne] = await tx.insert(mouvementStock).values(valeurs).returning();
      if (!ligne) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          'Échec de création du mouvement de sortie comptoir (pont facturation, RP-43).',
        );
      }
      return versMouvementResponse(ligne, role);
    } catch (erreur) {
      // Même filet que `creerMouvementSortie` — voir sa docstring pour le détail du déballage
      // `remonterCausePg`.
      if (erreur instanceof ErreurMetier) throw erreur;
      if (estViolationStockInsuffisant(erreur)) {
        throw new ErreurMetier(
          'STOCK_INSUFFISANT',
          'Stock disponible insuffisant (contrainte base — filet de sécurité, pont facturation RP-43).',
          {
            detail: `tenant=${ctx.tenantId};article=${params.articleId};site=${params.siteId};type=sortie_comptoir`,
          },
        );
      }
      throw erreur;
    }
  }

  /**
   * Variante composable de `retourClient`, même convention que `sortieComptoirPourLigneTx`
   * ci-dessus — appelée par `ServiceAvoir.creer` (`facturation/documents/service-avoir.ts`) DANS
   * LA MÊME TRANSACTION que l'`INSERT` de la ligne d'avoir, quand cet avoir crédite INTÉGRALEMENT
   * une ligne de facture qui avait elle-même déclenché un mouvement `sortie_comptoir` (`RP-46`).
   * `documentVenteLigneId` référence la ligne de l'AVOIR (celle qui vient d'être insérée), pas la
   * ligne de la facture d'origine — symétrique de `sortieComptoirPourLigneTx`, qui référence la
   * ligne de la facture.
   *
   * Aucune vérification de disponibilité (même doctrine que `retourClient`, l'entrypoint HTTP
   * direct) : une ENTRÉE de stock n'est jamais refusée pour stock insuffisant.
   */
  async retourClientPourLigneTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    params: {
      readonly articleId: string;
      readonly siteId: string;
      readonly quantiteMillieme: number;
      readonly documentVenteLigneId: string;
      readonly motif: string;
    },
  ): Promise<ReponseMouvementStock> {
    await this.chargerArticleOu404(tx, ctx, params.articleId);
    await this.chargerSiteOu404(tx, ctx, params.siteId);

    const valeurs: NouveauMouvementStock = {
      tenantId: ctx.tenantId,
      articleId: params.articleId,
      type: 'retour_client',
      quantiteMillieme: params.quantiteMillieme,
      siteId: params.siteId,
      motif: params.motif,
      documentVenteLigneId: params.documentVenteLigneId,
      auteurId: ctx.utilisateurId,
    };
    const [ligne] = await tx.insert(mouvementStock).values(valeurs).returning();
    if (!ligne) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        'Échec de création du mouvement de retour client (pont facturation, RP-46).',
      );
    }
    return versMouvementResponse(ligne, role);
  }

  /**
   * Cherche le mouvement de stock qui référence CETTE ligne de document de vente, s'il en existe
   * un (`mouvement_stock.document_vente_ligne_id`) — au plus un par construction (une ligne ne
   * déclenche jamais deux mouvements). Sert deux besoins :
   *  1. `ServiceDocumentsVente.modifierLigne`/`supprimerLigne` : refuser toute écriture sur une
   *     ligne déjà liée à un mouvement (`409 LIGNE_DOCUMENT_STOCK_LIEE`) — le mouvement est
   *     IMMUABLE (RP-18), la ligne qui l'a fait naître le devient avec lui.
   *  2. `ServiceAvoir.creer` : retrouver `articleId`/`siteId`/quantité du mouvement `sortie_comptoir`
   *     d'origine pour fabriquer le `retour_client` symétrique (`RP-46`) — ces trois valeurs ne
   *     sont PAS persistées sur `ligne_document` (voir la note d'intégration de
   *     `contrats/pieces/mouvement.ts`), le mouvement est la SEULE source qui les porte encore.
   *
   * Pas de verrou (`for update`) : appelée en LECTURE avant une décision, jamais pour protéger une
   * écriture concurrente sur `mouvement_stock` lui-même (immuable, aucun UPDATE n'existe à
   * protéger).
   */
  async trouverMouvementParLigneDocumentTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    documentVenteLigneId: string,
  ): Promise<LigneMouvementStock | null> {
    const resultat = await tx.execute<LigneMouvementStock>(sql`
      select ${COLONNES_MOUVEMENT_ALIASEES} from public.mouvement_stock m
       where m.tenant_id = ${ctx.tenantId} and m.document_vente_ligne_id = ${documentVenteLigneId}
       limit 1
    `);
    return resultat.rows[0] ?? null;
  }

  private async chargerSeuilAjustement(
    tx: TransactionDfa,
    ctx: ContexteTenant,
  ): Promise<number | null> {
    const lignes = await tx
      .select({ seuil: parametrePieces.seuilValeurAjustementSignificatifCentimes })
      .from(parametrePieces)
      .where(eq(parametrePieces.tenantId, ctx.tenantId))
      .limit(1);
    return lignes[0]?.seuil ?? null;
  }

  private async chargerArticleOu404(tx: TransactionDfa, ctx: ContexteTenant, articleId: string) {
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

/**
 * `23514` = SQLSTATE générique de violation CHECK ; `stock_article_reservee_leq_physique_chk`
 * (0025) est la seule CHECK de `stock_article` qu'une SORTIE peut faire échouer. Drizzle enveloppe
 * systématiquement l'erreur `pg` brute dans une `DrizzleQueryError` qui ne porte `code`/`constraint`
 * que sous `.cause` (jamais en surface) — `remonterCausePg` déballe cette chaîne avant comparaison.
 * Voir `common/erreurs-pg/remonter-cause-pg.ts` pour le détail du défaut corrigé ailleurs dans le
 * dépôt (imputations, ventes) : sans ce déballage, ce filet de dernier recours ne se déclencherait
 * JAMAIS et une violation résiduelle fuirait en 500 `ERREUR_INTERNE` au lieu du 409
 * `STOCK_INSUFFISANT` écrit juste au-dessus.
 */
export function estViolationStockInsuffisant(erreur: unknown): boolean {
  const brute = remonterCausePg(erreur);
  return brute?.code === '23514' && brute.constraint === 'stock_article_reservee_leq_physique_chk';
}
