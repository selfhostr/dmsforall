import { describe, expect, it } from 'vitest';

import {
  DEPENDANCES_MODULES,
  MODULES_APP,
  MODULES_SOCLE,
  dependancesDe,
  dependantsDe,
  modulesActifsDepuis,
  normaliserModulesDesactives,
  schemaModificationModules,
} from './modules';

describe('modules activables', () => {
  it('le socle n’est jamais désactivable', () => {
    for (const s of MODULES_SOCLE) expect(MODULES_APP).not.toContain(s);
    expect(
      schemaModificationModules.safeParse({ modulesDesactives: ['facturation'] }).success,
    ).toBe(false);
  });

  it('aucune dépendance ne pointe vers un module inconnu ni vers lui-même (pas de cycle)', () => {
    for (const m of MODULES_APP) {
      for (const d of DEPENDANCES_MODULES[m]) expect(MODULES_APP).toContain(d);
      expect(dependancesDe(m)).not.toContain(m);
    }
  });

  it('dépendances transitives : tablettes -> pointage -> atelier', () => {
    expect(dependancesDe('tablettes')).toEqual(['atelier', 'pointage']);
    expect(dependantsDe('atelier')).toEqual(['pointage', 'tablettes']);
    expect(dependantsDe('pneus')).toEqual([]);
  });

  it('tout actif quand rien n’est désactivé', () => {
    expect(modulesActifsDepuis([])).toEqual(MODULES_APP);
  });

  it('désactiver atelier désactive pointage et tablettes, sans toucher au reste', () => {
    expect(modulesActifsDepuis(['atelier'])).toEqual(
      MODULES_APP.filter((m) => !['atelier', 'pointage', 'tablettes'].includes(m)),
    );
  });

  it('désactiver pointage garde atelier mais retire tablettes ; réactiver atelier restaure le choix', () => {
    expect(modulesActifsDepuis(['pointage'])).toContain('atelier');
    expect(modulesActifsDepuis(['pointage'])).not.toContain('tablettes');
    expect(modulesActifsDepuis(['atelier', 'pointage'])).not.toContain('pointage');
    expect(modulesActifsDepuis(['pointage'])).not.toContain('pointage');
  });

  it('normalise : sans doublon, dans l’ordre du contrat', () => {
    expect(normaliserModulesDesactives(['ventes', 'atelier', 'ventes'])).toEqual([
      'atelier',
      'ventes',
    ]);
  });

  it('refuse un module inconnu', () => {
    expect(schemaModificationModules.safeParse({ modulesDesactives: ['inconnu'] }).success).toBe(
      false,
    );
    expect(schemaModificationModules.safeParse({ modulesDesactives: [] }).success).toBe(true);
  });
});
