import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FiltresConsignes, PageCurseur, ReponseConsigneEchangeStandard } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { mouvementStock } from '../db/schema';
import type { LigneConsigneEchangeStandard, NouveauMouvementStock } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import { versConsigneResponse } from './mappers';
import { construireConditionKeyset, construireOrderBy, decoderCurseurPourTri, encoderCurseurTrie, expressionTriValeur, valeurCurseurDepuisTri, type DefinitionTri } from './pagination-triee';

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
 * Service consigne d'échange standard (RP-37 → RP-42, §6.4) — priorité 3 du lot. AUCUNE création
 * ici (`POST /consignes` n'existe pas côté contrat : la pose de la consigne est un effet de bord
 * serveur de la réalisation d'une ligne d'OR de dépose, GELÉ, hors périmètre — voir l'en-tête de
 * `consigne.ts` et le rapport de livraison, point d'intégration cross-module signalé mais pas
 * implémenté ici). Ce service couvre la lecture transverse (§7.7 : « une consigne jamais rendue
 * est de l'argent qui dort ») et l'unique action nommée du cycle de vie, `marquer-retour-fournisseur`.
 */
@Injectable()
export class ServiceConsigne {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(ctx: ContexteTenant, params: FiltresConsignes): Promise<PageCurseur<ReponseConsigneEchangeStandard>> {
    const definition = DEFINITIONS_TRI_CONSIGNES[params.tri];
    const idExpr = sql`c.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`c.tenant_id = ${ctx.tenantId}`];
      if (params.statut && params.statut.length > 0) {
        conditions.push(sql`c.statut::text in (${sql.join(params.statut.map((s) => sql`${s}`), sql`, `)})`);
      }
      if (params.siteId) conditions.push(sql`c.site_id = ${params.siteId}`);
      // §7.7 : « une liste de consignes non soldées après N jours (P) » — filtre serveur sur
      // `creeLe`, AUCUNE action de ce service ne solde une consigne automatiquement (RP-41,
      // non tranché — voir `contrats/pieces/parametrage.ts::delaiConsigneAcquisitionJours`).
      if (params.ancienneteJoursMin !== undefined) {
        conditions.push(sql`c.cree_le <= now() - make_interval(days => ${params.ancienneteJoursMin})`);
      }
      if (curseurDecode) {
        conditions.push(construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id));
      }

      const resultat = await tx.execute<LigneConsigneEchangeStandard & { triValeur: string | number | null }>(sql`
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
            ? encoderCurseurTrie({ tri: params.tri, valeur: valeurCurseurDepuisTri(definition, derniere.triValeur), id: derniere.id })
            : null,
        limite: params.limite,
      };
    });
  }

  /**
   * `POST /consignes/{id}/marquer-retour-fournisseur` — le geste de comptoir de RP-40 : le client
   * ramène la vieille pièce. Génère le mouvement `retour_consigne` (quantité = celle de la ligne
   * d'OR d'origine, `ligne_or.quantiteMillieme` — `consigne_echange_standard` ne porte elle-même
   * aucune quantité, seulement un montant), `statut → retournee_fournisseur` (TERMINAL).
   *
   * RP-40 exige que ce geste et l'avoir partiel côté facturation arrivent ENSEMBLE, « jamais l'un
   * sans l'autre » — ce service ne peut garantir QUE la moitié stock de cette atomicité (même
   * limite que le CHECK `consigne_echange_standard_terminal_coherent_chk`, 0027) : la coordination
   * avec l'avoir de facturation (RF-100) reste un point d'intégration cross-module NON résolu ici,
   * signalé au rapport de livraison, pas tranché seul.
   */
  async marquerRetourFournisseur(ctx: ContexteTenant, id: string): Promise<ReponseConsigneEchangeStandard> {
    return this.acces.enTenant(ctx, async (tx) => {
      const { consigne, quantiteLigneOrMillieme } = await this.chargerAvecQuantiteOu404PourVerrou(tx, ctx, id);
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
      if (!mouvement) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du mouvement de retour de consigne.');

      await tx.execute(sql`
        update public.consigne_echange_standard
           set statut = 'retournee_fournisseur', retournee_fournisseur_le = now(), mouvement_retour_id = ${mouvement.id}
         where tenant_id = ${ctx.tenantId} and id = ${id}
      `);

      const ligneMaj = await this.chargerOu404(tx, ctx, id);
      return versConsigneResponse(ligneMaj);
    });
  }

  private async chargerOu404(tx: TransactionDfa, ctx: ContexteTenant, id: string): Promise<LigneConsigneEchangeStandard> {
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
    const resultat = await tx.execute<LigneConsigneEchangeStandard & { quantiteLigneOrMillieme: number }>(sql`
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
}
