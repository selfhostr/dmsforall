import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  EntreeLiberationReservation,
  FiltresReservations,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseReservationPiece,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import type { LigneReservationPiece } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';

import { versReservationResponse } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';

const DEFINITIONS_TRI_RESERVATIONS: Readonly<Record<FiltresReservations['tri'], DefinitionTri>> = {
  'creeLe:desc': { expression: sql`r.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`r.cree_le`, sens: 'asc', nullable: false, temporel: true },
};

const COLONNES_RESERVATION_ALIASEES = sql`
  r.id as "id", r.article_id as "articleId", r.site_id as "siteId", r.ligne_or_id as "ligneOrId",
  r.ordre_reparation_id as "ordreReparationId", r.quantite_millieme as "quantiteMillieme",
  r.statut as "statut", r.cree_le as "creeLe", r.satisfaite_le as "satisfaiteLe",
  r.mouvement_sortie_id as "mouvementSortieId", r.liberee_le as "libereeLe",
  r.motif_liberation as "motifLiberation", r.motif_liberation_texte as "motifLiberationTexte",
  r.liberee_par_utilisateur_id as "libereeParUtilisateurId"
`;

/**
 * Service réservation (RP-19 → RP-25, §6.3) — LE cœur du sujet, priorité 4. La CRÉATION n'a pas
 * de méthode ici : elle naît toujours comme effet de bord de `POST /ordres-reparation/{orId}/lignes`
 * (`atelier/ligne.ts`, GELÉ, hors périmètre — le trigger `reservation_piece_verrouiller_stock`,
 * 0026, porte la garantie de concurrence `CP-02` à l'INSERT). Ce service couvre la lecture
 * transverse et les deux actions nommées de la machine à états (`satisfaire`, `liberer`).
 */
@Injectable()
export class ServiceReservation {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    params: FiltresReservations,
  ): Promise<PageCurseur<ReponseReservationPiece>> {
    const definition = DEFINITIONS_TRI_RESERVATIONS[params.tri];
    const idExpr = sql`r.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`r.tenant_id = ${ctx.tenantId}`];
      if (params.articleId) conditions.push(sql`r.article_id = ${params.articleId}`);
      if (params.siteId) conditions.push(sql`r.site_id = ${params.siteId}`);
      if (params.ordreReparationId)
        conditions.push(sql`r.ordre_reparation_id = ${params.ordreReparationId}`);
      if (params.statut && params.statut.length > 0) {
        conditions.push(
          sql`r.statut::text in (${sql.join(
            params.statut.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneReservationPiece & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_RESERVATION_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.reservation_piece r
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versReservationResponse(l)),
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
   * `POST /reservations/{id}/satisfaire` — RP-21 : le magasinier remet PHYSIQUEMENT la pièce.
   * Génère le mouvement `sortie_or`, `statut → satisfaite` (terminal, via le trigger
   * `reservation_piece_transition`, 0026, qui libère `quantite_reservee_millieme` dans la MÊME
   * transaction). `select … for update` sur la réservation elle-même AVANT tout, pour qu'un
   * double-appel concurrent (deux magasiniers sur le même comptoir) ne puisse jamais générer deux
   * mouvements de sortie pour la même réservation — le second attend, relit `statut = 'satisfaite'`
   * et refuse proprement (`409 RESERVATION_TRANSITION_INTERDITE`).
   */
  async satisfaire(ctx: ContexteTenant, reservationId: string): Promise<ReponseReservationPiece> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerPourVerrouOu404(tx, ctx, reservationId);
      if (ligne.statut !== 'active') {
        throw new ErreurMetier(
          'RESERVATION_TRANSITION_INTERDITE',
          `Transition interdite : la réservation est "${ligne.statut}", pas "active".`,
        );
      }

      const resultatMouvement = await tx.execute<{ id: string }>(sql`
        insert into public.mouvement_stock
          (tenant_id, article_id, type, quantite_millieme, site_id, auteur_id, ligne_or_id, reservation_id)
        values
          (${ctx.tenantId}, ${ligne.articleId}, 'sortie_or', ${-ligne.quantiteMillieme}, ${ligne.siteId},
           ${ctx.utilisateurId}, ${ligne.ligneOrId}, ${ligne.id})
        returning id as "id"
      `);
      const mouvementId = resultatMouvement.rows[0]?.id;
      if (!mouvementId)
        throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du mouvement de sortie.');

      await tx.execute(sql`
        update public.reservation_piece
           set statut = 'satisfaite', satisfaite_le = now(), mouvement_sortie_id = ${mouvementId}
         where tenant_id = ${ctx.tenantId} and id = ${reservationId}
      `);

      const ligneMaj = await this.chargerOu404(tx, ctx, reservationId);
      return versReservationResponse(ligneMaj);
    });
  }

  /**
   * `POST /reservations/{id}/liberer` — RP-23, geste explicite du magasinier (troisième cas).
   * Avertissement `RESERVATION_LIBEREE_OR_ACTIF` quand l'OR porteur n'est PAS `annule` —
   * approximation documentée (voir rapport de livraison) : `RP-23` décrit aussi la libération
   * automatique par « refus d'une ligne en décision de devis », état qu'aucune colonne de
   * `ligne_or` ne permet de distinguer sans lire `atelier/service-devis.ts` (hors périmètre) ; ce
   * service se limite au statut de l'OR, le cas le plus fréquent et le plus lisible.
   */
  async liberer(
    ctx: ContexteTenant,
    reservationId: string,
    entree: EntreeLiberationReservation,
  ): Promise<ReponseAvecAvertissements<ReponseReservationPiece>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerPourVerrouOu404(tx, ctx, reservationId);
      if (ligne.statut !== 'active') {
        throw new ErreurMetier(
          'RESERVATION_TRANSITION_INTERDITE',
          `Transition interdite : la réservation est "${ligne.statut}", pas "active".`,
        );
      }

      await tx.execute(sql`
        update public.reservation_piece
           set statut = 'liberee', liberee_le = now(), motif_liberation = 'liberation_manuelle',
               motif_liberation_texte = ${entree.motif}, liberee_par_utilisateur_id = ${ctx.utilisateurId}
         where tenant_id = ${ctx.tenantId} and id = ${reservationId}
      `);

      const collecteur = new CollecteurAvertissements();
      const orStatut = await tx.execute<{ statut: string }>(sql`
        select statut::text as "statut" from public.ordre_reparation
         where tenant_id = ${ctx.tenantId} and id = ${ligne.ordreReparationId}
      `);
      if (orStatut.rows[0]?.statut !== 'annule') {
        collecteur.ajouter(
          'RESERVATION_LIBEREE_OR_ACTIF',
          "Réservation libérée alors que l'ordre de réparation porteur n'est pas annulé (RP-23).",
          { reservationId, ordreReparationId: ligne.ordreReparationId },
        );
      }

      const ligneMaj = await this.chargerOu404(tx, ctx, reservationId);
      return collecteur.envelopper(versReservationResponse(ligneMaj));
    });
  }

  private async chargerOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    reservationId: string,
  ): Promise<LigneReservationPiece> {
    const resultat = await tx.execute<LigneReservationPiece>(sql`
      select ${COLONNES_RESERVATION_ALIASEES} from public.reservation_piece r
       where r.tenant_id = ${ctx.tenantId} and r.id = ${reservationId}
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Réservation introuvable.');
    return ligne;
  }

  /** `select … for update` : sérialise satisfaire/liberer concurrents sur la MÊME réservation. */
  private async chargerPourVerrouOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    reservationId: string,
  ): Promise<LigneReservationPiece> {
    const resultat = await tx.execute<LigneReservationPiece>(sql`
      select ${COLONNES_RESERVATION_ALIASEES} from public.reservation_piece r
       where r.tenant_id = ${ctx.tenantId} and r.id = ${reservationId}
       for update
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Réservation introuvable.');
    return ligne;
  }
}
