import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { EntreeCreationPrestation, PageCurseur, ReponsePrestation } from '@dfa/shared';
// Import de VALEUR : voir la même remarque que `service-taux-horaires.ts` — `packages/shared`
// n'exporte aucun type `EntreeModificationPrestation`, dérivé ici via `z.infer`.
import { schemaModificationPrestation } from '@dfa/shared';
import type { z } from 'zod';

import { JETON_DB, schema, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../../db';
import { ErreurMetier } from '../../../common/erreurs';
import { Horloge } from '../../../common/horloge';
import { decoderCurseurDefaut, pageDepuisLignes } from '../pagination-defaut';
import { versDtoPrestation } from './mappeur-prestation';

export type EntreeModificationPrestation = z.infer<typeof schemaModificationPrestation>;

/** SQLSTATE `exclusion_violation` — `prestation_prix_periode_excl` (voir 0005_parametrage.sql). */
const SQLSTATE_EXCLUSION_VIOLATION = '23P01';
/** SQLSTATE `unique_violation` — `prestation_tenant_code_uk`. */
const SQLSTATE_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ServicePrestations {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  async lister(ctx: ContexteTenant, limite: number, curseur: string | undefined): Promise<PageCurseur<ReponsePrestation>> {
    const curseurDecode = decoderCurseurDefaut(curseur);

    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select({
          ...getTableColumns(schema.prestation),
          // Texte natif Postgres du timestamptz — jamais le `Date` de `getTableColumns()` (mode
          // 'date', microseconde déjà perdue). Voir pagination-defaut.ts et
          // common/pagination/valeur-temporelle.ts.
          creeLeTexte: sql<string>`${schema.prestation.creeLe}::text`,
        })
        .from(schema.prestation)
        .where(
          and(
            eq(schema.prestation.tenantId, ctx.tenantId),
            curseurDecode
              ? sql`(${schema.prestation.creeLe}, ${schema.prestation.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
              : undefined,
          ),
        )
        .orderBy(desc(schema.prestation.creeLe), desc(schema.prestation.id))
        .limit(limite + 1);

      const { page, curseurSuivant } = pageDepuisLignes(lignes, limite);
      const prix = await this.chargerPrixActuels(tx, ctx.tenantId, page.map((p) => p.id));

      return {
        donnees: page.map((p) => versDtoPrestation(p, prix.get(p.id) ?? null)),
        curseurSuivant,
        limite,
      };
    });
  }

  async creer(ctx: ContexteTenant, entree: EntreeCreationPrestation): Promise<ReponsePrestation> {
    return this.acces.enTenant(ctx, async (tx) => {
      let prestation: schema.LignePrestation;
      try {
        const [ligne] = await tx
          .insert(schema.prestation)
          .values({
            tenantId: ctx.tenantId,
            code: entree.code,
            designationFr: entree.designationFr,
            designationDe: entree.designationDe ?? null,
            designationIt: entree.designationIt ?? null,
            typeLigne: entree.typeLigne,
            tempsBaremeCentiemes: entree.tempsBaremeCentiemes ?? null,
            tauxHoraireCode: entree.tauxHoraireCode ?? null,
            tauxTvaPourmille: entree.tauxTvaPourmille,
          })
          .returning();
        if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', "L'insertion de la prestation n'a rendu aucune ligne.");
        prestation = ligne;
      } catch (erreur) {
        throw this.traduireErreurEcriture(erreur, entree.code);
      }

      let prixCentimesActuel: number | null = null;
      if (entree.prixCentimes !== null && entree.prixCentimes !== undefined) {
        await this.ouvrirNouveauPrix(tx, ctx.tenantId, prestation.id, entree.prixCentimes);
        prixCentimesActuel = entree.prixCentimes;
      }

      return versDtoPrestation(prestation, prixCentimesActuel);
    });
  }

  async modifier(ctx: ContexteTenant, id: string, entree: EntreeModificationPrestation): Promise<ReponsePrestation> {
    const colonnes: Partial<typeof schema.prestation.$inferInsert> = {};
    if (entree.designationFr !== undefined) colonnes.designationFr = entree.designationFr;
    if (entree.designationDe !== undefined) colonnes.designationDe = entree.designationDe;
    if (entree.designationIt !== undefined) colonnes.designationIt = entree.designationIt;
    if (entree.typeLigne !== undefined) colonnes.typeLigne = entree.typeLigne;
    if (entree.tempsBaremeCentiemes !== undefined) colonnes.tempsBaremeCentiemes = entree.tempsBaremeCentiemes;
    if (entree.tauxHoraireCode !== undefined) colonnes.tauxHoraireCode = entree.tauxHoraireCode;
    if (entree.tauxTvaPourmille !== undefined) colonnes.tauxTvaPourmille = entree.tauxTvaPourmille;
    if (entree.actif !== undefined) colonnes.actif = entree.actif;

    return this.acces.enTenant(ctx, async (tx) => {
      let prestation: schema.LignePrestation;
      if (Object.keys(colonnes).length === 0) {
        const [ligne] = await tx
          .select()
          .from(schema.prestation)
          .where(and(eq(schema.prestation.tenantId, ctx.tenantId), eq(schema.prestation.id, id)));
        if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Prestation "${id}" introuvable pour ce tenant.`);
        prestation = ligne;
      } else {
        try {
          const [ligne] = await tx
            .update(schema.prestation)
            .set(colonnes)
            .where(and(eq(schema.prestation.tenantId, ctx.tenantId), eq(schema.prestation.id, id)))
            .returning();
          if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Prestation "${id}" introuvable pour ce tenant.`);
          prestation = ligne;
        } catch (erreur) {
          if (erreur instanceof ErreurMetier) throw erreur;
          throw this.traduireErreurEcriture(erreur, id);
        }
      }

      let prixCentimesActuel = (await this.chargerPrixActuels(tx, ctx.tenantId, [id])).get(id) ?? null;

      if (entree.prixCentimes !== undefined && entree.prixCentimes !== prixCentimesActuel) {
        if (entree.prixCentimes === null) {
          // Clôturer le prix courant sans en ouvrir un nouveau : la prestation redevient sans
          // prix actif (`prixCentimes: null`) — cas légitime (ex. prestation temporairement retirée
          // du catalogue tarifaire sans être désactivée).
          await this.cloturerPrixCourant(tx, ctx.tenantId, id);
          prixCentimesActuel = null;
        } else {
          await this.cloturerPrixCourant(tx, ctx.tenantId, id);
          await this.ouvrirNouveauPrix(tx, ctx.tenantId, id, entree.prixCentimes);
          prixCentimesActuel = entree.prixCentimes;
        }
      }

      return versDtoPrestation(prestation, prixCentimesActuel);
    });
  }

  /** `prestation_id -> prixCentimes` pour le prix VALIDE AUJOURD'HUI, pour un lot d'ids. */
  private async chargerPrixActuels(
    tx: TransactionDfa,
    tenantId: string,
    prestationIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (prestationIds.length === 0) return new Map();

    const aujourdhui = this.dateDuJour();
    const lignes = await tx
      .select({ prestationId: schema.prestationPrix.prestationId, prixCentimes: schema.prestationPrix.prixCentimes })
      .from(schema.prestationPrix)
      .where(
        and(
          eq(schema.prestationPrix.tenantId, tenantId),
          inArray(schema.prestationPrix.prestationId, [...prestationIds]),
          lte(schema.prestationPrix.valideDu, aujourdhui),
          or(isNull(schema.prestationPrix.valideAu), gt(schema.prestationPrix.valideAu, aujourdhui)),
        ),
      );

    return new Map(lignes.map((l) => [l.prestationId, l.prixCentimes]));
  }

  /** Clôture le prix ouvert (`valide_au IS NULL`) d'une prestation, s'il en existe un. */
  private async cloturerPrixCourant(tx: TransactionDfa, tenantId: string, prestationId: string): Promise<void> {
    await tx
      .update(schema.prestationPrix)
      .set({ valideAu: this.dateDuJour() })
      .where(
        and(
          eq(schema.prestationPrix.tenantId, tenantId),
          eq(schema.prestationPrix.prestationId, prestationId),
          isNull(schema.prestationPrix.valideAu),
        ),
      );
  }

  private async ouvrirNouveauPrix(
    tx: TransactionDfa,
    tenantId: string,
    prestationId: string,
    prixCentimes: number,
  ): Promise<void> {
    try {
      await tx.insert(schema.prestationPrix).values({
        tenantId,
        prestationId,
        prixCentimes,
        valideDu: this.dateDuJour(),
        valideAu: null,
      });
    } catch (erreur) {
      throw this.traduireErreurEcriture(erreur, prestationId);
    }
  }

  private dateDuJour(): string {
    return this.horloge.maintenant().toISOString().slice(0, 10);
  }

  private traduireErreurEcriture(erreur: unknown, identifiant: string): Error {
    const brute = erreur as { code?: unknown } | null;
    if (brute && typeof brute === 'object') {
      if (brute.code === SQLSTATE_EXCLUSION_VIOLATION) {
        return new ErreurMetier('CONFLIT', `Un prix valide de la prestation "${identifiant}" chevauche déjà une période existante.`);
      }
      if (brute.code === SQLSTATE_UNIQUE_VIOLATION) {
        return new ErreurMetier('CONFLIT', `Le code de prestation "${identifiant}" existe déjà pour ce tenant.`);
      }
    }
    return erreur instanceof Error ? erreur : new ErreurMetier('ERREUR_INTERNE', 'Erreur inattendue sur le référentiel des prestations.');
  }
}
