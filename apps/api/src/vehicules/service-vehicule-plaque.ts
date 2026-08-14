import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { EntreePlaqueVehicule, ReponseVehiculePlaque } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculePlaque, type LigneVehiculePlaque } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import { interpreterContrainteVehicule } from './erreurs-contraintes';
import {
  exigerVehiculeExiste,
  listerPlaques,
  trouverVehiculeCollisionPlaque,
} from './vehicule-requetes';

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

  /**
   * Le `try/catch` enveloppe l'APPEL À `enTenant`, pas seulement l'INSERT : une fois l'INSERT en
   * échec, la transaction Postgres est ABORTÉE (25P02, « current transaction is aborted ») —
   * toute requête supplémentaire sur cette même transaction serait rejetée, y compris une simple
   * lecture. `enTenant` rollback et referme cette transaction dès que sa callback rejette ; la
   * relecture de secours (dette technique n°6, `trouverVehiculeCollisionPlaque`) doit donc
   * s'exécuter dans une NOUVELLE transaction, ouverte APRÈS ce rollback — jamais dans `tx`
   * ci-dessous. (Mesuré : la version qui réutilisait `tx` produisait un `500 ERREUR_INTERNE`
   * systématique sur toute collision réelle, jamais un `409` — vérifié contre la vraie base.)
   */
  async creer(
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: EntreePlaqueVehicule,
  ): Promise<ReponseVehiculePlaque> {
    try {
      return await this.acces.enTenant(ctx, async (tx) => {
        await exigerVehiculeExiste(tx, ctx, vehiculeId);

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
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion de la plaque n'a rendu aucune ligne.",
          );
        }
        return versReponse(inseree);
      });
    } catch (erreur) {
      if (erreur instanceof ErreurMetier) {
        throw erreur;
      }
      const interpretation = interpreterContrainteVehicule(erreur);
      if (!interpretation) {
        throw erreur;
      }
      // Dette technique n°6 : la contrainte d'EXCLUSION qui vient de refuser ne porte pas la
      // ligne fautive (ce n'est pas une clé unique) — on va la rechercher pour nommer le véhicule
      // dans le `problem+json`, UNIQUEMENT dans cette branche d'erreur, jamais sur le chemin
      // nominal, dans une transaction FRAÎCHE (voir commentaire de tête). Cas de course (ligne
      // disparue entre l'échec de l'INSERT et cette relecture) : `collision` vaut `null`, l'erreur
      // reste correcte sans détail de véhicule — jamais un identifiant inventé.
      const collision =
        interpretation.code === 'VEHICULE_PLAQUE_COLLISION'
          ? await this.acces.enTenant(ctx, (tx) =>
              trouverVehiculeCollisionPlaque(tx, ctx, {
                valeur: entree.valeur,
                debutLe: entree.debutLe,
              }),
            )
          : null;
      // `id: 'valeur'` — nom du champ fautif DANS LE CORPS DE CETTE requête
      // (`EntreePlaqueVehicule.valeur`). Diffère volontairement de `'plaque'` posé par
      // `ServiceVehicule.relancerErreurContraintePlaqueCreation` (`POST /vehicules`,
      // `EntreeCreationVehicule.plaque`) — CONFIRMÉ, pas un bug (issue #95), doc complète dans
      // `DetailCollisionPlaqueVehicule` (`@dfa/shared`). Un consommateur ne doit JAMAIS brancher
      // sur `blocages[0].id`, seulement sur `.donnees`.
      throw new ErreurMetier(
        interpretation.code,
        'Cette plaque est déjà portée par un autre véhicule sur une période qui chevauche (RM-18).',
        {
          blocages: collision
            ? [
                {
                  type: 'champ',
                  id: 'valeur',
                  libelle: `Plaque déjà portée par le véhicule ${collision.marque} ${collision.modele}`,
                  donnees: { ...collision },
                },
              ]
            : undefined,
        },
      );
    }
  }

  async cloturer(
    ctx: ContexteTenant,
    vehiculeId: string,
    plaqueId: string,
    finLe: string,
  ): Promise<ReponseVehiculePlaque> {
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
