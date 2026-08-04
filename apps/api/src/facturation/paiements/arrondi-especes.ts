import type { MoyenPaiement } from '@dfa/shared';

import { ErreurMetier } from '../../common/erreurs';

/**
 * Arrondi au 5 centimes (RF-49 → RF-52, MD-49) — la partie ARITHMÉTIQUE et sa validation, isolée
 * du reste du service pour rester testable sans base de données.
 *
 * Décision de conception (à signaler, pas à improviser) : le CLIENT (écran de caisse) soumet
 * l'ajustement d'arrondi comme une imputation `arrondi` EXPLICITE, visible, au même titre que la
 * `reglement` qui l'accompagne — RF-74 : « l'écran calcule et affiche le montant à encaisser avant
 * que le tiroir s'ouvre ». Le SERVEUR ne calcule donc pas l'arrondi à la place de l'opérateur (il
 * ne connaît pas la pièce physique rendue), mais il ne lui fait pas confiance non plus : il
 * REVALIDE intégralement la valeur soumise contre l'état réel du document, dans cette fonction.
 * C'est le même partage des responsabilités que l'escompte (RF-47/48, jamais automatique, toujours
 * un geste humain confirmé) — jamais silencieux, jamais improvisé côté serveur.
 *
 * Trois conditions, TOUTES nécessaires (RF-49, RF-50, RF-51) :
 *   1. Le moyen de paiement du versement est `especes` — un arrondi sur une carte ou un virement
 *      fausserait le rapprochement bancaire au centime près (consigne explicite de la tâche).
 *   2. Le paramètre tenant `arrondi_especes_actif` (PF-05/AC-20) est actif.
 *   3. L'ajustement, cumulé au règlement du même lot et au montant déjà réglé du document, SOLDE
 *      EXACTEMENT le document (RF-49 : « uniquement à celui qui solde ») — un arrondi qui laisse un
 *      reliquat ouvert n'a pas de sens : il servirait à maquiller un paiement partiel en paiement
 *      complet.
 *
 * Magnitude bornée à 2 centimes (RF-51 : intervalle {−2,…,+2}, 0 exclu par la contrainte SQL
 * `imputation_paiement_montant_non_nul_chk`) — c'est la borne mathématique d'un arrondi au 5
 * centimes le plus proche, jamais un chiffre arbitraire.
 */

export const ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES = 2;

export interface ContexteVerificationArrondi {
  readonly moyenPaiement: MoyenPaiement;
  readonly arrondiEspecesActif: boolean;
  /** `abs(document.totalTtcCentimes)` — déjà en valeur absolue, calculé par l'appelant. */
  readonly totalDocumentCentimes: bigint;
  /** `document.montantRegleCentimes` AVANT ce lot d'imputations (verrouillé `for update`). */
  readonly montantRegleAvantCentimes: bigint;
  /** Somme des imputations `reglement` de CE lot, pour CE document. */
  readonly sommeReglementLotCentimes: bigint;
  /** Valeur soumise pour l'imputation `arrondi` — non nulle (déjà garanti par le schéma zod). */
  readonly arrondiCentimes: bigint;
}

/**
 * Lève une `ErreurMetier` si l'ajustement d'arrondi soumis ne respecte pas RF-49 → RF-52. Ne
 * rend rien (void) en cas de succès — la fonction est un garde-fou, pas un calcul.
 */
export function verifierArrondiEspeces(c: ContexteVerificationArrondi): void {
  if (c.moyenPaiement !== 'especes') {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      "L'arrondi au 5 centimes ne s'applique qu'à un encaissement en espèces (RF-49).",
      {
        erreurs: [
          {
            champ: 'imputations[].nature',
            code: 'arrondi_especes_uniquement',
            message: "Une imputation de nature 'arrondi' exige un paiement de moyen 'especes'.",
          },
        ],
      },
    );
  }

  if (!c.arrondiEspecesActif) {
    throw new ErreurMetier(
      'CONFLIT',
      "L'arrondi au 5 centimes est désactivé pour ce tenant (paramètre arrondi_especes_actif).",
    );
  }

  const magnitude = c.arrondiCentimes < 0n ? -c.arrondiCentimes : c.arrondiCentimes;
  if (magnitude > BigInt(ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES)) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      `L'écart d'arrondi soumis (${c.arrondiCentimes} ct) dépasse la borne d'un arrondi au 5 centimes (±${ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES} ct, RF-51).`,
      {
        erreurs: [
          {
            champ: 'imputations[].montantCentimes',
            code: 'arrondi_hors_borne',
            message: 'Écart d’arrondi hors de {-2,-1,+1,+2} centimes.',
          },
        ],
      },
    );
  }

  const montantRegleApres =
    c.montantRegleAvantCentimes + c.sommeReglementLotCentimes + c.arrondiCentimes;
  if (montantRegleApres !== c.totalDocumentCentimes) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      "L'arrondi ne s'applique qu'à l'encaissement qui SOLDE le document (RF-49) : le règlement et l'arrondi soumis ne ferment pas exactement le solde restant.",
      {
        erreurs: [
          {
            champ: 'imputations[].nature',
            code: 'arrondi_ne_solde_pas',
            message:
              'reglement + arrondi + montant déjà réglé doit être exactement égal au total du document.',
          },
        ],
      },
    );
  }
}
