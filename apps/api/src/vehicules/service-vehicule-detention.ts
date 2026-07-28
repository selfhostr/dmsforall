import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { EntreeChangementDetenteur, EntreeDetentionVehicule, ReponseVehiculeDetention } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { client, vehiculeDetention, vehiculePlaque, type LigneClient } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import { Horloge } from '../common/horloge';
import { calculerNomAffiche } from '../common/identite-client';
import { interpreterContrainteVehicule } from './erreurs-contraintes';
import type { EntreeClotureDetentionVehicule } from './schemas-locales';
import {
  chargerLigneVehicule,
  construireReponseVehicule,
  type DetentionAvecClient,
  lireDetentionCouranteAvecClient,
  listerDetentions,
} from './vehicule-requetes';
import type { ResultatEcritureVehicule } from './service-vehicule';

function versReponse(entree: DetentionAvecClient): ReponseVehiculeDetention {
  return {
    id: entree.detention.id,
    client: {
      id: entree.client.id,
      numeroClient: entree.client.numero,
      nomAffiche: calculerNomAffiche(entree.client),
    },
    debutLe: entree.detention.du,
    finLe: entree.detention.au,
    motifFin: entree.detention.motifFin,
  };
}

/**
 * Détentions historisées (RM-20/21) et changement de détenteur ATOMIQUE (RM-20/21, CT-47) —
 * clôture de l'ancienne + ouverture de la nouvelle + plaque éventuelle, dans UNE seule
 * transaction, avec UNE seule entrée d'événement `vehicule.detenteur_change`.
 */
