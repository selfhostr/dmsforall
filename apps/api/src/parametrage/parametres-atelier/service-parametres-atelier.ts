import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { POLITIQUES_CONTROLE_QUALITE } from '@dfa/shared';

import {
  JETON_DB,
  schema,
  type AccesBase,
  type ContexteTenant,
  type TransactionDfa,
} from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import { verifierChampsActifsParametresAtelier } from './gouvernance-fonctionnalites';
import {
  versColonnesMiseAJour,
  versDtoParametresAtelier,
  type DtoParametresAtelier,
} from './mappeur-parametres-atelier';
import type { EntreeModificationParametresAtelierEtendue } from './schema-modification-parametres-atelier-etendu';

/**
 * Δ3 (`db/migrations/0005_parametrage.sql`) : le type PG `politique_controle_qualite` reste
 * complet (4 valeurs, pour le lot 2), mais un `CHECK` restreint la colonne à `jamais`/`toujours`
 * au lot 1. Le schéma zod gelé (`schemaModificationParametresAtelier`, `packages/shared`) accepte
 * pourtant les 4 valeurs de l'enum complet — un client qui enverrait `selon_type` franchirait donc
 * la validation de forme et ne serait rattrapé que par la contrainte SQL, avec un message Postgres
 * brut. Ce garde-fou applicatif restitue une erreur métier lisible AVANT d'atteindre la base.
 */
const CONTROLE_QUALITE_VALEURS_LOT1: ReadonlySet<string> = new Set(['jamais', 'toujours']);

@Injectable()
export class ServiceParametresAtelier {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant): Promise<DtoParametresAtelier> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerLigne(tx, ctx.tenantId);
      return versDtoParametresAtelier(ligne);
    });
  }

  async modifier(
    ctx: ContexteTenant,
    entree: EntreeModificationParametresAtelierEtendue,
  ): Promise<DtoParametresAtelier> {
    verifierChampsActifsParametresAtelier(entree);
    this.verifierControleQualiteLot1(entree);

    const colonnes = versColonnesMiseAJour(entree);

    return this.acces.enTenant(ctx, async (tx) => {
      if (Object.keys(colonnes).length === 0) {
        // Corps entièrement composé de domaines absents (`{}` ou domaines vides après validation) :
        // rien à écrire, on relit l'état courant plutôt que d'exécuter un UPDATE sans SET.
        const ligne = await this.chargerLigne(tx, ctx.tenantId);
        return versDtoParametresAtelier(ligne);
      }

      const [ligne] = await tx
        .update(schema.parametreAtelier)
        .set(colonnes)
        .where(eq(schema.parametreAtelier.tenantId, ctx.tenantId))
        .returning();

      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          'Paramètres atelier introuvables pour ce tenant : la ligne de paramétrage aurait dû être créée à la création du tenant.',
        );
      }
      return versDtoParametresAtelier(ligne);
    });
  }

  private async chargerLigne(
    tx: TransactionDfa,
    tenantId: string,
  ): Promise<schema.LigneParametreAtelier> {
    const [ligne] = await tx
      .select()
      .from(schema.parametreAtelier)
      .where(eq(schema.parametreAtelier.tenantId, tenantId));
    if (!ligne) {
      throw new ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        'Paramètres atelier introuvables pour ce tenant : la ligne de paramétrage aurait dû être créée à la création du tenant.',
      );
    }
    return ligne;
  }

  private verifierControleQualiteLot1(entree: EntreeModificationParametresAtelierEtendue): void {
    const valeur = entree.travaux?.controleQualite;
    if (valeur === undefined) return;
    if (!CONTROLE_QUALITE_VALEURS_LOT1.has(valeur)) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        `"travaux.controleQualite" est restreint à ${[...CONTROLE_QUALITE_VALEURS_LOT1].join('|')} au lot 1 (Δ3).`,
        {
          erreurs: [
            {
              champ: 'travaux.controleQualite',
              code: 'valeur_hors_lot1',
              message: `Valeurs admises au lot 1 : ${POLITIQUES_CONTROLE_QUALITE.filter((v) =>
                CONTROLE_QUALITE_VALEURS_LOT1.has(v),
              ).join(', ')}.`,
            },
          ],
        },
      );
    }
  }
}
