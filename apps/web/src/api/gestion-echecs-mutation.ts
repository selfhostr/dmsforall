import type { Mutation } from '@tanstack/react-query';

import { afficherToastFiletErreurMutation } from '@/composants/motifs/filet-erreur-mutation';
import i18n from '@/i18n';

/**
 * Filet de sécurité sur l'échec d'une mutation (issue #63) — branché sur `MutationCache.onError`
 * dans `App.tsx`. Garantit qu'un geste qui échoue produit TOUJOURS un retour visible, même quand
 * l'écran qui a déclenché la mutation n'a rien prévu.
 *
 * COMMENT ON DISTINGUE « l'écran a déjà parlé » DE « personne n'a rien dit », SANS qu'aucun écran
 * n'ait à changer quoi que ce soit :
 *
 * Piste écartée après mesure — `mutation.options.onError` (le rappel passé à `useMutation()`,
 * exposé par l'API `MutationCache`) : ce signal est FAUX dans ce dépôt. `useDemarrerPointage`
 * (apps/web/src/hooks/pointage/useDemarrerPointage.ts) définit un `onError` qui fait UNIQUEMENT le
 * rollback de la mise à jour optimiste (retire le pointage provisoire du cache) — il n'affiche
 * RIEN. L'écran, lui, affiche son message via un DEUXIÈME `onError`, passé à l'appel de
 * `mutate(vars, { onError })` plutôt qu'à la définition du hook (voir
 * `EcranPointageTechnicien.tsx`) — invisible depuis `MutationCache`, qui n'expose que les options
 * de définition du hook, jamais celles d'un appel `mutate()` particulier. Se fier à
 * `mutation.options.onError !== undefined` se serait donc tu PRÉCISÉMENT dans le cas où il fallait
 * parler.
 *
 * Signal retenu — le DOM, seul invariant réellement respecté partout dans ce dépôt : tout
 * affichage d'erreur existant passe soit par le composant partagé `Alert`
 * (`components/ui/alert.tsx`, `role="alert"` posé en dur, utilisé par `EtatErreur`,
 * `CartePointageEnCours`, `DialogueCloturePeriode`...), soit par un encart maison au même
 * patron (`RefusBloquant`, `BandeauAlerteClient`, ou un `<p role="alert">` ad hoc comme
 * `DialogueSortirDepotPneu`), soit par une marque `aria-invalid="true"` posée par
 * `react-hook-form` sur le champ fautif (`form.setError`, ex. `FormulaireNouveauClient`). On
 * compte ces indicateurs avant l'échec, on relaisse le rendu React se committer et le navigateur
 * peindre, puis on recompte : une hausse veut dire qu'un écran a réagi — le filet se tait. Sinon,
 * il parle.
 *
 * Limite assumée : un écran qui affiche son erreur SANS aucun de ces trois patrons (jamais observé
 * dans ce dépôt à ce jour) verrait le filet parler EN PLUS de lui — un doublon visible, jamais un
 * silence. C'est le compromis voulu : mieux vaut un message en trop qu'aucun.
 */
const SELECTEUR_INDICATEUR_ERREUR_AFFICHEE = '[role="alert"], [aria-invalid="true"]';

/** Deux `setTimeout(0)` enchaînés plutôt que `requestAnimationFrame` : `requestAnimationFrame`
 *  n'existe pas dans l'environnement de test (jsdom, voir `apps/web/vitest.config.ts`) et y
 *  lèverait `ReferenceError`. Deux ticks macrotâche laissent largement le temps à React de committer
 *  l'état déclenché par l'échec de la mutation (mise à jour React Query notifiée en microtâche,
 *  donc déjà vidée avant même le PREMIER tick) — cette suite de tests (`filet-erreur-mutation`,
 *  App-level) prouve empiriquement que c'est suffisant. */
function apresLaisserLeRenduSeCommitter(callback: () => void): void {
  setTimeout(() => setTimeout(callback, 0), 0);
}

interface MetaMutationAvecFilet {
  readonly filetErreurIgnore?: boolean;
}

/** Échappatoire explicite, à l'usage — aucun hook existant ne l'utilise aujourd'hui. Réservé à un
 *  futur cas où une mutation en arrière-plan doit rester silencieuse par conception (jamais un
 *  moyen de contourner le filet pour une action déclenchée par un geste utilisateur). */
function filetIgnorePourCetteMutation(mutation: Mutation<unknown, unknown, unknown>): boolean {
  const meta = mutation.meta as MetaMutationAvecFilet | undefined;
  return meta?.filetErreurIgnore === true;
}

/** Rappel `MutationCache.onError` de `App.tsx`. Ne fait jamais planter l'app : `mutation` reste
 *  utilisable même si `document` est indisponible (SSR — hors périmètre ici mais gardé simple). */
export function gererEchecMutationSansTraitement(
  erreur: unknown,
  mutation: Mutation<unknown, unknown, unknown>,
): void {
  if (filetIgnorePourCetteMutation(mutation)) return;
  if (typeof document === 'undefined') return;

  const nombreIndicateursAvant = document.querySelectorAll(
    SELECTEUR_INDICATEUR_ERREUR_AFFICHEE,
  ).length;

  apresLaisserLeRenduSeCommitter(() => {
    const nombreIndicateursApres = document.querySelectorAll(
      SELECTEUR_INDICATEUR_ERREUR_AFFICHEE,
    ).length;
    if (nombreIndicateursApres > nombreIndicateursAvant) return;
    afficherToastFiletErreurMutation(erreur, i18n.t);
  });
}
