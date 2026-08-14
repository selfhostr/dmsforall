import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import type {
  EntreeDeverrouillagePeriodePointage,
  EntreeVerrouillagePeriodePointage,
  ReponseDeverrouillagePeriodePointage,
  ReponseVerrouillagePeriodePointage,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { pointage, pointageVerrouillageSite } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import { finJourneeSuisse } from '../common/temps';

/**
 * RM-95 : verrouillage de période, modélisé comme un SEUIL MUTABLE par site
 * (`pointage_verrouillage_site`, voir son en-tête pour la décision de modèle — hors périmètre
 * d'écriture de ce fichier, déjà tranchée par le schéma livré).
 *
 * INTERPRÉTATION SIGNALÉE, à confirmer avec expert-metier — le contrat (`contrats/pointage/
 * periode.ts`) donne `jusquauLe` aux DEUX actions (verrouiller/déverrouiller) sans préciser le sens
 * exact côté déverrouillage. Avec un SEUIL UNIQUE (pas un intervalle), la seule lecture cohérente
 * est : `deverrouiller-periode(jusquauLe)` fait RECULER le seuil du site jusqu'à `jusquauLe`
 * (nouveau seuil, plus ancien que l'actuel) et rouvre tout pointage `verrouille` dont `debutLe` est
 * POSTÉRIEUR à ce nouveau seuil — symétrique de `verrouiller-periode`, qui AVANCE le seuil et
 * verrouille tout ce qui est ANTÉRIEUR ou égal. Si `jusquauLe` n'est pas inférieur au seuil actuel,
 * l'opération est un NO-OP (`pointagesDeverrouilles = 0`), jamais une erreur.
 *
 * BORNE DE JOURNÉE — CORRIGÉE le 14.08.2026 (mesurée en UTC pur avant ce correctif, écart d'une
 * heure en hiver, deux en été, autour de minuit local) : la conversion « ce jour calendaire » ->
 * « cet instant » passe désormais par `common/temps/fuseau-suisse.ts`, Europe/Zurich, CET/CEST
 * gérées automatiquement (décision de @laupernoe : un seul fuseau pour tout le produit, jamais un réglage
 * par site). Voir l'en-tête de ce fichier commun pour la doctrine complète et les deux autres
 * endroits qui répliquaient la même convention UTC.
 */
@Injectable()
export class ServiceVerrouillagePeriode {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  async verrouiller(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeVerrouillagePeriodePointage,
  ): Promise<ReponseVerrouillagePeriodePointage> {
    return this.acces.enTenant(ctx, async (tx) => {
      const seuil = finDeJournee(entree.jusquauLe);

      const ouverts = await tx
        .select({ id: pointage.id, technicienId: pointage.technicienId })
        .from(pointage)
        .where(
          and(
            eq(pointage.tenantId, ctx.tenantId),
            eq(pointage.siteId, entree.siteId),
            eq(pointage.statut, 'en_cours'),
            lte(pointage.debutLe, seuil),
          ),
        );

      if (ouverts.length > 0) {
        throw new ErreurMetier(
          'CONFLIT',
          `${String(ouverts.length)} pointage(s) encore en cours empêchent le verrouillage de cette période (RM-95).`,
          {
            blocages: ouverts.map((p) => ({
              type: 'pointage' as const,
              id: p.id,
              libelle: p.id,
              donnees: { technicienId: p.technicienId },
            })),
            actionsProposees: [{ code: 'ARRETER_POINTAGES' }],
          },
        );
      }

      const verrouilles = await tx
        .update(pointage)
        .set({ statut: 'verrouille' })
        .where(
          and(
            eq(pointage.tenantId, ctx.tenantId),
            eq(pointage.siteId, entree.siteId),
            inArray(pointage.statut, ['termine', 'valide']),
            lte(pointage.debutLe, seuil),
          ),
        )
        .returning({ id: pointage.id });

      await this.ecrireSeuil(
        tx,
        ctx,
        principal,
        entree.siteId,
        entree.jusquauLe,
        entree.motif ?? null,
      );

      return {
        siteId: entree.siteId,
        jusquauLe: entree.jusquauLe,
        pointagesVerrouilles: verrouilles.length,
      };
    });
  }

  async deverrouiller(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeDeverrouillagePeriodePointage,
  ): Promise<ReponseDeverrouillagePeriodePointage> {
    return this.acces.enTenant(ctx, async (tx) => {
      const seuil = finDeJournee(entree.jusquauLe);

      const deverrouilles = await tx
        .update(pointage)
        .set({ statut: 'valide' })
        .where(
          and(
            eq(pointage.tenantId, ctx.tenantId),
            eq(pointage.siteId, entree.siteId),
            eq(pointage.statut, 'verrouille'),
            gt(pointage.debutLe, seuil),
          ),
        )
        .returning({ id: pointage.id });

      await this.ecrireSeuil(tx, ctx, principal, entree.siteId, entree.jusquauLe, entree.motif);

      return {
        siteId: entree.siteId,
        jusquauLe: entree.jusquauLe,
        pointagesDeverrouilles: deverrouilles.length,
      };
    });
  }

  private async ecrireSeuil(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    siteId: string,
    jusquauLe: string,
    motif: string | null,
  ): Promise<void> {
    const maintenant = this.horloge.maintenant();
    await tx
      .insert(pointageVerrouillageSite)
      .values({
        tenantId: ctx.tenantId,
        siteId,
        verrouilleJusquauLe: jusquauLe,
        dernierMotif: motif,
        derniereActionLe: maintenant,
        dernierUtilisateurId: principal.utilisateurId,
      })
      .onConflictDoUpdate({
        target: [pointageVerrouillageSite.tenantId, pointageVerrouillageSite.siteId],
        set: {
          verrouilleJusquauLe: jusquauLe,
          dernierMotif: motif,
          derniereActionLe: maintenant,
          dernierUtilisateurId: principal.utilisateurId,
        },
      });
  }
}

/** `'AAAA-MM-JJ'` -> instant de fin de journée CIVILE SUISSE (23:59:59.999 Europe/Zurich) — voir
 *  l'en-tête pour la correction du 14.08.2026 (remplace le bornage UTC pur). */
function finDeJournee(dateJour: string): Date {
  return finJourneeSuisse(dateJour);
}
