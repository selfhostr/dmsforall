import {
  DEPENDANCES_MODULES,
  MODULES_APP,
  dependancesDe,
  dependantsDe,
  modulesActifsDepuis,
  normaliserModulesDesactives,
  type ModuleApp,
} from '@dfa/shared';

/** État d'une ligne de la liste des modules (Réglages et assistant de démarrage). */
export interface LigneModule {
  readonly id: ModuleApp;
  /** Le module fonctionne réellement : choisi ET toutes ses dépendances actives. */
  readonly actif: boolean;
  /** Le choix du garage pour ce module, indépendamment de ses dépendances. */
  readonly choisi: boolean;
  /** Dépendances directes (« Nécessite : … »). */
  readonly necessite: readonly ModuleApp[];
  /** Dépendances retirées qui empêchent ce module de fonctionner (l'interrupteur est alors bloqué). */
  readonly bloquePar: readonly ModuleApp[];
  /** Modules qui s'arrêtent avec lui (« Retire aussi : … »), indirects compris. */
  readonly retireAussi: readonly ModuleApp[];
}

export function lignesModules(desactives: readonly ModuleApp[]): readonly LigneModule[] {
  const actifs = modulesActifsDepuis(desactives);
  return MODULES_APP.map((id) => ({
    id,
    actif: actifs.includes(id),
    choisi: !desactives.includes(id),
    necessite: DEPENDANCES_MODULES[id],
    bloquePar: dependancesDe(id).filter((d) => !actifs.includes(d)),
    retireAussi: dependantsDe(id),
  }));
}

/** Nouvelle liste de modules retirés après un clic sur l'interrupteur de `module`. */
export function basculerModule(
  desactives: readonly ModuleApp[],
  module: ModuleApp,
  actif: boolean,
): readonly ModuleApp[] {
  const sans = desactives.filter((m) => m !== module);
  return normaliserModulesDesactives(actif ? sans : [...sans, module]);
}
