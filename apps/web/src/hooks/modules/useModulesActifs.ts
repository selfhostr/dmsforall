import type { ModuleApp } from '@dfa/shared';

import { moduleActif } from '@/composants/layout/navigation-modele';
import { useSession } from '@/hooks/useSession';

export interface ModulesActifs {
  /** `undefined` tant que la session n'est pas connue : rien n'est masqué sur une information absente. */
  readonly modulesActifs: readonly ModuleApp[] | undefined;
  /** Le garage utilise-t-il ce module ? Toujours `true` pour un module inconnu de la session. */
  readonly estActif: (module: ModuleApp) => boolean;
}

/**
 * Modules que le garage utilise (Réglages > Modules), lus dans la session : AUCUNE requête de plus.
 * Pour masquer une carte, un bouton, une étape. Les menus et les routes passent par
 * `navigation-modele.ts`, qui lit la même liste.
 */
export function useModulesActifs(): ModulesActifs {
  const { data } = useSession();
  const modulesActifs = data?.modulesActifs;
  return {
    modulesActifs,
    estActif: (module) => moduleActif(module, modulesActifs),
  };
}
