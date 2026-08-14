import type { Mutation } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';

import {
  obtenirToastsFiletErreurMutation,
  reinitialiserFiletErreurMutation,
} from '@/composants/motifs/filet-erreur-mutation';

import { gererEchecMutationSansTraitement } from './gestion-echecs-mutation';

/** `gererEchecMutationSansTraitement` ne lit que `mutation.meta` — un objet minimal suffit,
 *  jamais besoin de construire une vraie instance `Mutation` (lourde, interne à
 *  `@tanstack/query-core`). */
function mutationFactice(meta?: Record<string, unknown>): Mutation<unknown, unknown, unknown> {
  return { meta } as unknown as Mutation<unknown, unknown, unknown>;
}

/** Laisse les deux `setTimeout(0)` enchaînés de `gererEchecMutationSansTraitement` s'exécuter. */
async function attendreDecisionDuFilet() {
  await new Promise((resoudre) => setTimeout(resoudre, 20));
}

describe('gererEchecMutationSansTraitement (filet de sécurité, issue #63)', () => {
  afterEach(() => {
    reinitialiserFiletErreurMutation();
    document.body.innerHTML = '';
  });

  it("affiche le filet quand AUCUN indicateur d'erreur (role=alert / aria-invalid) n'apparaît", async () => {
    gererEchecMutationSansTraitement(new Error('échec réseau simulé'), mutationFactice());

    await attendreDecisionDuFilet();

    expect(obtenirToastsFiletErreurMutation()).toHaveLength(1);
  });

  it('se tait quand un écran a affiché un role="alert" avant que le filet ne tranche (patron RefusBloquant/EtatErreur/Alert)', async () => {
    gererEchecMutationSansTraitement(new Error('échec traité par l’écran'), mutationFactice());

    // Simule l'écran qui affiche son propre encart d'erreur pendant que le filet attend le
    // prochain rendu — exactement ce qui se passe dans `sortir.error ? <p role="alert">…` ou
    // `<Alert>` (`components/ui/alert.tsx`, `role="alert"` posé en dur).
    const alerte = document.createElement('p');
    alerte.setAttribute('role', 'alert');
    alerte.textContent = 'Message géré par l’écran.';
    document.body.appendChild(alerte);

    await attendreDecisionDuFilet();

    expect(obtenirToastsFiletErreurMutation()).toHaveLength(0);
  });

  it('se tait quand un champ de formulaire est marqué aria-invalid="true" (patron react-hook-form + form.setError, ex. FormulaireNouveauClient)', async () => {
    gererEchecMutationSansTraitement(
      new Error('validation refusée par le serveur'),
      mutationFactice(),
    );

    const champ = document.createElement('input');
    champ.setAttribute('aria-invalid', 'true');
    document.body.appendChild(champ);

    await attendreDecisionDuFilet();

    expect(obtenirToastsFiletErreurMutation()).toHaveLength(0);
  });

  it('ne se laisse pas tromper par une alerte DÉJÀ présente avant l’échec (compare un delta, pas une simple présence)', async () => {
    const alertePreexistante = document.createElement('div');
    alertePreexistante.setAttribute('role', 'alert');
    alertePreexistante.textContent = 'Alerte déjà affichée avant cette mutation.';
    document.body.appendChild(alertePreexistante);

    gererEchecMutationSansTraitement(new Error('nouvel échec, sans rapport'), mutationFactice());

    await attendreDecisionDuFilet();

    expect(obtenirToastsFiletErreurMutation()).toHaveLength(1);
  });

  it('meta.filetErreurIgnore = true désactive le filet pour cette mutation (échappatoire explicite)', async () => {
    gererEchecMutationSansTraitement(
      new Error('mutation en arrière-plan, silence volontaire'),
      mutationFactice({ filetErreurIgnore: true }),
    );

    await attendreDecisionDuFilet();

    expect(obtenirToastsFiletErreurMutation()).toHaveLength(0);
  });
});
