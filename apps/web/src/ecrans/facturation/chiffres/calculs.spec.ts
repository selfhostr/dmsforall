import { describe, expect, it } from 'vitest';

import { chargerToutesLesPages, PAGES_MAX } from './pages';
import { encaissementsParMoyen, resumerFacturesOuvertes, resumerOrTermines } from './calculs';

describe('encaissementsParMoyen', () => {
  it('regroupe par moyen, déduit les remboursements, trie du plus gros au plus petit', () => {
    const resultat = encaissementsParMoyen([
      { moyen: 'carte', montantCentimes: 10050 },
      { moyen: 'especes', montantCentimes: 20000 },
      { moyen: 'carte', montantCentimes: 5000 },
      { moyen: 'especes', montantCentimes: -2500 },
    ]);
    expect(resultat.parMoyen).toEqual(
      [
        { moyen: 'carte', centimes: 15050, nombre: 2 },
        { moyen: 'especes', centimes: 17500, nombre: 2 },
      ].sort((a, b) => b.centimes - a.centimes),
    );
    expect(resultat.totalCentimes).toBe(32550);
  });

  it('aucun paiement : total zéro, aucune ligne', () => {
    expect(encaissementsParMoyen([])).toEqual({ parMoyen: [], totalCentimes: 0 });
  });
});

describe('resumerFacturesOuvertes', () => {
  it('compte les ouvertes et la part en retard, soldes exacts', () => {
    expect(
      resumerFacturesOuvertes([
        { soldeCentimes: 12345, enRetard: true },
        { soldeCentimes: 5000, enRetard: false },
        { soldeCentimes: 100, enRetard: true },
        { soldeCentimes: 1 },
      ]),
    ).toEqual({
      nombreOuvertes: 4,
      soldeOuvertCentimes: 17446,
      nombreEnRetard: 2,
      soldeEnRetardCentimes: 12445,
    });
  });
});

describe('resumerOrTermines', () => {
  it('somme les TTC estimés', () => {
    expect(resumerOrTermines([{ totalTtcCentimes: 10000 }, { totalTtcCentimes: 2550 }])).toEqual({
      nombre: 2,
      estimeTtcCentimes: 12550,
    });
  });

  it('un montant masqué (rôle sans droit) : null, jamais un faux total', () => {
    expect(resumerOrTermines([{ totalTtcCentimes: 10000 }, {}])).toEqual({
      nombre: 2,
      estimeTtcCentimes: null,
    });
  });
});

describe('chargerToutesLesPages', () => {
  it('suit les curseurs jusqu’au bout', async () => {
    const pages = [
      { donnees: [1, 2], curseurSuivant: 'a', limite: 2 },
      { donnees: [3], curseurSuivant: null, limite: 2 },
    ];
    const appels: (string | undefined)[] = [];
    const resultat = await chargerToutesLesPages(async (curseur) => {
      appels.push(curseur);
      return pages[appels.length - 1]!;
    });
    expect(resultat).toEqual({ elements: [1, 2, 3], incomplet: false });
    expect(appels).toEqual([undefined, 'a']);
  });

  it('s’arrête au plafond et le signale', async () => {
    let appels = 0;
    const resultat = await chargerToutesLesPages(async () => {
      appels += 1;
      return { donnees: [appels], curseurSuivant: 'suite', limite: 1 };
    });
    expect(appels).toBe(PAGES_MAX);
    expect(resultat.incomplet).toBe(true);
    expect(resultat.elements).toHaveLength(PAGES_MAX);
  });
});
