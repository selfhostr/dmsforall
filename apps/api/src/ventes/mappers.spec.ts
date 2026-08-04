import { describe, expect, it } from 'vitest';

import {
  calculerActionsDisponiblesVehiculeStock,
  calculerEcartRepriseVehicule,
  calculerJoursStock,
} from './mappers';

/**
 * Cas limites de `mappers.ts` jugés les plus à risque pour cette livraison :
 *  - `calculerActionsDisponiblesVehiculeStock` — la matrice rôle × action pour `marquer_vendu`
 *    (trou n°2 comblé, voir `service-vehicule-stock.ts::marquerVendu`) : n'apparaît QUE depuis
 *    `reserve`, ET seulement pour un rôle qui détient `ventes.vehicule_stock.corriger` (`direction`,
 *    pas `vendeur`, `matrice-droits.ts`) — même garde que `remettre_disponible`, la correction
 *    exceptionnelle n'est pas un geste comptoir ;
 *  - `calculerEcartRepriseVehicule` — arithmétique argent (centimes, jamais de float) : positif
 *    (reprise gonflée, RV-20), négatif (RV-27), et `null` tant que non négociée ;
 *  - `calculerJoursStock` — dérivé depuis `dateEntreeStock`/`venduLe`, jamais négatif même sur une
 *    entrée du jour même.
 */
describe('calculerActionsDisponiblesVehiculeStock — marquer_vendu (trou n°2 comblé)', () => {
  it('`reserve` + rôle avec `ventes.vehicule_stock.corriger` (direction) : marquer_vendu ET remettre_disponible disponibles', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('reserve', 'direction');
    expect(actions).toContain('marquer_vendu');
    expect(actions).toContain('remettre_disponible');
  });

  it('`reserve` + rôle SANS `ventes.vehicule_stock.corriger` (vendeur) : ni marquer_vendu ni remettre_disponible', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('reserve', 'vendeur');
    expect(actions).not.toContain('marquer_vendu');
    expect(actions).not.toContain('remettre_disponible');
  });

  it('`vendu` : verrouillé, marquer_vendu ne réapparaît pas même pour direction (transition déjà consommée)', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('vendu', 'direction');
    expect(actions).toHaveLength(0);
  });

  it('`disponible` : marquer_vendu absent (transition `reserve -> vendu` uniquement, pas `disponible -> vendu`)', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('disponible', 'direction');
    expect(actions).not.toContain('marquer_vendu');
  });
});

describe('calculerEcartRepriseVehicule — RV-20/RV-21, argent en centimes, jamais de float', () => {
  it('`null` tant que non négociée', () => {
    expect(calculerEcartRepriseVehicule(800_000, null)).toBeNull();
  });

  it('positif : reprise gonflée (RV-20), remise déguisée sur le neuf', () => {
    expect(calculerEcartRepriseVehicule(800_000, 850_000)).toBe(50_000);
  });

  it('négatif : reprise revue à la baisse après expertise physique (RV-27)', () => {
    expect(calculerEcartRepriseVehicule(800_000, 720_000)).toBe(-80_000);
  });

  it('zéro : valeur négociée strictement égale à l’estimation', () => {
    expect(calculerEcartRepriseVehicule(800_000, 800_000)).toBe(0);
  });
});

describe('calculerJoursStock — RV-07, dérivé, jamais négatif', () => {
  it('toujours en stock (venduLe null) : jours écoulés jusqu’à `maintenant`', () => {
    const jours = calculerJoursStock('2026-07-01', null, new Date('2026-07-31T00:00:00.000Z'));
    expect(jours).toBe(30);
  });

  it('vendu : jours écoulés jusqu’à `venduLe`, PAS jusqu’à `maintenant` (un véhicule vendu il y a un mois ne vieillit plus au compteur)', () => {
    const jours = calculerJoursStock(
      '2026-07-01',
      new Date('2026-07-11T00:00:00.000Z'),
      new Date('2026-07-31T00:00:00.000Z'),
    );
    expect(jours).toBe(10);
  });

  it('entrée du jour même : 0, jamais négatif', () => {
    const jours = calculerJoursStock('2026-07-31', null, new Date('2026-07-31T08:00:00.000Z'));
    expect(jours).toBe(0);
  });
});