@Injectable()
export class ServiceVehiculeDetention {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    private readonly horloge: Horloge,
  ) {}

  async lister(ctx: ContexteTenant, vehiculeId: string): Promise<readonly ReponseVehiculeDetention[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      const lignes = await listerDetentions(tx, ctx, vehiculeId);
      return lignes.map(versReponse);
    });
  }

  /** `POST /vehicules/{id}/detentions` — correction d'historique et import UNIQUEMENT (§7.4). */
  async creer(ctx: ContexteTenant, vehiculeId: string, entree: EntreeDetentionVehicule): Promise<ReponseVehiculeDetention> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);

      try {
        const lignes = await tx
          .insert(vehiculeDetention)
          .values({ tenantId: ctx.tenantId, vehiculeId, clientId: entree.clientId, du: entree.debutLe })
          .returning();
        const inseree = lignes[0];
        if (!inseree) {
          throw new ErreurMetier('ERREUR_INTERNE', "L'insertion de la détention n'a rendu aucune ligne.");
        }
        const client = await this.chargerClient(tx, ctx, inseree.clientId);
        return versReponse({ detention: inseree, client });
      } catch (erreur) {
        this.relancerConflitDetention(erreur);
      }
    });
  }

  async cloturer(
    ctx: ContexteTenant,
    vehiculeId: string,
    detentionId: string,
    entree: EntreeClotureDetentionVehicule,
  ): Promise<ReponseVehiculeDetention> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(vehiculeDetention)
        .where(
          and(
            eq(vehiculeDetention.tenantId, ctx.tenantId),
            eq(vehiculeDetention.vehiculeId, vehiculeId),
            eq(vehiculeDetention.id, detentionId),
          ),
        )
        .limit(1);
      const existante = lignes[0];
      if (!existante) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Détention introuvable.');
      }
      if (existante.au) {
        throw new ErreurMetier('CONFLIT', 'Cette détention est déjà clôturée.');
      }

      const misesAJour = await tx
        .update(vehiculeDetention)
        .set({ au: entree.finLe, motifFin: entree.motifFin })
        .where(and(eq(vehiculeDetention.tenantId, ctx.tenantId), eq(vehiculeDetention.id, detentionId)))
        .returning();
      const mise = misesAJour[0];
      if (!mise) {
        throw new ErreurMetier('ERREUR_INTERNE', 'La clôture de détention n’a rendu aucune ligne.');
      }
      const client = await this.chargerClient(tx, ctx, mise.clientId);
      return versReponse({ detention: mise, client });
    });
  }

  /**
   * `POST /vehicules/{id}/changer-detenteur` — UN appel, UNE transaction, UNE entrée d'audit
   * (déjà portée par le trigger `vehicule_detention_audit`, migrations/0007). Clôture l'ancienne
   * détention et ouvre la nouvelle dans la MÊME transaction que la plaque éventuelle et
   * l'événement — un test d'intégration (L1-15) doit interrompre cette méthode après la clôture
   * et vérifier qu'aucun état intermédiaire n'est observable (rollback complet).
   */
  async changerDetenteur(
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: EntreeChangementDetenteur,
  ): Promise<ResultatEcritureVehicule> {
    return this.acces.enTenant(ctx, async (tx) => {
      const avertissements = new CollecteurAvertissements();
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      const detentionActuelle = await lireDetentionCouranteAvecClient(tx, ctx, vehiculeId);

      try {
        if (detentionActuelle) {
          await tx
            .update(vehiculeDetention)
            .set({ au: entree.changementLe, motifFin: entree.motifFin })
            .where(
              and(eq(vehiculeDetention.tenantId, ctx.tenantId), eq(vehiculeDetention.id, detentionActuelle.detention.id)),
            );
        }

        await tx.insert(vehiculeDetention).values({
          tenantId: ctx.tenantId,
          vehiculeId,
          clientId: entree.nouveauClientId,
          du: entree.changementLe,
        });
      } catch (erreur) {
        this.relancerConflitDetention(erreur);
      }

      if (entree.nouvellePlaque) {
        try {
          await tx
            .update(vehiculePlaque)
            .set({ au: entree.changementLe })
            .where(
              and(eq(vehiculePlaque.tenantId, ctx.tenantId), eq(vehiculePlaque.vehiculeId, vehiculeId), isNull(vehiculePlaque.au)),
            );
          await tx.insert(vehiculePlaque).values({
            tenantId: ctx.tenantId,
            vehiculeId,
            valeur: entree.nouvellePlaque.valeur,
            canton: entree.nouvellePlaque.canton ?? null,
            pays: entree.nouvellePlaque.pays,
            du: entree.changementLe,
            interchangeable: entree.nouvellePlaque.interchangeable,
            professionnelle: entree.nouvellePlaque.professionnelle,
          });
        } catch (erreur) {
          const interpretation = interpreterContrainteVehicule(erreur);
          if (interpretation) {
            throw new ErreurMetier(interpretation.code, 'La nouvelle plaque est déjà portée par un autre véhicule (RM-18).');
          }
          throw erreur;
        }
      }

      await this.evenements.publier(tx, ctx, {
        type: 'vehicule.detenteur_change',
        versionSchema: 1,
        siteId: null,
        ressource: { type: 'vehicule', id: vehiculeId },
        donnees: {
          ancienClientId: detentionActuelle?.client.id ?? null,
          nouveauClientId: entree.nouveauClientId,
          changementLe: entree.changementLe,
          motifFin: entree.motifFin,
        },
      });

      const reponse = await construireReponseVehicule(tx, ctx, vehiculeId, this.horloge.maintenant());
      return { donnees: reponse, avertissements };
    });
  }

  private async chargerClient(tx: TransactionDfa, ctx: ContexteTenant, clientId: string): Promise<LigneClient> {
    const lignes = await tx
      .select()
      .from(client)
      .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
      .limit(1);
    const ligne = lignes[0];
    if (!ligne) {
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');
    }
    return ligne;
  }

  private relancerConflitDetention(erreur: unknown): never {
    const interpretation = interpreterContrainteVehicule(erreur);
    if (interpretation) {
      throw new ErreurMetier(interpretation.code, 'Ce véhicule a déjà un détenteur courant sur cette période (RM-20, CT-47).', {
        erreurs: [{ champ: 'changementLe', code: 'detenteur_deja_courant', message: 'Deux détenteurs courants simultanés sont impossibles.' }],
      });
    }
    throw erreur;
  }
}
