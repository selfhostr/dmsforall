import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PageCurseur, ReponseTauxHoraire } from '@dfa/shared';
// Import de VALEUR : `packages/shared` exporte `EntreeCreationTauxHoraire` (type) mais AUCUN type
// `EntreeModificationTauxHoraire` — écart signalé (asymétrie création/modification, contrairement
// à `EntreeModificationParametresAtelier`/`EntreeModificationParametresSite`, bien exportés). On
// dérive donc le type localement via `z.infer<typeof schemaModificationTauxHoraire>`, ce qui exige
// la valeur du schéma (pas `import type`) pour que `typeof` résolve quelque chose.
import { schemaModificationTauxHoraire, type EntreeCreationTauxHoraire } from '@dfa/shared';
import type { z } from 'zod';

import { JETON_DB, schema, type AccesBase, type ContexteTenant } from '../../../db';
import { ErreurMetier } from '../../../common/erreurs';
import { decoderCurseurDefaut, pageDepuisLignes } from '../pagination-defaut';
import { versDtoTauxHoraire } from './mappeur-taux-horaire';

export type EntreeModificationTauxHoraire = z.infer<typeof schemaModificationTauxHoraire>;

/** SQLSTATE Postgres `exclusion_violation` — la contrainte `taux_horaire_periode_excl` (EXCLUDE
 *  GiST) empêche deux périodes valides du même code de se chevaucher (voir 0005_parametrage.sql). */
const SQLSTATE_EXCLUSION_VIOLATION = '23P01';

@Injectable()
export class ServiceTauxHoraires {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(ctx: ContexteTenant, limite: number, curseur: string | undefined): Promise<PageCurseur<ReponseTauxHoraire>> {
    const curseurDecode = decoderCurseurDefaut(curseur);

    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(schema.tauxHoraire)
        .where(
          and(
            eq(schema.tauxHoraire.tenantId, ctx.tenantId),
            curseurDecode
              ? sql`(${schema.tauxHoraire.creeLe}, ${schema.tauxHoraire.id}) < (${curseurDecode.creeLe}, ${curseurDecode.id})`
              : undefined,
          ),
        )
        .orderBy(desc(schema.tauxHoraire.creeLe), desc(schema.tauxHoraire.id))
        .limit(limite + 1);

      const { page, curseurSuivant } = pageDepuisLignes(lignes, limite);
      return { donnees: page.map(versDtoTauxHoraire), curseurSuivant, limite };
    });
  }

  async creer(ctx: ContexteTenant, entree: EntreeCreationTauxHoraire): Promise<ReponseTauxHoraire> {
    return this.acces.enTenant(ctx, async (tx) => {
      try {
        const [ligne] = await tx
          .insert(schema.tauxHoraire)
          .values({
            tenantId: ctx.tenantId,
            code: entree.code,
            libelle: entree.libelle,
            montantCentimes: entree.montantCentimes,
            valideDu: entree.valideDuLe,
            valideAu: entree.valideAuLe ?? null,
          })
          .returning();
        if (!ligne) {
          throw new ErreurMetier('ERREUR_INTERNE', "L'insertion du taux horaire n'a rendu aucune ligne.");
        }
        return versDtoTauxHoraire(ligne);
      } catch (erreur) {
        throw this.traduireErreurPeriode(erreur, entree.code);
      }
    });
  }

  async modifier(ctx: ContexteTenant, id: string, entree: EntreeModificationTauxHoraire): Promise<ReponseTauxHoraire> {
    const colonnes: Partial<typeof schema.tauxHoraire.$inferInsert> = {};
    if (entree.libelle !== undefined) colonnes.libelle = entree.libelle;
    if (entree.montantCentimes !== undefined) colonnes.montantCentimes = entree.montantCentimes;
    if (entree.valideDuLe !== undefined) colonnes.valideDu = entree.valideDuLe;
    if (entree.valideAuLe !== undefined) colonnes.valideAu = entree.valideAuLe;

    return this.acces.enTenant(ctx, async (tx) => {
      if (Object.keys(colonnes).length === 0) {
        const [ligne] = await tx
          .select()
          .from(schema.tauxHoraire)
          .where(and(eq(schema.tauxHoraire.tenantId, ctx.tenantId), eq(schema.tauxHoraire.id, id)));
        if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Taux horaire "${id}" introuvable pour ce tenant.`);
        return versDtoTauxHoraire(ligne);
      }

      try {
        const [ligne] = await tx
          .update(schema.tauxHoraire)
          .set(colonnes)
          .where(and(eq(schema.tauxHoraire.tenantId, ctx.tenantId), eq(schema.tauxHoraire.id, id)))
          .returning();
        if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Taux horaire "${id}" introuvable pour ce tenant.`);
        return versDtoTauxHoraire(ligne);
      } catch (erreur) {
        if (erreur instanceof ErreurMetier) throw erreur;
        throw this.traduireErreurPeriode(erreur, id);
      }
    });
  }

  /**
   * Traduit `23P01` (exclusion_violation) en `409 CONFLIT`. ÉCART SIGNALÉ : `CODES_ERREUR`
   * (gelé, `packages/shared`) ne porte aucun code dédié « période de taux horaire chevauchante »
   * — contrairement à `VEHICULE_PLAQUE_COLLISION` pour un cas structurellement analogue. `CONFLIT`
   * (générique, 409) est le code le plus proche disponible ; à faire arbitrer par expert-api si un
   * code dédié est souhaité (ex. `TAUX_HORAIRE_PERIODE_CHEVAUCHEMENT`).
   */
  private traduireErreurPeriode(erreur: unknown, identifiant: string): Error {
    const brute = erreur as { code?: unknown } | null;
    if (brute && typeof brute === 'object' && brute.code === SQLSTATE_EXCLUSION_VIOLATION) {
      return new ErreurMetier(
        'CONFLIT',
        `Une période valide de ce taux horaire (${identifiant}) chevauche déjà une période existante.`,
      );
    }
    return erreur instanceof Error ? erreur : new ErreurMetier('ERREUR_INTERNE', 'Erreur inattendue sur le référentiel des taux horaires.');
  }
}
