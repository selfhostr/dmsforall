import type { Mutation } from '@tanstack/react-query';

import { afficherToastSucces } from '@/composants/motifs/toast-succes';
import i18n from '@/i18n';

/**
 * Déclaration d'un retour de succès par la mutation elle-même, via `meta` :
 *
 *   useMutation({ mutationFn, meta: { succes: 'commun:toasts.clientCree' } })
 *   useMutation({ mutationFn, meta: { succes: 'commun:toasts.orTermine', annuler: (donnees, variables) => … } })
 *
 * - `succes` : clé i18n (`namespace:cle`). SANS `succes`, rien n'est affiché (pas de bruit : une
 *   mutation de brouillon ou de rafraîchissement ne doit pas annoncer sa réussite).
 * - `annuler` : fonction appelée avec `(donnees, variables)` de la mutation réussie ; si elle est
 *   fournie, le toast affiche « Annuler » pendant 8 s. Elle doit rétablir l'état précédent
 *   (appel API inverse) et rejeter si elle échoue.
 * - `succesVariables` : valeurs ICU passées à la clé i18n (fonction de `(donnees, variables)`).
 *
 * Complément de `filetErreurIgnore` (échec) : voir `gestion-echecs-mutation.ts`.
 */
export interface MetaMutation extends Record<string, unknown> {
  readonly succes?: string;
  readonly annuler?: (donnees: never, variables: never) => unknown;
  readonly succesVariables?: (donnees: never, variables: never) => Record<string, unknown>;
  readonly filetErreurIgnore?: boolean;
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: MetaMutation;
  }
}

export function afficherToastSuccesMutation(
  donnees: unknown,
  variables: unknown,
  mutation: Mutation<unknown, unknown, unknown>,
): void {
  const meta = mutation.meta as MetaMutation | undefined;
  if (typeof meta?.succes !== 'string' || meta.succes === '') return;
  const annuler = meta.annuler as ((d: unknown, v: unknown) => unknown) | undefined;
  const valeurs = (
    meta.succesVariables as ((d: unknown, v: unknown) => Record<string, unknown>) | undefined
  )?.(donnees, variables);
  afficherToastSucces({
    message: i18n.t(meta.succes, valeurs),
    annuler: annuler ? () => annuler(donnees, variables) : undefined,
  });
}
