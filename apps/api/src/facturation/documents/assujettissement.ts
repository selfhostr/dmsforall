import { eq } from 'drizzle-orm';
import type { RegimeTva } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { tenant } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

/**
 * Assujettissement du garage à la TVA (`tenant.assujetti_tva`, migration 0090) appliqué à la chaîne
 * documentaire.
 *
 * Règle (LTVA) : un garage NON assujetti ne facture jamais de TVA — s'il en mentionne, il la doit
 * à l'AFC (art. 27 LTVA). Ses lignes sont donc à 0 ‰, régime {@link REGIME_NON_ASSUJETTI}.
 * Un garage assujetti doit porter son n° TVA sur ses factures (art. 26 LTVA).
 *
 * Régime retenu pour un non-assujetti : `exclu` (hors champ de l'impôt — il n'est pas contribuable)
 * et non `exonere` (opération imposable mais exonérée, art. 21 LTVA, qui suppose un assujetti).
 */
export const REGIME_NON_ASSUJETTI: RegimeTva = 'exclu';

export interface SituationTvaGarage {
  readonly assujetti: boolean;
  readonly numeroTva: string | null;
}

/** Lit l'assujettissement du tenant courant dans la transaction en cours (scopé par `tenant.id`). */
export async function chargerSituationTva(
  tx: TransactionDfa,
  ctx: ContexteTenant,
): Promise<SituationTvaGarage> {
  const [ligne] = await tx
    .select({ assujetti: tenant.assujettiTva, numeroTva: tenant.numeroTva })
    .from(tenant)
    .where(eq(tenant.id, ctx.tenantId))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Garage introuvable pour cette session.');
  }
  return { assujetti: ligne.assujetti, numeroTva: ligne.numeroTva };
}

/**
 * Taux et régime d'une ligne SAISIE ou RECOPIÉE, au régime ACTUEL du garage.
 *
 * - Non assujetti : taux absent = 0 ; taux > 0 refusé (`TVA_NON_ASSUJETTI_TAUX_INTERDIT`, même
 *   code que l'émission) ; régime toujours {@link REGIME_NON_ASSUJETTI}.
 * - Assujetti : valeurs inchangées (le taux, s'il manque, reste à la charge de l'appelant).
 */
export function normaliserTauxEtRegime(
  situation: SituationTvaGarage,
  saisi: { readonly tauxTvaPourmille: number | null | undefined; readonly regimeTva: RegimeTva },
  numeroOrdre?: number,
): { readonly tauxTvaPourmille: number | null; readonly regimeTva: RegimeTva } {
  if (situation.assujetti) {
    return { tauxTvaPourmille: saisi.tauxTvaPourmille ?? null, regimeTva: saisi.regimeTva };
  }
  const taux = saisi.tauxTvaPourmille ?? 0;
  if (taux > 0)
    throw erreurTauxInterdit([{ numeroOrdre: numeroOrdre ?? 0, tauxTvaPourmille: taux }]);
  return { tauxTvaPourmille: 0, regimeTva: REGIME_NON_ASSUJETTI };
}

/**
 * Taux et régime d'une ligne RECOPIÉE d'un document antérieur (correction de facture en
 * brouillon, conversion devis → OR), au régime ACTUEL du garage.
 *
 * Contrairement à {@link normaliserTauxEtRegime}, ne REFUSE jamais une ligne héritée à taux > 0 :
 * un garage devenu non assujetti depuis l'émission d'origine recopie ses lignes à 0 ‰ / `exclu`
 * (le prix TTC saisi est conservé, donc HT = TTC) ; l'ancien taux n'est pas une saisie fautive.
 * Un garage assujetti garde taux et régime d'origine.
 */
export function adapterLigneRecopieeAuRegimeActuel(
  situation: SituationTvaGarage,
  origine: { readonly tauxTvaPourmille: number | null | undefined; readonly regimeTva: RegimeTva },
): { readonly tauxTvaPourmille: number | null; readonly regimeTva: RegimeTva } {
  return normaliserTauxEtRegime(situation, {
    tauxTvaPourmille: situation.assujetti ? origine.tauxTvaPourmille : 0,
    regimeTva: origine.regimeTva,
  });
}

function erreurTauxInterdit(fautives: readonly LigneAControler[]): ErreurMetier {
  return new ErreurMetier(
    'TVA_NON_ASSUJETTI_TAUX_INTERDIT',
    'Le garage n’est pas assujetti à la TVA : aucune ligne ne peut porter de TVA ' +
      `(ligne(s) ${fautives.map((l) => l.numeroOrdre).join(', ')}).`,
    {
      erreurs: fautives.map((l) => ({
        champ: `lignes[${l.numeroOrdre}].tauxTvaPourmille`,
        code: 'taux_tva_interdit_non_assujetti',
        message: `Ligne ${l.numeroOrdre} : taux ${l.tauxTvaPourmille} ‰ interdit, le garage n’est pas assujetti à la TVA (taux 0 attendu).`,
      })),
    },
  );
}

interface LigneAControler {
  readonly numeroOrdre: number;
  readonly tauxTvaPourmille: number;
}

/**
 * Contrôles TVA propres au garage, appelés AVANT l'allocation du numéro (un refus ne consomme
 * aucun numéro, RF-23/24).
 *
 * - Non assujetti : toute ligne à taux > 0 est refusée (`TVA_NON_ASSUJETTI_TAUX_INTERDIT`), sauf
 *   pour un AVOIR : il reprend les lignes de la facture qu'il corrige, émise peut-être quand le
 *   garage était assujetti ; la bloquer interdirait toute correction (jamais de retouche d'un
 *   document émis, l'avoir le miroir exact).
 * - Assujetti sans n° TVA : une FACTURE ou un AVOIR ne peut pas être émis (`TVA_NUMERO_REQUIS`) ;
 *   un devis ou un bon de commande n'est pas une facture, il reste émissible.
 */
export function verifierEmissionSelonAssujettissement(
  situation: SituationTvaGarage,
  typeDocument: string,
  lignes: readonly LigneAControler[],
): void {
  if (!situation.assujetti) {
    if (typeDocument === 'avoir') return;
    const fautives = lignes.filter((l) => l.tauxTvaPourmille > 0);
    if (fautives.length > 0) {
      throw erreurTauxInterdit(fautives);
    }
    return;
  }

  if (
    (typeDocument === 'facture' || typeDocument === 'avoir') &&
    (situation.numeroTva === null || situation.numeroTva.trim() === '')
  ) {
    throw new ErreurMetier(
      'TVA_NUMERO_REQUIS',
      'Le garage est assujetti à la TVA mais son numéro de TVA n’est pas renseigné : ' +
        'impossible d’émettre ce document (art. 26 LTVA).',
      {
        erreurs: [
          {
            champ: 'numeroTva',
            code: 'champ_requis',
            message: 'Renseignez le numéro de TVA du garage dans les réglages de facturation.',
          },
        ],
      },
    );
  }
}
