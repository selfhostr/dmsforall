import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte } from 'drizzle-orm';
import {
  MOMENTS_RENDEZ_VOUS,
  type CapaciteJourRendezVous,
  type FiltresCapaciteRendezVous,
  type MomentRendezVous,
  type ReponseCapaciteRendezVous,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { rendezVous } from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

import {
  calculerEtatCapaciteJour,
  capaciteMinutesDepuisCentiemes,
  enumererDatesInclusives,
} from './calcul-capacite';
import { chargerCapaciteHeuresJourCentiemes } from './references';

/**
 * `GET /rendez-vous/capacite` — RV-06/RV-07/RV-08. Informe, ne bloque jamais (choix produit #1).
 */
@Injectable()
export class ServiceCapaciteRendezVous {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async capacite(
    ctx: ContexteTenant,
    filtres: FiltresCapaciteRendezVous,
  ): Promise<ReponseCapaciteRendezVous> {
    let dates: readonly string[];
    try {
      dates = enumererDatesInclusives(filtres.du, filtres.au);
    } catch (erreur) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        erreur instanceof Error ? erreur.message : 'Période de capacité invalide.',
        { erreurs: [{ champ: 'au', code: 'periode_invalide', message: 'Période invalide.' }] },
      );
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const capaciteMinutes = capaciteMinutesDepuisCentiemes(
        await chargerCapaciteHeuresJourCentiemes(tx, ctx, filtres.siteId),
      );

      // Comptage de capacité : uniquement les RDV `confirme` (rendez_vous_actifs_idx) — un RDV
      // honoré/absent/annulé ne consomme plus de capacité (RV-06).
      const lignes =
        dates.length === 0
          ? []
          : await tx
              .select({
                date: rendezVous.date,
                moment: rendezVous.moment,
                dureeEstimeeMinutes: rendezVous.dureeEstimeeMinutes,
              })
              .from(rendezVous)
              .where(
                and(
                  eq(rendezVous.tenantId, ctx.tenantId),
                  eq(rendezVous.siteId, filtres.siteId),
                  eq(rendezVous.statut, 'confirme'),
                  gte(rendezVous.date, filtres.du),
                  lte(rendezVous.date, filtres.au),
                ),
              );

      const occupation = new Map<string, number>();
      for (const ligne of lignes) {
        const cle = `${ligne.date}|${ligne.moment}`;
        occupation.set(cle, (occupation.get(cle) ?? 0) + ligne.dureeEstimeeMinutes);
      }

      const jours: CapaciteJourRendezVous[] = [];
      for (const dateLe of dates) {
        for (const moment of MOMENTS_RENDEZ_VOUS as readonly MomentRendezVous[]) {
          const minutesOccupees = occupation.get(`${dateLe}|${moment}`) ?? 0;
          jours.push({
            dateLe,
            moment,
            minutesOccupees,
            capaciteMinutes,
            etat: calculerEtatCapaciteJour(minutesOccupees, capaciteMinutes),
          });
        }
      }

      return { siteId: filtres.siteId, jours };
    });
  }

  /** Occupation d'UN SEUL (site, date, moment) — sert l'avertissement `PLANNING_CAPACITE_DEPASSEE`
   *  à la création d'un rendez-vous (`ServiceRendezVous.creer`), sans reconstruire toute la page. */
  async capaciteMoment(
    ctx: ContexteTenant,
    siteId: string,
    dateLe: string,
    moment: MomentRendezVous,
  ): Promise<{ readonly minutesOccupees: number; readonly capaciteMinutes: number | null }> {
    return this.acces.enTenant(ctx, async (tx) => {
      const capaciteMinutes = capaciteMinutesDepuisCentiemes(
        await chargerCapaciteHeuresJourCentiemes(tx, ctx, siteId),
      );
      const lignes = await tx
        .select({ dureeEstimeeMinutes: rendezVous.dureeEstimeeMinutes })
        .from(rendezVous)
        .where(
          and(
            eq(rendezVous.tenantId, ctx.tenantId),
            eq(rendezVous.siteId, siteId),
            eq(rendezVous.statut, 'confirme'),
            eq(rendezVous.date, dateLe),
            eq(rendezVous.moment, moment),
          ),
        );
      const minutesOccupees = lignes.reduce((total, l) => total + l.dureeEstimeeMinutes, 0);
      return { minutesOccupees, capaciteMinutes };
    });
  }
}
