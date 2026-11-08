import { lireContexte } from './contexte';
import type { Diagnostic } from './rapport';
import { lireAppelsEchoues, lireErreurs } from './tampon';

/**
 * Instantané du diagnostic joint à un signalement : contexte du poste + tampon des défauts.
 * `modules` : modules activés du garage (`[]` tant que la session n'en expose pas).
 */
export function collecterDiagnostic(nbSites: number, modules: readonly string[] = []): Diagnostic {
  return {
    ...lireContexte(),
    modules,
    nbSites,
    erreurs: lireErreurs(),
    appelsEchec: lireAppelsEchoues(),
  };
}
