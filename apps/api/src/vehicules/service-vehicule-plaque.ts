import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { EntreePlaqueVehicule, ReponseVehiculePlaque } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculePlaque, type LigneVehiculePlaque } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import { interpreterContrainteVehicule } from './erreurs-contraintes';
import { exigerVehiculeExiste, listerPlaques } from './vehicule-requetes';

function versReponse(ligne: LigneVehiculePlaque): ReponseVehiculePlaque {
  return {
    id: ligne.id,
    valeur: ligne.valeur,
    canton: ligne.canton,
    pays: ligne.pays,
    debutLe: ligne.du,
    finLe: ligne.au,
    interchangeable: ligne.interchangeable,
    professionnelle: ligne.professionnelle,
  };
}

/**
 * Plaques historisées d'un véhicule (RM-17/18/19). `erreurs-contraintes.ts` interprète
 * `vehicule_plaque_collision_excl` en `409 VEHICULE_PLAQUE_COLLISION` (CT-06) — la levée pour les
 * plaques interchangeables/professionnelles est DANS la contrainte base (clause `WHERE` de
 * l'`EXCLUDE`), jamais réimplémentée ici.
 */
@Injectable()
export class ServiceVehiculePlaque {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(ctx: ContexteTenant, vehiculeId: string): Promise<readonly ReponseVehiculePlaque[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await exigerVehiculeExiste(tx, ctx, vehiculeId);
      const lignes = await listerPlaques(tx, ctx, vehiculeId);
      return lignes.map(versReponse);
    });
  }

  async creer(ctx: ContexteTenant, vehiculeId: string, entree: EntreePlaqueVehicule): Promise<ReponseVehiculePlaque> {
    return this.acces.enTenant(ctx, async (tx) => {
      await exigerVehiculeExiste(tx, ctx, vehiculeId);

      try {
        const lignes = await tx
          .insert(vehiculePlaque)
          .values({
            tenantId: ctx.tenantId,
            vehiculeId,
            valeur: entree.valeur,
            canton: entree.canton ?? null,
            pays: entree.pays,
            du: entree.debutLe,
            interchangeable: entree.interchangeable,
            professionnelle: entree.professionnelle,
          })
          .returning();
        const inseree = lignes[0];
        if (!inseree) {
          throw new ErreurMetier('ERREUR_INTERNE', "L'insertion de la plaque n'a rendu aucune ligne.");
        }
        return versReponse(inseree);
      } catch (erreur) {
        const interpretation = interpreterContrainteVehicule(erreur);
        if (interpretation) {
          throw new ErreurMetier(
            interpretation.code,
            'Cette plaque est déjà portée par un autre véhicule sur une période qui chevauche (RM-18).',
          );
        }
        throw erreur;
      }
    });
  }

  async cloturer(ctx: ContexteTenant, vehiculeId: string, plaqueId: string, finLe: string): Promise<ReponseVehiculePlaque> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(vehiculePlaque)
        .where(
          and(
            eq(vehiculePlaque.tenantId, ctx.tenantId),
            eq(vehiculePlaque.vehiculeId, vehiculeId),
            eq(vehiculePlaque.id, plaqueId),
          ),
        )
        .limit(1);
      const existante = lignes[0];
      if (!existante) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Plaque introuvable.');
      }
      if (existante.au) {
        throw new ErreurMetier('CONFLIT', 'Cette plaque est déjà clôturée.');
      }

      const misesAJour = await tx
        .update(vehiculePlaque)
        .set({ au: finLe })
        .where(and(eq(vehiculePlaque.tenantId, ctx.tenantId), eq(vehiculePlaque.id, plaqueId)))
        .returning();
      const mise = misesAJour[0];
      if (!mise) {
        throw new ErreurMetier('ERREUR_INTERNE', 'La clôture de plaque n’a rendu aucune ligne.');
      }
      return versReponse(mise);
    });
  }
}
