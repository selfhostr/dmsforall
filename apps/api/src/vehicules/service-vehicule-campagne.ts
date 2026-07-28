import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { EntreeCampagneVehicule, ReponseVehiculeCampagne } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculeCampagne, type LigneVehiculeCampagne } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import { Horloge } from '../common/horloge';
import type { EntreeModificationCampagneVehicule } from './schemas-locales';
import { chargerLigneVehicule, listerCampagnes } from './vehicule-requetes';

function versReponse(ligne: LigneVehiculeCampagne): ReponseVehiculeCampagne {
  return {
    id: ligne.id,
    code: ligne.code,
    description: ligne.description ?? '',
    obligatoire: ligne.obligatoire,
    statut: ligne.statut,
    closeLe: ligne.closeLe ? ligne.closeLe.toISOString() : null,
    ordreReparationId: ligne.ordreReparationId,
  };
}

/** Campagnes constructeur (rappels) applicables à un véhicule (RM-30). */
@Injectable()
export class ServiceVehiculeCampagne {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  async lister(ctx: ContexteTenant, vehiculeId: string): Promise<readonly ReponseVehiculeCampagne[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      const lignes = await listerCampagnes(tx, ctx, vehiculeId);
      return lignes.map(versReponse);
    });
  }

  async creer(ctx: ContexteTenant, vehiculeId: string, entree: EntreeCampagneVehicule): Promise<ReponseVehiculeCampagne> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);

      const lignes = await tx
        .insert(vehiculeCampagne)
        .values({
          tenantId: ctx.tenantId,
          vehiculeId,
          code: entree.code,
          description: entree.description,
          obligatoire: entree.obligatoire,
        })
        .returning();
      const inseree = lignes[0];
      if (!inseree) {
        throw new ErreurMetier('ERREUR_INTERNE', "L'insertion de la campagne n'a rendu aucune ligne.");
      }
      return versReponse(inseree);
    });
  }

  async modifier(
    ctx: ContexteTenant,
    vehiculeId: string,
    campagneId: string,
    entree: EntreeModificationCampagneVehicule,
  ): Promise<ReponseVehiculeCampagne> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(vehiculeCampagne)
        .where(
          and(
            eq(vehiculeCampagne.tenantId, ctx.tenantId),
            eq(vehiculeCampagne.vehiculeId, vehiculeId),
            eq(vehiculeCampagne.id, campagneId),
          ),
        )
        .limit(1);
      if (!lignes[0]) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Campagne introuvable.');
      }

      // CHECK base `vehicule_campagne_close_chk` : `close_le` doit être renseigné SI ET SEULEMENT
      // SI `statut = 'close'` — une réouverture doit donc explicitement le remettre à `null`, pas
      // le laisser intact (`undefined` = colonne non touchée par `.set()`, insuffisant ici).
      let closeLe: Date | null | undefined;
      if (entree.statut === 'close') closeLe = this.horloge.maintenant();
      else if (entree.statut === 'ouverte') closeLe = null;
      const misesAJour = await tx
        .update(vehiculeCampagne)
        .set({
          description: entree.description,
          obligatoire: entree.obligatoire,
          statut: entree.statut,
          closeLe,
        })
        .where(and(eq(vehiculeCampagne.tenantId, ctx.tenantId), eq(vehiculeCampagne.id, campagneId)))
        .returning();
      const mise = misesAJour[0];
      if (!mise) {
        throw new ErreurMetier('ERREUR_INTERNE', 'La modification de campagne n’a rendu aucune ligne.');
      }
      return versReponse(mise);
    });
  }
}
