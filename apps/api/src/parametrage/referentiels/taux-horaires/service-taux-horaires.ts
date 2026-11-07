import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { PageCurseur, ReponseTauxHoraire } from '@dfa/shared';
// Import de VALEUR : `packages/shared` exporte `EntreeCreationTauxHoraire` (type) mais AUCUN type
// `EntreeModificationTauxHoraire` — écart signalé (asymétrie création/modification, contrairement
// à `EntreeModificationParametresAtelier`/`EntreeModificationParametresSite`, bien exportés). On
// dérive donc le type localement via `z.infer<typeof schemaModificationTauxHoraire>`, ce qui exige
// la valeur du schéma (pas `import type`) pour que `typeof` résolve quelque chose.
import { schemaModificationTauxHoraire, type EntreeCreationTauxHoraire } from '@dfa/shared';
import type { z } from 'zod';

import {
  JETON_DB,
  schema,
  type AccesBase,
  type ContexteTenant,
  type TransactionDfa,
} from '../../../db';
import { jourCivilSuisse } from '../../../common/temps/fuseau-suisse';
import { ErreurMetier } from '../../../common/erreurs';
import { decoderCurseurDefaut, pageDepuisLignes } from '../pagination-defaut';
import { versDtoTauxHoraire } from './mappeur-taux-horaire';

export type EntreeModificationTauxHoraire = z.infer<typeof schemaModificationTauxHoraire>;

/** SQLSTATE Postgres `exclusion_violation` — la contrainte `taux_horaire_periode_excl` (EXCLUDE
 *  GiST) empêche deux périodes valides du même code de se chevaucher (voir 0005_parametrage.sql). */
const SQLSTATE_EXCLUSION_VIOLATION = '23P01';

function erreurValidation(champ: string, message: string): ErreurMetier {
  return new ErreurMetier('VALIDATION_ECHOUEE', message, {
    erreurs: [{ champ, code: 'invalide', message }],
  });
}

