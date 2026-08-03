import type { CodeErreur } from '@dfa/shared';

/**
 * Interprète le SQLSTATE `ZDFA1` (transition d'état interdite) levé par le trigger générique
 * `public.verifier_transition()` (voir `db/migrations/0003_prealables_etape1.sql` §6) — SANS
 * analyser le texte du message.
 *
 * Le trigger porte trois champs exploitables :
 *   - `table`  la table réelle (`ordre_reparation`, `ligne_or`…) → distingue
 *              `OR_TRANSITION_INTERDITE` de `LIGNE_TRANSITION_INTERDITE` sans lire `message` ;
 *   - `detail` `entite=<e>;depuis=<d>;vers=<v>`, sous forme parsable et stable ;
 *   - `hint`   soit « état terminal, aucune sortie », soit la liste des transitions RÉELLEMENT
 *              possibles depuis l'état de départ — la matière brute d'`actionsProposees`,
 *              obtenue sans requête supplémentaire.
 *
 * DÉLIBÉRÉMENT HORS PÉRIMÈTRE : le choix du `CodeActionProposee` final (ex. `hint` contient
 * « controle » ⇒ proposer `COMPLETER_CONTROLE_QUALITE` pour un OR) est une décision MÉTIER,
 * propre à chaque module consommateur (atelier connaît le sens de ses propres transitions ; ce
 * module commun ne le connaît pas et ne doit pas l'inventer). Cette fonction rend donc la liste
 * BRUTE des transitions possibles, pas des `ActionProposee` déjà construites.
 */

const SQLSTATE_TRANSITION_INTERDITE = 'ZDFA1';

/**
 * Convention produit : `<ENTITE>_TRANSITION_INTERDITE`. Seules les entités qui portent
 * effectivement une machine à états (chargée dans `transition_autorisee`) figurent ici — les
 * autres valeurs d'`entite_auditee` (`client`, `devis_complementaire`…) ne déclenchent jamais ce
 * trigger et n'ont donc pas de code homonyme. Extensible : `rendez_vous` et `pointage` sont
 * déclarés dans `CODES_ERREUR` (lot 1) bien que leurs tables n'existent pas encore — ajouter leur
 * entrée le jour où leur migration pose le trigger est un ajout d'une ligne, pas une réécriture.
 */
const TABLE_VERS_CODE_TRANSITION: Readonly<Record<string, CodeErreur>> = {
  ordre_reparation: 'OR_TRANSITION_INTERDITE',
  ligne_or: 'LIGNE_TRANSITION_INTERDITE',
  rendez_vous: 'RDV_TRANSITION_INTERDITE',
  pointage: 'POINTAGE_TRANSITION_INTERDITE',
};

/** Champs qu'un `DatabaseError` de `pg` porte réellement pour une erreur SQLSTATE personnalisée. */
interface ErreurPgBrute {
  readonly code?: unknown;
  readonly table?: unknown;
  readonly detail?: unknown;
  readonly hint?: unknown;
}

export interface InterpretationTransitionInterdite {
  readonly code: CodeErreur;
  readonly entite: string;
  readonly statutDepuis: string;
  readonly statutVers: string;
  /** `true` si l'état de départ est terminal : `hint` ne rapporte aucune sortie. */
  readonly estEtatTerminal: boolean;
  /** Transitions réellement possibles depuis l'état de départ, `[]` si terminal ou non parsable. */
  readonly transitionsPossibles: readonly string[];
}

// Les guillemets sont les chevrons français (« »), copiés à l'identique de la chaîne PL/pgSQL —
// voir `verifier_transition()`, 0003_prealables_etape1.sql §6.
const MOTIF_DETAIL = /^entite=([^;]+);depuis=([^;]+);vers=([^;]+)$/;
const MOTIF_HINT_TERMINAL = /^«[^»]*»\s+est un état terminal/;
const MOTIF_HINT_LISTE = /transitions autorisées\s*:\s*(.+?)\.?$/;

/**
 * Rend `null` si l'exception n'est pas un `ZDFA1` exploitable (mauvais SQLSTATE, `table` non
 * cartographiée, `detail` d'une forme inattendue) — l'appelant retombe alors sur son traitement
 * générique (`ERREUR_INTERNE`), jamais sur une supposition.
 */
export function interpreterErreurTransitionInterdite(
  erreur: unknown,
): InterpretationTransitionInterdite | null {
  if (typeof erreur !== 'object' || erreur === null) {
    return null;
  }
  const brute = erreur as ErreurPgBrute;

  if (brute.code !== SQLSTATE_TRANSITION_INTERDITE) {
    return null;
  }
  if (typeof brute.table !== 'string') {
    return null;
  }
  const code = TABLE_VERS_CODE_TRANSITION[brute.table];
  if (!code) {
    return null;
  }
  if (typeof brute.detail !== 'string') {
    return null;
  }

  const correspondance = MOTIF_DETAIL.exec(brute.detail);
  if (!correspondance) {
    return null;
  }
  const [, entite, statutDepuis, statutVers] = correspondance;
  if (!entite || !statutDepuis || !statutVers) {
    return null;
  }

  const hint = typeof brute.hint === 'string' ? brute.hint : null;
  const { estEtatTerminal, transitionsPossibles } = interpreterHint(hint);

  return { code, entite, statutDepuis, statutVers, estEtatTerminal, transitionsPossibles };
}

function interpreterHint(hint: string | null): {
  estEtatTerminal: boolean;
  transitionsPossibles: readonly string[];
} {
  if (hint === null) {
    return { estEtatTerminal: false, transitionsPossibles: [] };
  }
  if (MOTIF_HINT_TERMINAL.test(hint)) {
    return { estEtatTerminal: true, transitionsPossibles: [] };
  }

  const correspondance = MOTIF_HINT_LISTE.exec(hint);
  const liste = correspondance?.[1];
  if (!liste) {
    return { estEtatTerminal: false, transitionsPossibles: [] };
  }

  const transitions = liste
    .split(',')
    .map((valeur) => valeur.trim())
    .filter((valeur) => valeur.length > 0);
  return { estEtatTerminal: false, transitionsPossibles: transitions };
}
