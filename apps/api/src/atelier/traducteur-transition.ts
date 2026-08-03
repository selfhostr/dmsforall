import type { ActionProposee, ElementBloquant } from '@dfa/shared';

import {
  interpreterErreurTransitionInterdite,
  type InterpretationTransitionInterdite,
} from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Construit l'`ErreurMetier` (OR_TRANSITION_INTERDITE / LIGNE_TRANSITION_INTERDITE) depuis le
 * SQLSTATE `ZDFA1` levé par `verifier_transition()`, DÉJÀ interprété par
 * `common/avertissements/interpreterErreurTransitionInterdite` (table, detail, hint) — cette
 * fonction ne réanalyse rien, elle choisit seulement le `CodeActionProposee` (décision MÉTIER
 * propre à `atelier`, expressément hors périmètre du traducteur commun, voir son en-tête).
 *
 * Rend `null` si `erreur` n'est pas un `ZDFA1` exploitable : l'appelant retombe alors sur son
 * traitement générique (relance l'erreur telle quelle).
 */
export function traduireErreurTransition(
  erreur: unknown,
  entiteId: string,
  libelle: string,
): ErreurMetier | null {
  const interpretation = interpreterErreurTransitionInterdite(erreur);
  if (!interpretation) return null;

  const blocages: readonly ElementBloquant[] = [
    {
      type: interpretation.entite === 'ligne_or' ? 'ligne_or' : 'ordre_reparation',
      id: entiteId,
      libelle,
      donnees: {
        statutActuel: interpretation.statutDepuis,
        statutDemande: interpretation.statutVers,
      },
    },
  ];

  return new ErreurMetier(
    interpretation.code,
    `Transition ${interpretation.statutDepuis} → ${interpretation.statutVers} interdite.`,
    {
      detail: `entite=${interpretation.entite};depuis=${interpretation.statutDepuis};vers=${interpretation.statutVers}`,
      blocages,
      actionsProposees: construireActionsProposees(interpretation, entiteId),
    },
  );
}

/**
 * §3.5 règle 3 : vide UNIQUEMENT sur un état terminal (aucune sortie n'existe). Sinon, au moins
 * `RAFRAICHIR` — le client a probablement agi sur une vue périmée (§9, `actionsProposees` sert
 * alors de filet générique quand aucune action plus spécifique n'est identifiable depuis le SEUL
 * contenu du SQLSTATE).
 *
 * Deux cas nommément couverts par contrats-api-etape-1.md §3.3 : `facture → en_cours` (I-02) et
 * toute tentative de transition depuis `restitue` (I-04). Les autres retombent sur `RAFRAICHIR`,
 * généralisation assumée du contrat (qui ne détaille que ces deux cas). Aucune action de type
 * `ligne_or` n'est nommée par le contrat pour `LIGNE_TRANSITION_INTERDITE` : `RAFRAICHIR` couvre
 * ce cas aussi.
 */
function construireActionsProposees(
  interpretation: InterpretationTransitionInterdite,
  entiteId: string,
): readonly ActionProposee[] {
  if (interpretation.estEtatTerminal) {
    return [];
  }

  if (
    interpretation.entite === 'ordre_reparation' &&
    interpretation.statutDepuis === 'facture' &&
    interpretation.statutVers === 'en_cours'
  ) {
    return [
      {
        code: 'CREER_OR_RETOUCHE',
        methode: 'POST',
        parametres: { ordreReparationParentId: entiteId },
      },
    ];
  }

  if (interpretation.entite === 'ordre_reparation' && interpretation.statutDepuis === 'restitue') {
    return [{ code: 'CREER_NOUVEL_OR' }];
  }

  return [{ code: 'RAFRAICHIR' }];
}
