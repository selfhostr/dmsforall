import type { TFunction } from 'i18next';

import { ErreurApi, messageErreur, messageErreurChamp } from '@/api/erreurs';

/**
 * Même correctif que `apps/web/src/ecrans/atelier/messages-erreur-mutation.ts` (issue #63),
 * appliqué aux dialogues de ce module — tous en état contrôlé (pas de `react-hook-form`, donc pas
 * d'ancrage par champ) : `messageErreur(erreur, t)` seul ne lit que `probleme.code` et retombe
 * systématiquement sur le générique `VALIDATION_ECHOUEE` dès qu'`erreursChamp` porte au moins une
 * entrée, même quand le serveur a rédigé un message précis (ex. « Quantité insuffisante sur le
 * site Genève », un mouvement de stock qui échoue sans que l'utilisateur sache pourquoi). Dès
 * qu'`erreursChamp` est non vide, on affiche CES messages au lieu du générique.
 */
export function messagesErreurMutation(erreur: unknown, t: TFunction): readonly string[] {
  if (erreur instanceof ErreurApi && erreur.erreursChamp.length > 0) {
    return erreur.erreursChamp.map((champErreur) => messageErreurChamp(champErreur, t));
  }
  return [messageErreur(erreur, t)];
}

/** Variante à chaîne unique — pour les emplacements (`<p role="alert">` isolé) qui n'affichent
 *  qu'un seul message plutôt qu'une liste. */
export function messageErreurMutation(erreur: unknown, t: TFunction): string {
  return messagesErreurMutation(erreur, t).join(' ');
}
