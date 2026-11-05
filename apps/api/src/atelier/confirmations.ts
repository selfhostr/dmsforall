import type { CodeConfirmation, RoleUtilisateur } from '@dfa/shared';

import { DROIT_PAR_CONFIRMATION, MATRICE_DROITS } from '../auth/matrice-droits';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Protocole en deux temps du contrat d'API (§4.4) :
 *  1. requête sans `confirmations` sur une condition confirmable ;
 *  2. si l'appelant A le droit associé (`DROIT_PAR_CONFIRMATION`) → `409 CONFIRMATION_REQUISE`
 *     + `confirmationsRequises: [code]` + `actionsProposees: [{ code: 'REJOUER_AVEC_CONFIRMATION' }]` ;
 *     sinon → `409 CONFIRMATION_REQUISE` SANS `confirmationsRequises` (l'appelant ne peut de toute
 *     façon pas la lever lui-même) + `actionsProposees: [{ code: 'DEMANDER_HABILITATION' }]`.
 *
 * AMBIGUÏTÉ DE CONTRAT SIGNALÉE : §4.4 évoque, pour le cas « non habilité », un « CodeErreur
 * SPÉCIFIQUE de la condition la plus bloquante » — mais aucun code dédié de ce genre (ex.
 * `CLIENT_BLOQUE` comme *erreur*, distinct de la *confirmation* homonyme) ne figure dans
 * `CODES_ERREUR` (`packages/shared/src/contrats/probleme.ts`, gelé par L1-01). `CONFIRMATION_REQUISE`
 * est donc réutilisé dans les deux branches — seuls `confirmationsRequises` et `actionsProposees`
 * distinguent « vous pouvez confirmer » de « demandez à un habilité ». À confirmer avec
 * le mainteneur / l'équipe API si un code dédié doit être ajouté à `CODES_ERREUR`.
 *
 * Ne fait RIEN (retourne normalement) si `code` figure déjà dans `confirmationsFournies` : c'est
 * le rejeu confirmé, la condition est acceptée et l'appelant continue son geste.
 */
export function verifierConfirmation(
  code: CodeConfirmation,
  role: RoleUtilisateur,
  confirmationsFournies: readonly CodeConfirmation[] | undefined,
): void {
  if (confirmationsFournies?.includes(code)) return;

  const droitRequis = DROIT_PAR_CONFIRMATION[code];
  const aLeDroit = (MATRICE_DROITS[role] ?? []).includes(droitRequis);

  if (aLeDroit) {
    throw new ErreurMetier(
      'CONFIRMATION_REQUISE',
      `Confirmation "${code}" requise avant de poursuivre.`,
      {
        confirmationsRequises: [code],
        actionsProposees: [{ code: 'REJOUER_AVEC_CONFIRMATION' }],
      },
    );
  }

  throw new ErreurMetier(
    'CONFIRMATION_REQUISE',
    `Confirmation "${code}" requise, hors de portée du rôle "${role}".`,
    { actionsProposees: [{ code: 'DEMANDER_HABILITATION' }] },
  );
}
