import { builtinEnvironments } from 'vitest/environments';

import type { Environment } from 'vitest/environments';

/**
 * Environnement de test = "jsdom", avec un correctif ciblé pour `AbortController`/`AbortSignal`.
 *
 * Cause du problème : jsdom fournit ses propres classes `AbortController`/`AbortSignal`
 * (implémentation JS interne, distincte de celle de Node) ; l'environnement "jsdom" natif de
 * Vitest les copie sur `globalThis`, masquant les classes Node. Or le `fetch` natif de Node
 * (utilisé par `src/api/client.ts`), une fois intercepté par MSW (qui pose un proxy sur
 * `Request` pour enregistrer les en-têtes bruts), valide `signal` avec un contrôle de type
 * strict côté Node : un `AbortSignal` jsdom échoue TOUJOURS ce contrôle, même construit
 * correctement (`AbortSignal.timeout(...)` ou `new AbortController().signal`). Résultat :
 * toute requête avec signal explicite part en erreur réseau sous jsdom, y compris via MSW —
 * indépendamment du endpoint ou du scénario testé.
 *
 * Ce fichier encapsule l'environnement "jsdom" standard de Vitest et restaure ensuite les
 * vraies classes Node pour `AbortController`/`AbortSignal`, seules concernées : tout le reste
 * du DOM simulé (rendu React, `screen`, événements, etc.) continue de venir de jsdom sans
 * changement de comportement.
 */
const jsdomAvecAbortNatif: Environment = {
  name: 'jsdom-avec-abort-natif',
  transformMode: 'web',
  async setup(global, options) {
    // Capturé AVANT que `builtinEnvironments.jsdom.setup` ne les remplace par les classes
    // jsdom : à ce stade `global` est encore le `globalThis` natif de Node.
    const AbortControllerNode: typeof AbortController = global.AbortController;
    const AbortSignalNode: typeof AbortSignal = global.AbortSignal;

    const resultat = await builtinEnvironments.jsdom.setup(global, options);

    global.AbortController = AbortControllerNode;
    global.AbortSignal = AbortSignalNode;

    return resultat;
  },
  async setupVM(options) {
    if (!builtinEnvironments.jsdom.setupVM) {
      throw new Error("L'environnement jsdom de Vitest ne supporte pas setupVM.");
    }
    // En mode VM, jsdom peuple un contexte séparé : le `globalThis` du processus courant
    // n'est lui jamais touché, on peut donc y piocher les vraies classes Node directement.
    const AbortControllerNode: typeof AbortController = globalThis.AbortController;
    const AbortSignalNode: typeof AbortSignal = globalThis.AbortSignal;

    const resultat = await builtinEnvironments.jsdom.setupVM(options);
    const contexte = resultat.getVmContext();
    contexte.AbortController = AbortControllerNode;
    contexte.AbortSignal = AbortSignalNode;

    return resultat;
  },
};

export default jsdomAvecAbortNatif;
