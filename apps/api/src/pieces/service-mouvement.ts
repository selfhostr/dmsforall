import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { ServiceReservation } from './service-reservation';
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
  private readonly journal = new Logger(ServiceMouvement.name);

  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly reservation: ServiceReservation,
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
        await this.verifierDisponible(tx, ctx, articleId, siteId, quantiteMillieme, forcer, type);

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
   * DÉFAUT CORRIGÉ (0047, mesuré en exécution — `pont-atelier-pieces.spec.ts`, section
   * `pieces.mouvement.forcer`) : `forcer: true` était structurellement INERTE dès que
   * `quantiteDemandee` dépassait le `disponible` — `stock_article_reservee_leq_physique_chk`
   * (0025, `reservee <= physique`) refusait alors INCONDITIONNELLEMENT le mouvement, `forcer` ou
   * pas, y COMPRIS quand `reservee` valait déjà 0 (aucune réservation active — la cause n'était
   * donc PAS seulement « `casse`/`perte` ne libèrent jamais `reservee` », mais la CHECK elle-même,
   * qui interdisait tout `physique` négatif de façon inconditionnelle : voir l'en-tête de la
   * migration 0047 pour la preuve algébrique complète).
   *
   * CORRECTIF, EN DEUX TEMPS :
   *   1. `stock_article_reservee_leq_physique_chk` (0047) devient `reservee <= greatest(physique,
   *      0)` — la réservation ne dépasse jamais le VRAIMENT disponible, y compris quand plus rien
   *      n'est physiquement en stock (le plafond devient 0, pas un nombre négatif inatteignable).
   *   2. Ici : quand `forcer` ferait passer `reservee` au-dessus de ce nouveau plafond (une
   *      réservation ACTIVE promettait une pièce que la casse/perte vient de faire disparaître
   *      PHYSIQUEMENT), `libererCascadeSiNecessaire` réduit en cascade les réservations `active`
   *      de cet (article, site) AVANT l'insertion du mouvement — jamais après, pour que la CHECK
   *      ne voie JAMAIS un état intermédiaire invalide (même discipline d'ordre que le palier de
   *      `ServiceReservation.appliquerSatisfaction`). `casse`/`perte` restent les SEULS types
   *      concernés : ce sont les seuls dont le schéma (`schemaCreationMouvementCasse`,
   *      `contrats/pieces/mouvement.ts`) accepte `forcer` — `retour_fournisseur`/`sortie_comptoir`
   *      ne le reçoivent jamais (leurs appelants, `retourFournisseur`/`sortieComptoir`
   *      ci-dessus, invoquent `creerMouvementSortie` avec `forcer: false` en dur), donc n'entrent
   *      jamais dans cette branche.
   *
   * CE QUI RESTE VRAI, INCHANGÉ : lever la garde `disponible` pour une VENTE (`sortie_comptoir`)
   * resterait faux — laisser une vente comptoir consommer SILENCIEUSEMENT une pièce déjà PROMISE à
   * un OR ouvert reste exactement ce que RP-14/CP-02 interdisent. C'est pour ça que `forcer`
   * n'existe pas du tout sur `sortie_comptoir`/`retour_fournisseur` (décision de contrat déjà
   * posée, `mouvement.ts`) — la cascade ci-dessous ne s'active QUE pour `casse`/`perte`, les deux
   * seuls types où un rôle habilité (`pieces.mouvement.forcer`, réservé à `magasinier`) constate
   * une réalité physique que le système ignorait, jamais une vente qui choisit délibérément de
   * doubler une promesse déjà faite.
   */
  private async verifierDisponible(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
    quantiteDemandee: number,
    forcer: boolean,
    type?: 'casse' | 'perte' | 'retour_fournisseur' | 'sortie_comptoir',
  ): Promise<void> {
    const { physique, reservee } = await ServiceStock.chargerPourVerrou(tx, ctx, articleId, siteId);
    const disponible = physique - reservee;
    if (quantiteDemandee <= disponible) return;

    if (!forcer) {
      throw new ErreurMetier(
        'STOCK_INSUFFISANT',
        `Stock disponible insuffisant : disponible ${String(disponible)}, demandé ${String(quantiteDemandee)}.`,
        {
          detail: `tenant=${ctx.tenantId};article=${articleId};site=${siteId};disponible=${String(disponible)};demande=${String(quantiteDemandee)}`,
        },
      );
    }

    // `forcer: true` ne peut aujourd'hui atteindre cette branche que pour `casse`/`perte` (seuls
    // types dont le schéma accepte le paramètre) — la garde de `type` ci-dessous est une
    // ceinture-et-bretelles délibérée : mieux vaut un cas futur silencieusement SANS cascade (qui
    // referait échouer l'insertion en 409, un refus SÛR) qu'une cascade qui s'activerait un jour
    // pour un type qui n'a pas la légitimité de `casse`/`perte` à consommer une pièce promise.
    if (type !== 'casse' && type !== 'perte') return;

    await this.libererCascadeSiNecessaire(
      tx,
      ctx,
      articleId,
      siteId,
      physique,
      reservee,
      quantiteDemandee,
      type,
    );
  }

  /**
   * Réduit `reservee` (par libération en cascade de réservations `active`, `ServiceReservation.
   * libererPourCascadeForcageTx`) AVANT que le mouvement forcé ne soit inséré, pour que la CHECK
   * `reservee <= greatest(physique, 0)` (0047) ne voie jamais l'état intermédiaire invalide qui
   * existerait si la libération suivait l'insertion. `physique`/`reservee` sont ceux lus SOUS
   * VERROU par l'appelant (`verifierDisponible`) — la ligne `stock_article` reste verrouillée
   * (`for update`, posé par `ServiceStock.chargerPourVerrou`) pendant tout l'appel, aucune autre
   * transaction ne peut modifier `physique`/`reservee` entre-temps.
   */
  private async libererCascadeSiNecessaire(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
    physique: number,
    reservee: number,
    quantiteDemandee: number,
    type: 'casse' | 'perte',
  ): Promise<void> {
    const physiqueApres = physique - quantiteDemandee;
    const plafondReservee = Math.max(physiqueApres, 0);
    if (reservee <= plafondReservee) return;

    const aLiberer = reservee - plafondReservee;
    const liberees = await this.reservation.libererPourCascadeForcageTx(
      tx,
      ctx,
      articleId,
      siteId,
      aLiberer,
    );

    // RP-15 : « forçage explicite ET JOURNALISÉ ». Le mouvement lui-même est audité
    // (`mouvement_stock_audit`, 0025) et chaque réservation libérée porte sa propre trace
    // (`motif_liberation = 'liberation_forcage_stock'`, `liberee_le`, interrogeable via
    // `GET /reservations?statut=liberee`, 0026 §tête : « sa propre ligne EST déjà une trace
    // complète ») — ce journal applicatif est le signalement IMMÉDIAT, day-1, pour l'exploitation
    // (aucune alerte ne doit dépendre d'une requête a posteriori sur `reservation_piece`).
    if (liberees.length > 0) {
      this.journal.warn(
        `Forçage ${type} au-delà du physique : ${String(liberees.length)} réservation(s) ` +
          `libérée(s) en cascade (tenant=${ctx.tenantId};article=${articleId};site=${siteId};` +
          `reservations=${liberees.map((l) => l.id).join(',')};` +
          `ordresReparation=${liberees.map((l) => l.ordreReparationId).join(',')}).`,
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
