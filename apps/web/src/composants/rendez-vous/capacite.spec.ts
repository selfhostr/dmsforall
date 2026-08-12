import { describe, expect, it } from 'vitest';

import { classerCapaciteJour, formaterDureeCourte } from './capacite';

describe('classerCapaciteJour', () => {
  it('rend non_definie quand la capacité est null, quel que soit le nombre de minutes occupées', () => {
    expect(classerCapaciteJour(0, null)).toBe('non_definie');
    expect(classerCapaciteJour(120, null)).toBe('non_definie');
    // Zéro occupé + capacité inconnue ne doit JAMAIS se lire "disponible" : absence de donnée
    // ≠ valeur (CONTRIBUTING.md). Prouvé en exécution par le coordinateur sur un site non paramétré.
  });

  it('rend complet quand les minutes occupées atteignent ou dépassent la capacité (surbooking inclus)', () => {
    expect(classerCapaciteJour(480, 480)).toBe('complet');
    expect(classerCapaciteJour(510, 480)).toBe('complet');
  });

  it('rend complet pour une capacité configurée à zéro', () => {
    expect(classerCapaciteJour(0, 0)).toBe('complet');
  });

  it('rend presque_complet quand la marge restante est au plus le seuil (30 min)', () => {
    expect(classerCapaciteJour(450, 480)).toBe('presque_complet');
    expect(classerCapaciteJour(460, 480)).toBe('presque_complet');
  });

  it('rend disponible au-delà du seuil', () => {
    expect(classerCapaciteJour(400, 480)).toBe('disponible');
    expect(classerCapaciteJour(0, 480)).toBe('disponible');
  });
});

describe('formaterDureeCourte', () => {
  it('formate des minutes en heures/minutes lisibles', () => {
    expect(formaterDureeCourte(270)).toBe('4h30');
    expect(formaterDureeCourte(480)).toBe('8h00');
    expect(formaterDureeCourte(15)).toBe('0h15');
    expect(formaterDureeCourte(0)).toBe('0h00');
  });
});
