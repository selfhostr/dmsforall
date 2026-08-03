import type { ActionProposee, ElementBloquant } from '@dfa/shared';

import { interpreterErreurTransitionInterdite } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Construit `POINTAGE_TRANSITION_INTERDITE` depuis le SQLSTATE `ZDFA1` levé par
 * `verifier_transition('pointage')` — MÊME PATRON que `atelier/traducteur-transition.ts`
 * (`OR_TRANSITION_INTERDITE`/`LIGNE_TRANSITION_INTERDITE`), copie locale volontaire (pas d'import
 * cross-module d'un fichier interne à `atelier/`, voir `references.ts`).
 *
 * Rend `null` si `erreur` n'est pas un `ZDFA1` exploitable sur l'entité `pointage` : l'appelant
 * retombe alors sur son traitement générique.
 */
export function traduireErreurTransitionPointage(
  erreur: unknown,
  pointageId: string,
): ErreurMetier | null {
  const interpretation = interpreterErreurTransitionInterdite(erreur);
  if (!interpretation || interpretation.entite !== 'pointage') return null;

  const blocages: readonly ElementBloquant[] = [
    {
      type: 'pointage',
      id: pointageId,
      libelle: pointageId,
      donnees: {
        statutActuel: interpretation.statutDepuis,
        statutDemande: interpretation.statutVers,
      },
    },
  ];

  const actionsProposees: readonly ActionProposee[] = interpretation.estEtatTerminal
    ? []
    : [{ code: 'RAFRAICHIR' }];

  return new ErreurMetier(
    'POINTAGE_TRANSITION_INTERDITE',
    `Transition ${interpretation.statutDepuis} → ${interpretation.statutVers} interdite sur le pointage.`,
    {
      detail: `entite=pointage;depuis=${interpretation.statutDepuis};vers=${interpretation.statutVers}`,
      blocages,
      actionsProposees,
    },
  );
}
