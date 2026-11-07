import type { MemoireEtapes } from './memoire-etapes';

/** Contrat commun des étapes : l'assistant décide de la suite, l'étape enregistre ce qu'elle gère. */
export interface PropsEtape {
  readonly memoire: MemoireEtapes;
  /** Étape enregistrée (ou sans rien à enregistrer) : passer à la suivante. */
  readonly onSuivant: () => void;
  readonly onRetour?: (() => void) | undefined;
  /** Absent pour l'étape obligatoire. */
  readonly onPasser?: (() => void) | undefined;
}
