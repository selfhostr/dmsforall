import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { EntreeModificationTravailReporte, ReponseTravailReporte, RoleUtilisateur } from '@dfa/shared';
import { ROLES_SANS_MONTANT } from '../auth/matrice-droits';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculeTravailReporte, type LigneVehiculeTravailReporte } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import type { FiltresTravauxReportes } from './schemas-locales';
import { chargerLigneVehicule, listerTravauxReportes } from './vehicule-requetes';

/**
 * `montantEstimeCentimes` retiré pour les rôles de `ROLES_SANS_MONTANT` (invariant front n°10) —
 * filtrage SERVEUR, appliqué ici et dans `contexte-atelier` (L1-10), jamais laissé au client.
 */
export function versReponseTravailReporte(ligne: LigneVehiculeTravailReporte, role: RoleUtilisateur): ReponseTravailReporte {
  const base: ReponseTravailReporte = {
    id: ligne.id,
    designation: ligne.designation,
    urgence: ligne.urgence,
    kilometrageAlors: ligne.kmConstat,
    constateLe: ligne.dateConstat,
    securite: ligne.securite,
    statut: ligne.statut,
    ordreReparationOrigineId: ligne.ordreReparationOrigineId,
    ligneOrOrigineId: ligne.ligneOrOrigineId,
    ordreReparationRepriseId: ligne.ordreReparationRepriseId,
  };
  if (ROLES_SANS_MONTANT.includes(role)) {
    return base;
  }
  return { ...base, montantEstimeCentimes: ligne.montantEstimeCentimes };
}

/** Travaux reportés (RM-73) — MATÉRIALISÉS, éditables, jamais une vue calculée sur `ligne_or`. */
@Injectable()
export class ServiceVehiculeTravailReporte {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    vehiculeId: string,
    filtres: FiltresTravauxReportes,
    role: RoleUtilisateur,
  ): Promise<readonly ReponseTravailReporte[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      let lignes = await listerTravauxReportes(tx, ctx, vehiculeId);

      if (filtres.statut && filtres.statut.length > 0) {
        const statuts = filtres.statut;
        lignes = lignes.filter((ligne) => statuts.includes(ligne.statut));
      }
      if (filtres.urgence && filtres.urgence.length > 0) {
        const urgences = filtres.urgence;
        lignes = lignes.filter((ligne) => urgences.includes(ligne.urgence));
      }
      if (filtres.tri === 'constateLe:asc') {
        lignes = [...lignes].sort((a, b) => a.dateConstat.localeCompare(b.dateConstat));
      }

      return lignes.map((ligne) => versReponseTravailReporte(ligne, role));
    });
  }

  async modifier(
    ctx: ContexteTenant,
    vehiculeId: string,
    travailId: string,
    entree: EntreeModificationTravailReporte,
    role: RoleUtilisateur,
  ): Promise<ReponseTravailReporte> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(vehiculeTravailReporte)
        .where(
          and(
            eq(vehiculeTravailReporte.tenantId, ctx.tenantId),
            eq(vehiculeTravailReporte.vehiculeId, vehiculeId),
            eq(vehiculeTravailReporte.id, travailId),
          ),
        )
        .limit(1);
      if (!lignes[0]) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Travail reporté introuvable.');
      }

      const misesAJour = await tx
        .update(vehiculeTravailReporte)
        .set({
          designation: entree.designation,
          urgence: entree.urgence,
          montantEstimeCentimes: entree.montantEstimeCentimes,
          statut: entree.statut,
        })
        .where(and(eq(vehiculeTravailReporte.tenantId, ctx.tenantId), eq(vehiculeTravailReporte.id, travailId)))
        .returning();
      const mise = misesAJour[0];
      if (!mise) {
        throw new ErreurMetier('ERREUR_INTERNE', 'La modification du travail reporté n’a rendu aucune ligne.');
      }
      return versReponseTravailReporte(mise, role);
    });
  }
}
