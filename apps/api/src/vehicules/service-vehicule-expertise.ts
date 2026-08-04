import { Inject, Injectable } from '@nestjs/common';
import type { EntreeExpertiseVehicule, ReponseVehiculeExpertise } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculeExpertise, type LigneVehiculeExpertise } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import { chargerLigneVehicule, listerExpertises } from './vehicule-requetes';

function versReponse(ligne: LigneVehiculeExpertise): ReponseVehiculeExpertise {
  return {
    id: ligne.id,
    dateLe: ligne.dateExpertise,
    resultat: ligne.resultat,
    defauts: ligne.defauts,
    delaiContreVisiteLe: ligne.delaiContreVisite,
    dateContreVisiteLe: ligne.dateContreVisite,
    prochaineEcheanceLe: ligne.prochaineEcheance,
    // Le contrat déclare `sourceEcheance` non nullable ; la colonne base l'est (CHECK couplé à
    // `prochaine_echeance`). `calculee` par défaut quand ni l'un ni l'autre n'est renseigné —
    // cohérent avec RM-28 (aucune échéance connue = pas de convocation qui prime).
    sourceEcheance: ligne.sourceEcheance ?? 'calculee',
  };
}

/** Expertises (MFK) d'un véhicule (RM-28/29, CT-10) — la convocation cantonale prime toujours. */
@Injectable()
export class ServiceVehiculeExpertise {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    vehiculeId: string,
  ): Promise<readonly ReponseVehiculeExpertise[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      const lignes = await listerExpertises(tx, ctx, vehiculeId);
      return lignes.map(versReponse);
    });
  }

  async creer(
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: EntreeExpertiseVehicule,
  ): Promise<ReponseVehiculeExpertise> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);

      const lignes = await tx
        .insert(vehiculeExpertise)
        .values({
          tenantId: ctx.tenantId,
          vehiculeId,
          dateExpertise: entree.dateLe,
          resultat: entree.resultat,
          defauts: entree.defauts ?? null,
          delaiContreVisite: entree.delaiContreVisiteLe ?? null,
          dateContreVisite: entree.dateContreVisiteLe ?? null,
          prochaineEcheance: entree.prochaineEcheanceLe ?? null,
          sourceEcheance: entree.prochaineEcheanceLe ? entree.sourceEcheance : null,
        })
        .returning();
      const inseree = lignes[0];
      if (!inseree) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "L'insertion de l'expertise n'a rendu aucune ligne.",
        );
      }
      return versReponse(inseree);
    });
  }
}
