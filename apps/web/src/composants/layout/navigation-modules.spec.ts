import { describe, expect, it } from 'vitest';

import { MODULES_APP, modulesActifsDepuis, type ModuleApp } from '@dfa/shared';

import { actionsDuRole } from '@/test/session';

import {
  ENTREES_MENU,
  ENTREE_REGLAGES,
  TOUTES_ENTREES,
  cheminDansModuleRetire,
  entreesVisibles,
  moduleDeChemin,
  ongletsVisibles,
  sujetNavigation,
  vuesVisibles,
  type SujetNavigation,
} from './navigation-modele';

function sujet(desactives: readonly ModuleApp[]): SujetNavigation {
  return {
    role: 'direction',
    actions: actionsDuRole('direction'),
    modulesActifs: modulesActifsDepuis(desactives),
  };
}
const ids = (xs: readonly { readonly id: string }[]) => xs.map((x) => x.id);
function entree(id: string) {
  const trouvee = ENTREES_MENU.find((e) => e.id === id);
  if (!trouvee) throw new Error(`entrée ${id} absente`);
  return trouvee;
}

describe('navigation — modules activables', () => {
  it('tout actif : le menu est celui d’avant (aucun retrait)', () => {
    expect(ids(entreesVisibles(sujet([])))).toEqual(
      ids(entreesVisibles({ role: 'direction', actions: actionsDuRole('direction') })),
    );
    expect(ids(entreesVisibles(sujet([])))).toContain('ventes');
  });

  it('sans liste de modules (session pas connue) : rien n’est masqué', () => {
    const s = { role: 'direction', actions: actionsDuRole('direction') } as const;
    expect(sujetNavigation({ utilisateur: { role: 'direction' }, actions: s.actions })).toEqual(s);
    expect(ids(ongletsVisibles(entree('atelier'), s))).toContain('depotPneus');
  });

  it('ventes retiré : l’entrée Ventes disparaît du menu', () => {
    expect(ids(entreesVisibles(sujet(['ventes'])))).not.toContain('ventes');
  });

  it('pièces retiré : l’entrée Pièces disparaît, les réglages Pièces aussi', () => {
    const s = sujet(['pieces']);
    expect(ids(entreesVisibles(s))).not.toContain('pieces');
    expect(ids(ongletsVisibles(ENTREE_REGLAGES, s))).not.toContain('pieces');
  });

  it('pneus retiré : l’onglet Dépôt pneus disparaît, le reste d’Atelier demeure', () => {
    const onglets = ids(ongletsVisibles(entree('atelier'), sujet(['pneus'])));
    expect(onglets).not.toContain('depotPneus');
    expect(onglets).toContain('ordresReparation');
  });

  it('relances et export fiduciaire retirés : onglets de Facturation et réglage Rappels retirés', () => {
    const s = sujet(['relances', 'export_fiduciaire']);
    const onglets = ids(ongletsVisibles(entree('facturation'), s));
    expect(onglets).toContain('factures');
    expect(onglets).not.toContain('relances');
    expect(onglets).not.toContain('exportFiduciaire');
    expect(ids(ongletsVisibles(ENTREE_REGLAGES, s))).not.toContain('relances');
  });

  it('atelier retiré : OR, pointage et dépôt tablettes suivent (dépendances), planning et pneus restent', () => {
    const onglets = ids(ongletsVisibles(entree('atelier'), sujet(['atelier'])));
    expect(onglets).not.toContain('ordresReparation');
    expect(onglets).not.toContain('pointage');
    expect(onglets).toEqual(expect.arrayContaining(['rendezVous', 'courtoisie', 'depotPneus']));
  });

  it('tablettes retirées seules : la vue « Borne » du pointage disparaît, le pointage reste', () => {
    const s = sujet(['tablettes']);
    const pointage = entree('atelier').onglets.find((o) => o.id === 'pointage');
    if (!pointage) throw new Error('onglet pointage absent');
    expect(ids(vuesVisibles(pointage, s))).not.toContain('borne');
    expect(ids(vuesVisibles(pointage, s))).toContain('journal');
  });

  it('tous les modules retirés : seul le socle reste, Atelier et Ventes et Pièces disparaissent', () => {
    const s = sujet([...MODULES_APP]);
    const visibles = ids(entreesVisibles(s));
    expect(visibles).toEqual(['aujourdhui', 'clientsVehicules', 'facturation']);
    expect(ids(ongletsVisibles(ENTREE_REGLAGES, s))).toEqual(
      expect.arrayContaining(['facturation', 'utilisateurs', 'modules']),
    );
  });

  it('la liste des Réglages porte l’onglet Modules, jamais retirable', () => {
    const modules = ENTREE_REGLAGES.onglets.find((o) => o.id === 'modules');
    expect(modules).toBeDefined();
    expect(modules?.module).toBeUndefined();
  });

  it('chaque module du contrat est porté par au moins un onglet ou une vue du modèle', () => {
    const portes = new Set<ModuleApp>();
    for (const e of TOUTES_ENTREES)
      for (const o of e.onglets) {
        if (o.module) portes.add(o.module);
        for (const v of o.vues ?? []) if (v.module) portes.add(v.module);
      }
    expect([...portes].sort()).toEqual([...MODULES_APP].sort());
  });
});

describe('garde de route — module d’une URL', () => {
  it.each([
    ['/ordres-reparation', 'atelier'],
    ['/ordres-reparation/42', 'atelier'],
    ['/atelier/ordres-reparation/nouveau', 'atelier'],
    ['/rendez-vous', 'planning'],
    ['/courtoisie', 'courtoisie'],
    ['/pointage', 'pointage'],
    ['/pointage/equipe', 'pointage'],
    ['/pointage/borne', 'tablettes'],
    ['/pneus', 'pneus'],
    ['/pieces/articles/42', 'pieces'],
    ['/pieces/commandes-fournisseur', 'pieces'],
    ['/parametrage/pieces', 'pieces'],
    ['/relances', 'relances'],
    ['/parametrage/relances', 'relances'],
    ['/export-fiduciaire', 'export_fiduciaire'],
    ['/ventes/dossiers/42', 'ventes'],
    ['/ventes/stock', 'ventes'],
  ] as const)('%s appartient au module %s', (chemin, module) => {
    expect(moduleDeChemin(chemin)).toBe(module);
  });

  it.each([
    '/',
    '/tableau-bord',
    '/clients',
    '/vehicules/42',
    '/factures/42',
    '/parametrage/modules',
  ])('%s est du socle : jamais redirigé, même avec tout retiré', (chemin) => {
    expect(moduleDeChemin(chemin)).toBeUndefined();
    expect(cheminDansModuleRetire(chemin, [])).toBe(false);
  });

  it('redirige une route dont le module est retiré, laisse passer les autres', () => {
    const actifs = modulesActifsDepuis(['pneus', 'atelier']);
    expect(cheminDansModuleRetire('/pneus', actifs)).toBe(true);
    expect(cheminDansModuleRetire('/ordres-reparation/42', actifs)).toBe(true);
    expect(cheminDansModuleRetire('/pointage/jour', actifs)).toBe(true);
    expect(cheminDansModuleRetire('/pointage/borne', actifs)).toBe(true);
    expect(cheminDansModuleRetire('/rendez-vous', actifs)).toBe(false);
    expect(cheminDansModuleRetire('/pneus', undefined)).toBe(false);
  });
});
