import { z } from 'zod';

/**
 * Modules activables d'un garage (Réglages > Modules, `GET|PATCH /parametres-modules`).
 *
 * Un garage retire ce qu'il n'utilise pas ; l'application masque alors les menus, routes, raccourcis
 * et cartes du module, et l'API refuse ses ÉCRITURES (`MODULE_DESACTIVE`, 403). Les lectures restent
 * possibles (historique, factures liées). Aucune donnée n'est supprimée : réactiver restaure tout.
 *
 * Le SOCLE (accueil, clients et véhicules, facturation, réglages) n'est pas listé ici : il ne se
 * désactive pas. Les valeurs sont celles de l'enum Postgres `module_app` (migration 0092) : en
 * ajouter une demande `ALTER TYPE module_app ADD VALUE`.
 */
export const MODULES_APP = [
  'atelier',
  'planning',
  'pointage',
  'tablettes',
  'pieces',
  'ventes',
  'pneus',
  'courtoisie',
  'relances',
  'export_fiduciaire',
] as const;
export type ModuleApp = (typeof MODULES_APP)[number];

/** Modules qui ne se désactivent jamais (information d'affichage ; pas des valeurs de l'enum). */
export const MODULES_SOCLE = ['accueil', 'clients_vehicules', 'facturation', 'reglages'] as const;
export type ModuleSocle = (typeof MODULES_SOCLE)[number];

/**
 * Dépendances DIRECTES : un module n'est actif que si tous ceux dont il dépend le sont. Pointage
 * s'appuie sur les ordres de réparation ; la tablette d'atelier est l'écran de pointage de l'atelier.
 * La dépendance est transitive (tablettes -> pointage -> atelier).
 */
export const DEPENDANCES_MODULES: Readonly<Record<ModuleApp, readonly ModuleApp[]>> = {
  atelier: [],
  planning: [],
  pointage: ['atelier'],
  tablettes: ['pointage'],
  pieces: [],
  ventes: [],
  pneus: [],
  courtoisie: [],
  relances: [],
  export_fiduciaire: [],
};

/** Modules dont `module` dépend, directement ou non (sans lui-même). */
export function dependancesDe(module: ModuleApp): readonly ModuleApp[] {
  const vus = new Set<ModuleApp>();
  const pile: ModuleApp[] = [...DEPENDANCES_MODULES[module]];
  while (pile.length > 0) {
    const m = pile.pop() as ModuleApp;
    if (vus.has(m)) continue;
    vus.add(m);
    pile.push(...DEPENDANCES_MODULES[m]);
  }
  return MODULES_APP.filter((m) => vus.has(m));
}

/** Modules qui cessent de fonctionner si `module` est retiré (directement ou non). */
export function dependantsDe(module: ModuleApp): readonly ModuleApp[] {
  return MODULES_APP.filter((m) => dependancesDe(m).includes(module));
}

/**
 * Modules EFFECTIVEMENT actifs, d'après la liste des modules désactivés par le garage : un module
 * dont une dépendance (même indirecte) est désactivée est inactif, sans que le choix du garage pour
 * lui-même soit écrasé (réactiver la dépendance le rétablit).
 */
export function modulesActifsDepuis(desactives: readonly ModuleApp[]): readonly ModuleApp[] {
  const retires = new Set<ModuleApp>(desactives);
  return MODULES_APP.filter(
    (m) => !retires.has(m) && dependancesDe(m).every((d) => !retires.has(d)),
  );
}

export function moduleEstActif(module: ModuleApp, desactives: readonly ModuleApp[]): boolean {
  return modulesActifsDepuis(desactives).includes(module);
}

/** Liste sans doublon, dans l'ordre de `MODULES_APP` (forme stockée et comparée). */
export function normaliserModulesDesactives(liste: readonly ModuleApp[]): readonly ModuleApp[] {
  return MODULES_APP.filter((m) => liste.includes(m));
}

/** `PATCH /parametres-entreprise/modules` : la liste COMPLÈTE des modules que le garage a retirés. */
export const schemaModificationModules = z.object({
  modulesDesactives: z.array(z.enum(MODULES_APP)).max(MODULES_APP.length),
});
export type EntreeModificationModules = z.infer<typeof schemaModificationModules>;

export interface ReponseModules {
  /** Choix du garage : modules retirés (peut inclure un module dont la dépendance l'est aussi). */
  readonly modulesDesactives: readonly ModuleApp[];
  /** Modules effectivement actifs (choix + dépendances). Ce que le front filtre. */
  readonly modulesActifs: readonly ModuleApp[];
}
