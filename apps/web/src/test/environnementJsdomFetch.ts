import { builtinEnvironments } from 'vitest/environments';

import type { Environment } from 'vitest/environments';

/**
 * Environnement de test = "jsdom", avec deux correctifs ciblés : `AbortController`/`AbortSignal`,
 * et la stabilité de `MutationObserver` sur la durée du fichier de test.
 *
 * --- AbortController / AbortSignal ---
 *
 * jsdom fournit ses propres classes `AbortController`/`AbortSignal` (implémentation JS interne,
 * distincte de celle de Node) ; l'environnement "jsdom" natif de Vitest les copie sur
 * `globalThis`, masquant les classes Node. Or le `fetch` natif de Node (utilisé par
 * `src/api/client.ts`), une fois intercepté par MSW (qui pose un proxy sur `Request` pour
 * enregistrer les en-têtes bruts), valide `signal` avec un contrôle de type strict côté Node :
 * un `AbortSignal` jsdom échoue TOUJOURS ce contrôle, même construit correctement
 * (`AbortSignal.timeout(...)` ou `new AbortController().signal`). Résultat : toute requête avec
 * signal explicite part en erreur réseau sous jsdom, y compris via MSW — indépendamment du
 * endpoint ou du scénario testé.
 *
 * --- Stabilité de MutationObserver ---
 *
 * Diagnostiqué le 26.08.2026 sur la régression « MutationObserver is not a constructor » dans
 * `EcranFicheOrdreReparation.spec.tsx` (bouton « Ajouter un travail ou une pièce »). Mesures :
 * - jsdom 26.1.0 fournit nativement un `MutationObserver` correct (vérifié par instanciation
 *   directe hors Vitest) — ce n'est PAS une API absente de jsdom, contrairement à
 *   `ResizeObserver` (stub dans `src/test/setup.ts`) ou à `AbortController`/`AbortSignal` ci-dessus.
 * - Aucun code de ce dépôt ne touche `MutationObserver` (`grep -rn MutationObserver src` : rien).
 *   En particulier `next-themes` (0.4.6, utilisé par le nouveau `ThemeProvider`) n'y fait AUCUNE
 *   référence — vérifié dans son bundle publié (`dist/index.mjs`) : la piste initiale (« next-themes
 *   installe un MutationObserver ») est fausse. Deux dépendances légitimes du dépôt en posent un,
 *   mais sans rapport avec la pile d'erreur observée : `@radix-ui/react-focus-scope` (piège à focus
 *   de tout Dialog modal, y compris celui de ce test) et `@testing-library/dom` lui-même
 *   (`wait-for.js`, utilisé par CHAQUE `findBy*`/`waitFor` de la suite, pas seulement ce fichier).
 * - Le message exact (« MutationObserver is not a constructor », pas « is not defined ») pointe
 *   précisément vers `wait-for.js` : `const { MutationObserver } = getWindowFromNode(container)`
 *   puis `new MutationObserver(...)`. `populateGlobal` (vitest, `chunks/index.CmSc2RE5.js`) pose
 *   `MutationObserver` sur `global` comme un ACCESSEUR (get/set), pas une copie de valeur : le
 *   getter rend `win.MutationObserver` (jsdom) sauf si un override a été posé par affectation
 *   directe — et réécrit `document.defaultView` pour qu'il rende `global` lui-même, jamais
 *   `dom.window`. `getWindowFromNode(document)` lit donc CE `global`, pas une fenêtre séparée.
 * - Le test isolé, machine au repos : 25/25 passent, mais le test incriminé prend 14.72 s sur un
 *   budget (`testTimeout`, vitest.config.ts) de 15 s — 98 % du budget SANS aucune charge
 *   concurrente. Sous la charge réelle décrite (trois suites de `pnpm test` + agents en parallèle),
 *   ce test bascule le premier.
 * - `waitFor` (`@testing-library/dom`) enveloppe tout son corps dans
 *   `new Promise(async (resolve, reject) => {...})` : un throw synchrone AVANT le premier `await`
 *   dans cet exécuteur async ne rejette JAMAIS la Promise externe (bug connu du package) — il
 *   produit un rejet non rattrapé découplé, pendant que la Promise attendue par le test reste
 *   indéfiniment pending jusqu'au `testTimeout` de Vitest. C'est pour cela que le journal montre à
 *   la fois « Test timed out in 15000ms » ET un « Unhandled Rejection » MutationObserver
 *   apparemment sans rapport : c'est UN SEUL événement, pas deux.
 * - Le mécanisme exact qui vide `win.MutationObserver` sous charge réelle n'a pas pu être
 *   rejoué en isolation déterministe (charge concurrente interdite sur cette machine, voir
 *   consignes) : ce correctif referme le chemin identifié (l'accesseur `global`) sans prétendre
 *   avoir observé la corruption elle-même en train de se produire.
 *
 * Correctif : capturer la vraie classe jsdom UNE FOIS au `setup()`, puis la reposer en propriété
 * `writable: false` (non réassignable — ferme le chemin identifié) mais `configurable: true`.
 * PAS `configurable: false` : une première version le posait ainsi, et au démontage,
 * `populateGlobal`'s teardown (vitest) fait `keys.forEach(key => delete global[key])` — `delete`
 * sur une propriété non CONFIGURABLE lève en mode strict (`TypeError: Cannot delete property
 * 'MutationObserver'`), le worker sort en erreur, et `vitest run` rend un code de sortie non nul
 * MALGRÉ des tests verts (mesuré : `25 passed` + `exit 1`) — un vert qui sort en rouge, pire que
 * l'échec initial. `configurable: true` seul gouverne si `delete` réussit (`writable` ne gouverne
 * que l'affectation, jamais la suppression) : le démontage redevient possible, la propriété reste
 * non réassignable pendant toute la durée du fichier. Comportement de résolution par mutation DOM
 * inchangé (ni stub, ni polling dégradé) : la valeur posée est la vraie classe jsdom, pas un mock.
 */
function figerMutationObserver(cible: { MutationObserver?: unknown } | null | undefined): void {
  const MutationObserverJsdom = cible?.MutationObserver;
  if (!cible || typeof MutationObserverJsdom !== 'function') return;
  Object.defineProperty(cible, 'MutationObserver', {
    value: MutationObserverJsdom,
    writable: false,
    configurable: true,
    enumerable: true,
  });
}

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

    // `populateGlobal` (appelé par `builtinEnvironments.jsdom.setup` juste au-dessus) réécrit
    // `document.defaultView` pour qu'il rende `global` lui-même — c'est CE `global`, pas
    // `dom.window`, que lit `@testing-library/dom` à chaque `waitFor`/`findBy*` (voir commentaire
    // ci-dessus). Les deux appels ci-dessous visent donc en pratique le même objet ; les deux sont
    // posés par prudence plutôt que supposés identiques (mesuré, pas un raccourci de confiance).
    figerMutationObserver(global.document?.defaultView);
    figerMutationObserver(global as unknown as Window & typeof globalThis);

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

    figerMutationObserver(contexte.document?.defaultView);
    figerMutationObserver(contexte as unknown as Window & typeof globalThis);

    return resultat;
  },
};

export default jsdomAvecAbortNatif;
