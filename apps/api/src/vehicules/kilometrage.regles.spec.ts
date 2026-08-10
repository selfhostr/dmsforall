import { describe, expect, it } from 'vitest';
import { convertirEnKm, evaluerKilometrage } from './kilometrage.regles';

/**
 * Tests des règles pures de kilométrage (RM-23/24/25).
 *
 * CRITIQUE : `convertirEnKm` DOIT rester l'exacte réciproque de la colonne générée en base
 * (`migrations/0007_vehicules.sql` : `round(valeur * 1.609344)::integer`), sinon une valeur
 * applicative divergerait de la valeur persistée et briserait la comparaison de régression
 * (`VEHICULE_KILOMETRAGE_REGRESSIF` dans `service-transitions.ts`).
 *
 * La conversion mi→km est côté serveur (CT-08) : le client n'a aucune arithmétique à rejouer.
 */
describe('convertirEnKm', () => {
  it('retourne la valeur km inchangée si déjà en km', () => {
    expect(convertirEnKm(100, 'km')).toBe(100);
    expect(convertirEnKm(0, 'km')).toBe(0);
  });

  it('convertit correctement les miles en kilomètres', () => {
    // Cas simples : 1 mile ≈ 1.609344 km
    expect(convertirEnKm(1, 'mi')).toBe(2); // round(1 * 1.609344) = 2
    expect(convertirEnKm(10, 'mi')).toBe(16); // round(10 * 1.609344) = 16
    expect(convertirEnKm(100, 'mi')).toBe(161); // round(100 * 1.609344) = 161
  });

  it('produit la même valeur que la colonne générée à 250k miles (point critique)', () => {
    // À 250 000 miles, un facteur moins précis (1.60934 au lieu de 1.609344) produirait
    // 402 335 km au lieu de 402 336 km — une divergence d'1 km qui pouvait déclencher
    // `VEHICULE_KILOMETRAGE_REGRESSIF` à tort. Voir le commentaire dans `atelier/kilometrage.ts`.
    expect(convertirEnKm(250_000, 'mi')).toBe(402_336);

    // Vérification : 250 000 * 1.609344 = 402 336, round() = 402 336 ✓
    // Ancien facteur : 250 000 * 1.60934 = 402 335, round() = 402 335 ✗
  });
});

describe('evaluerKilometrage', () => {
  const maintenantMock = new Date('2026-01-15T12:00:00Z');
  const unJourAvant = new Date('2026-01-14T12:00:00Z');

  it('ne marque pas le premier relevé comme regressif ni aberrant', () => {
    const decision = evaluerKilometrage(100_000, null, maintenantMock);
    expect(decision.regressif).toBe(false);
    expect(decision.aberrant).toBe(false);
  });

  it('détecte un kilomètre regressif', () => {
    const dernier = { valeurKm: 100_000, releveLe: unJourAvant };
    const decision = evaluerKilometrage(99_999, dernier, maintenantMock);
    expect(decision.regressif).toBe(true);
    expect(decision.aberrant).toBe(false);
  });

  it('accepte une augmentation normale', () => {
    const dernier = { valeurKm: 100_000, releveLe: unJourAvant };
    const decision = evaluerKilometrage(100_100, dernier, maintenantMock);
    expect(decision.regressif).toBe(false);
    expect(decision.aberrant).toBe(false); // 100 km en 1 jour = normal (RM-25)
  });

  it('détecte un écart aberrant (RM-25 : > 100 000 km)', () => {
    const dernier = { valeurKm: 100_000, releveLe: unJourAvant };
    const decision = evaluerKilometrage(200_001, dernier, maintenantMock);
    expect(decision.regressif).toBe(false);
    expect(decision.aberrant).toBe(true);
  });

  it('détecte un écart moyen aberrant (RM-25 : > 500 km/jour)', () => {
    const dernier = { valeurKm: 100_000, releveLe: unJourAvant };
    // 501 km en 1 jour = 501 km/jour > 500 km/jour
    const decision = evaluerKilometrage(100_501, dernier, maintenantMock);
    expect(decision.regressif).toBe(false);
    expect(decision.aberrant).toBe(true);
  });

  it('ne marque jamais un relevé comme regressif ET aberrant', () => {
    const dernier = { valeurKm: 100_000, releveLe: unJourAvant };
    const decision = evaluerKilometrage(50_000, dernier, maintenantMock);
    // Regressif l'emporte : regressif=true, aberrant=false
    expect(decision.regressif).toBe(true);
    expect(decision.aberrant).toBe(false);
  });
});
