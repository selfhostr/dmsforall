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
      // `detail` = phrase de garagiste, affichable telle quelle. Les données machine (statuts bruts)
      // restent dans `blocages[].donnees` (`statutActuel` / `statutDemande`).
      detail: phraseTransitionInterdite(
        interpretation.entite,
        interpretation.statutDepuis,
        interpretation.statutVers,
        interpretation.estEtatTerminal ? 'terminal' : interpretation.transitionsPossibles,
      ),
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

const LIBELLES_STATUT_OR: Readonly<Record<string, string>> = {
  planifie: 'Planifié',
  ouvert: 'Ouvert',
  en_cours: 'En cours',
  controle: 'En contrôle',
  termine: 'Terminé',
  facture: 'Facturé',
  restitue: 'Restitué',
  cloture: 'Clôturé',
  annule: 'Annulé',
};

const LIBELLES_STATUT_LIGNE: Readonly<Record<string, string>> = {
  proposee: 'Proposée',
  a_valider: 'À valider',
  validee: 'Validée',
  en_cours: 'En cours',
  realisee: 'Réalisée',
  facturee: 'Facturée',
  refusee: 'Refusée',
  annulee: 'Annulée',
};

/** Libellé français d'un statut d'OR (`controle` -> `En contrôle`) ; statut inconnu rendu tel quel. */
export function libelleStatutOr(statut: string): string {
  return LIBELLES_STATUT_OR[statut] ?? statut;
}

/**
 * Phrase française d'une transition refusée, destinée à `detail` : « L'OR est « En contrôle » : il
 * ne peut pas passer à « Terminé ». Étapes possibles : « Facturé », « En cours ». ». Un statut
 * inconnu est rendu tel quel (jamais masqué). `possibles` : liste des statuts atteignables, ou
 * `'terminal'` quand plus aucune sortie n'existe.
 */
export function phraseTransitionInterdite(
  entite: string,
  depuis: string,
  vers: string,
  possibles: readonly string[] | 'terminal',
): string {
  const estLigne = entite === 'ligne_or';
  const libelles = estLigne ? LIBELLES_STATUT_LIGNE : LIBELLES_STATUT_OR;
  const nom = (statut: string): string => `« ${libelles[statut] ?? statut} »`;

  let phrase = estLigne
    ? `La ligne est ${nom(depuis)} : elle ne peut pas passer à ${nom(vers)}.`
    : `L'OR est ${nom(depuis)} : il ne peut pas passer à ${nom(vers)}.`;
  if (possibles === 'terminal') {
    phrase += estLigne
      ? " Cette ligne est définitive : plus aucune action n'est possible."
      : " Cet OR est définitif : plus aucune action n'est possible.";
  } else if (possibles.length > 0) {
    phrase += ` Étape${possibles.length > 1 ? 's' : ''} possible${possibles.length > 1 ? 's' : ''} : ${possibles.map(nom).join(', ')}.`;
  }
  return phrase;
}
