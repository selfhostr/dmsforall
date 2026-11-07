import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  EntreeModificationParametresEntreprise,
  ReponseParametresEntreprise,
} from '@dfa/shared';

import { JETON_DB, schema, type AccesBase, type ContexteTenant } from '../../db';
import { auditAtelier } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';

const COLONNES_REPONSE = {
  raisonSociale: schema.tenant.raisonSociale,
  assujettiTva: schema.tenant.assujettiTva,
  numeroTva: schema.tenant.numeroTva,
  delaiPaiementJoursDefaut: schema.tenant.delaiPaiementJoursDefaut,
  modeSignalement: schema.tenant.modeSignalement,
} as const;

/**
 * Identité du tenant courant (`tenant.raison_sociale`, `numero_tva`, délai de paiement). Le tenant vient du contexte de session,
 * jamais d'un paramètre : il n'existe aucun `tenantId` dans cette API.
 */
@Injectable()
export class ServiceParametresEntreprise {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant): Promise<ReponseParametresEntreprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx
        .select(COLONNES_REPONSE)
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      if (!ligne) throw this.tenantIntrouvable();
      return ligne;
    });
  }

  async modifier(
    ctx: ContexteTenant,
    entree: EntreeModificationParametresEntreprise,
  ): Promise<ReponseParametresEntreprise> {
    if (
      entree.raisonSociale === undefined &&
      entree.numeroTva === undefined &&
      entree.assujettiTva === undefined &&
      entree.delaiPaiementJoursDefaut === undefined &&
      entree.modeSignalement === undefined
    ) {
      return this.obtenir(ctx);
    }

    return this.acces.enTenant(ctx, async (tx) => {
      // Valeurs AVANT lues dans la transaction pour le journal et pour la règle d'assujettissement.
      // Le slug n'est jamais écrit ; les documents déjà émis gardent leur raison sociale figée
      // (leur snapshot), les nouveaux lisent la valeur courante.
      const [avant] = await tx
        .select(COLONNES_REPONSE)
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      if (!avant) throw this.tenantIntrouvable();

      // Règle d'assujettissement : un non-assujetti n'a pas de n° TVA (CHECK en base, 0090). Un
      // « Non » VIDE donc le numéro ; envoyer un numéro avec « Non » (ou à un garage déjà non
      // assujetti) est une contradiction refusée, jamais corrigée en silence. « Oui » sans numéro
      // est accepté (on peut répondre avant d'avoir le numéro) : c'est l'émission d'une facture
      // qui l'exige (`TVA_NUMERO_REQUIS`).
      const assujettiFinal = entree.assujettiTva ?? avant.assujettiTva;
      if (!assujettiFinal && typeof entree.numeroTva === 'string') {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Un garage non assujetti à la TVA ne peut pas avoir de numéro de TVA.',
          {
            erreurs: [
              {
                champ: 'numeroTva',
                code: 'numero_tva_interdit_non_assujetti',
                message:
                  'Un garage non assujetti à la TVA ne peut pas avoir de numéro de TVA : indiquez d’abord que le garage est assujetti.',
              },
            ],
          },
        );
      }
      const numeroTva = assujettiFinal ? entree.numeroTva : null;

      // Seuls les champs ENVOYÉS sont écrits (`undefined` est ignoré par Drizzle) : un PATCH du
      // délai ne touche pas au n° TVA, et inversement.
      const [ligne] = await tx
        .update(schema.tenant)
        .set({
          raisonSociale: entree.raisonSociale,
          numeroTva,
          assujettiTva: entree.assujettiTva,
          delaiPaiementJoursDefaut: entree.delaiPaiementJoursDefaut,
          modeSignalement: entree.modeSignalement,
        })
        .where(eq(schema.tenant.id, ctx.tenantId))
        .returning(COLONNES_REPONSE);
      if (!ligne) throw this.tenantIntrouvable();

      const champsAudites = [
        ['raison_sociale', avant.raisonSociale, ligne.raisonSociale],
        ['assujetti_tva', avant.assujettiTva, ligne.assujettiTva],
        ['mode_signalement', avant.modeSignalement, ligne.modeSignalement],
        // Le n° TVA n'est journalisé que lorsqu'il est EFFACÉ par un changement d'assujettissement
        // (« Non ») : sa saisie ordinaire n'a jamais été auditée.
        ['numero_tva', avant.numeroTva, ligne.numeroTva],
      ] as const;
      for (const [champ, valeurAvant, valeurApres] of champsAudites) {
        if (valeurAvant === valeurApres) continue;
        if (champ === 'numero_tva' && entree.assujettiTva === undefined) continue;
        await tx.insert(auditAtelier).values({
          tenantId: ctx.tenantId,
          entite: 'tenant',
          entiteId: ctx.tenantId,
          action: 'modification',
          champ,
          valeurAvant,
          valeurApres,
          utilisateurId: ctx.utilisateurId,
          requeteId: ctx.requeteId,
        });
      }
      return ligne;
    });
  }

  private tenantIntrouvable(): ErreurMetier {
    return new ErreurMetier('RESSOURCE_INTROUVABLE', 'Garage introuvable pour cette session.');
  }
}
