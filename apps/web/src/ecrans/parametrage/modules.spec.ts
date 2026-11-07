import { describe, expect, it } from 'vitest';

import { basculerModule, lignesModules } from './modules';

function ligne(desactives: Parameters<typeof lignesModules>[0], id: string) {
  const l = lignesModules(desactives).find((x) => x.id === id);
  if (!l) throw new Error(`module ${id} absent`);
  return l;
}

describe('lignesModules', () => {
  it('tout est actif par défaut', () => {
    expect(lignesModules([]).every((l) => l.actif && l.choisi && l.bloquePar.length === 0)).toBe(
      true,
    );
  });

  it('atelier annonce ce qu’il retire avec lui', () => {
    expect(ligne([], 'atelier').retireAussi).toEqual(['pointage', 'tablettes']);
    expect(ligne([], 'pointage').necessite).toEqual(['atelier']);
    expect(ligne([], 'pneus').retireAussi).toEqual([]);
  });

  it('atelier retiré : pointage et tablettes sont inactifs et bloqués, leur choix est conservé', () => {
    const pointage = ligne(['atelier'], 'pointage');
    expect(pointage.actif).toBe(false);
    expect(pointage.choisi).toBe(true);
    expect(pointage.bloquePar).toEqual(['atelier']);
    expect(ligne(['atelier'], 'tablettes').bloquePar).toEqual(['atelier', 'pointage']);
    expect(ligne(['atelier'], 'planning').actif).toBe(true);
  });
});

describe('basculerModule', () => {
  it('retire puis réactive un module', () => {
    const retire = basculerModule([], 'pneus', false);
    expect(retire).toEqual(['pneus']);
    expect(basculerModule(retire, 'pneus', true)).toEqual([]);
  });

  it('ne duplique pas et garde l’ordre du contrat', () => {
    expect(basculerModule(['ventes'], 'atelier', false)).toEqual(['atelier', 'ventes']);
    expect(basculerModule(['ventes'], 'ventes', false)).toEqual(['ventes']);
  });

  it('réactiver atelier ne touche pas au choix déjà fait sur pointage', () => {
    expect(basculerModule(['atelier', 'pointage'], 'atelier', true)).toEqual(['pointage']);
  });
});