@Injectable()
export class ServiceTauxHoraires {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    limite: number,
    curseur: string | undefined,
  ): Promise<PageCurseur<ReponseTauxHoraire>> {
    const curseurDecode = decoderCurseurDefaut(curseur);

    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select({
          ...getTableColumns(schema.tauxHoraire),
          // Texte natif Postgres du timestamptz — jamais le `Date` de `getTableColumns()` (mode
          // 'date', microseconde déjà perdue). Voir pagination-defaut.ts et
          // common/pagination/valeur-temporelle.ts.
          creeLeTexte: sql<string>`${schema.tauxHoraire.creeLe}::text`,
        })
        .from(schema.tauxHoraire)
        .where(
          and(
            eq(schema.tauxHoraire.tenantId, ctx.tenantId),
            curseurDecode
              ? sql`(${schema.tauxHoraire.creeLe}, ${schema.tauxHoraire.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
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
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion du taux horaire n'a rendu aucune ligne.",
          );
        }
        return versDtoTauxHoraire(ligne);
      } catch (erreur) {
        throw this.traduireErreurPeriode(erreur, entree.code);
      }
    });
  }

  /**
   * Règle (RM-65, taux figé sur les lignes d'OR mais période affichée jamais réécrite) :
   *  - un changement de MONTANT sur une période en cours ne réécrit pas l'histoire : il ouvre une
   *    NOUVELLE période à `max(aujourd'hui, valideDuLe fourni)` (jamais dans le passé) et clôt la
   *    précédente à cette date. `valide_au` est une borne EXCLUSIVE (`daterange '[)'`, voir
   *    `atelier/taux-horaire.ts`) : `valide_au = début de la nouvelle` signifie « dernier jour
   *    couvert = la veille », sans trou ni chevauchement ;
   *  - le libellé (et la fin `valideAuLe`, tant qu'elle reste dans le futur) se modifient en place ;
   *  - une période déjà close est immuable (409) ;
   *  - une période pas encore commencée n'a rien d'historique : tout s'y modifie en place ;
   *  - cas limite : période commencée AUJOURD'HUI et nouveau montant daté d'aujourd'hui — la
   *    précédente serait vide (`valide_au > valide_du` exigé) : correction en place du jour même.
   */
  async modifier(
    ctx: ContexteTenant,
    id: string,
    entree: EntreeModificationTauxHoraire,
  ): Promise<ReponseTauxHoraire> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx
        .select()
        .from(schema.tauxHoraire)
        .where(and(eq(schema.tauxHoraire.tenantId, ctx.tenantId), eq(schema.tauxHoraire.id, id)));
      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Taux horaire "${id}" introuvable pour ce tenant.`,
        );
      }
      const modifications = Object.values(entree).some((valeur) => valeur !== undefined);
      if (!modifications) return versDtoTauxHoraire(ligne);

      const aujourdhui = jourCivilSuisse(new Date());
      if (ligne.valideAu !== null && ligne.valideAu <= aujourdhui) {
        throw new ErreurMetier(
          'CONFLIT',
          `La période du taux horaire "${ligne.code}" est close (jusqu'au ${ligne.valideAu}) : elle ne se modifie plus. Créez une nouvelle période.`,
        );
      }

      try {
        const dejaCommencee = ligne.valideDu <= aujourdhui;
        const montantChange =
          entree.montantCentimes !== undefined && entree.montantCentimes !== ligne.montantCentimes;

        if (dejaCommencee && !montantChange) {
          this.exigerDatesNonRetroactives(entree, aujourdhui, { dateDebutAutorisee: false });
          return versDtoTauxHoraire(await this.mettreAJourSurPlace(tx, ctx, id, entree));
        }
        if (!dejaCommencee) {
          this.exigerDatesNonRetroactives(entree, aujourdhui, { dateDebutAutorisee: true });
          return versDtoTauxHoraire(await this.mettreAJourSurPlace(tx, ctx, id, entree));
        }

        // Période en cours + nouveau montant : nouvelle période datée, précédente clôturée.
        const debut = entree.valideDuLe ?? aujourdhui;
        this.exigerDatesNonRetroactives(entree, aujourdhui, { dateDebutAutorisee: true });
        if (debut <= ligne.valideDu) {
          return versDtoTauxHoraire(await this.mettreAJourSurPlace(tx, ctx, id, entree));
        }
        const finNouvelle =
          entree.valideAuLe !== undefined
            ? entree.valideAuLe
            : ligne.valideAu !== null && ligne.valideAu > debut
              ? ligne.valideAu
              : null;
        if (finNouvelle !== null && finNouvelle <= debut) {
          throw erreurValidation('valideAuLe', 'La fin de la période doit suivre son début.');
        }
        if (ligne.valideAu === null || ligne.valideAu > debut) {
          await tx
            .update(schema.tauxHoraire)
            .set({ valideAu: debut })
            .where(
              and(eq(schema.tauxHoraire.tenantId, ctx.tenantId), eq(schema.tauxHoraire.id, id)),
            );
        }
        const [nouvelle] = await tx
          .insert(schema.tauxHoraire)
          .values({
            tenantId: ctx.tenantId,
            code: ligne.code,
            libelle: entree.libelle ?? ligne.libelle,
            montantCentimes: entree.montantCentimes ?? ligne.montantCentimes,
            valideDu: debut,
            valideAu: finNouvelle,
          })
          .returning();
        if (!nouvelle) {
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion de la nouvelle période de taux horaire n'a rendu aucune ligne.",
          );
        }
        return versDtoTauxHoraire(nouvelle);
      } catch (erreur) {
        if (erreur instanceof ErreurMetier) throw erreur;
        throw this.traduireErreurPeriode(erreur, id);
      }
    });
  }

  private exigerDatesNonRetroactives(
    entree: EntreeModificationTauxHoraire,
    aujourdhui: string,
    options: { readonly dateDebutAutorisee: boolean },
  ): void {
    if (entree.valideDuLe !== undefined) {
      if (!options.dateDebutAutorisee) {
        throw erreurValidation(
          'valideDuLe',
          'La date de début ne se change que avec un nouveau montant (nouvelle période) ou sur une période pas encore commencée.',
        );
      }
      if (entree.valideDuLe < aujourdhui) {
        throw erreurValidation(
          'valideDuLe',
          "Une période de taux horaire ne peut pas commencer dans le passé : la date de début doit être aujourd'hui ou plus tard.",
        );
      }
    }
    if (entree.valideAuLe !== undefined && entree.valideAuLe !== null) {
      if (entree.valideAuLe <= aujourdhui) {
        throw erreurValidation(
          'valideAuLe',
          "La fin d'une période ne peut pas être fixée à aujourd'hui ou dans le passé.",
        );
      }
    }
  }

  private async mettreAJourSurPlace(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
    entree: EntreeModificationTauxHoraire,
  ): Promise<schema.LigneTauxHoraire> {
    const colonnes: Partial<typeof schema.tauxHoraire.$inferInsert> = {};
    if (entree.libelle !== undefined) colonnes.libelle = entree.libelle;
    if (entree.montantCentimes !== undefined) colonnes.montantCentimes = entree.montantCentimes;
    if (entree.valideDuLe !== undefined) colonnes.valideDu = entree.valideDuLe;
    if (entree.valideAuLe !== undefined) colonnes.valideAu = entree.valideAuLe;
    const [ligne] = await tx
      .update(schema.tauxHoraire)
      .set(colonnes)
      .where(and(eq(schema.tauxHoraire.tenantId, ctx.tenantId), eq(schema.tauxHoraire.id, id)))
      .returning();
    if (!ligne) {
      throw new ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        `Taux horaire "${id}" introuvable pour ce tenant.`,
      );
    }
    return ligne;
  }

  /**
   * Traduit `23P01` (exclusion_violation) en `409 CONFLIT`. ÉCART SIGNALÉ : `CODES_ERREUR`
   * (gelé, `packages/shared`) ne porte aucun code dédié « période de taux horaire chevauchante »
   * — contrairement à `VEHICULE_PLAQUE_COLLISION` pour un cas structurellement analogue. `CONFLIT`
   * (générique, 409) est le code le plus proche disponible ; à faire arbitrer par l'équipe API si un
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
    return erreur instanceof Error
      ? erreur
      : new ErreurMetier(
          'ERREUR_INTERNE',
          'Erreur inattendue sur le référentiel des taux horaires.',
        );
  }
}
