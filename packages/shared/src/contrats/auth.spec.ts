import { describe, expect, it } from 'vitest';

import {
  LONGUEUR_MOT_DE_PASSE_MIN,
  schemaConfirmationReinitialisationMotDePasse,
  schemaConnexion,
  schemaDemandeReinitialisationMotDePasse,
  schemaMotDePasseNouveau,
} from './auth';

describe('schemaConnexion — jamais de politique de mot de passe divulguée à la connexion', () => {
  it("accepte un mot de passe d'UN SEUL caractère (min(1) volontaire, voir commentaire du schéma)", () => {
    const resultat = schemaConnexion.safeParse({ email: 'a@b.ch', motDePasse: 'x' });
    expect(resultat.success).toBe(true);
  });

  it('refuse un mot de passe vide', () => {
    const resultat = schemaConnexion.safeParse({ email: 'a@b.ch', motDePasse: '' });
    expect(resultat.success).toBe(false);
  });

  it('refuse un corps avec une clé inconnue (.strict())', () => {
    const resultat = schemaConnexion.safeParse({
      email: 'a@b.ch',
      motDePasse: 'x',
      tenantId: 'sneaky',
    });
    expect(resultat.success).toBe(false);
  });
});

describe('schemaMotDePasseNouveau — politique retenue : longueur seule, aucune composition imposée', () => {
  it(`refuse un mot de passe d'UN SEUL caractère (le trou embarrassant corrigé par cette tâche)`, () => {
    expect(schemaMotDePasseNouveau.safeParse('x').success).toBe(false);
  });

  it(`refuse tout mot de passe de moins de ${String(LONGUEUR_MOT_DE_PASSE_MIN)} caractères`, () => {
    const justEnDessous = 'a'.repeat(LONGUEUR_MOT_DE_PASSE_MIN - 1);
    expect(schemaMotDePasseNouveau.safeParse(justEnDessous).success).toBe(false);
  });

  it(`accepte un mot de passe d'exactement ${String(LONGUEUR_MOT_DE_PASSE_MIN)} caractères`, () => {
    const pile = 'a'.repeat(LONGUEUR_MOT_DE_PASSE_MIN);
    expect(schemaMotDePasseNouveau.safeParse(pile).success).toBe(true);
  });

  it('accepte un mot de passe long SANS aucune majuscule, chiffre ni symbole (pas de règle de composition)', () => {
    const phraseMinuscules = 'garageduvillagesion';
    expect(phraseMinuscules.length).toBeGreaterThanOrEqual(LONGUEUR_MOT_DE_PASSE_MIN);
    expect(schemaMotDePasseNouveau.safeParse(phraseMinuscules).success).toBe(true);
  });

  it('refuse un mot de passe de plus de 256 caractères', () => {
    const trop = 'a'.repeat(257);
    expect(schemaMotDePasseNouveau.safeParse(trop).success).toBe(false);
  });
});

describe('schemaDemandeReinitialisationMotDePasse', () => {
  it('accepte un email valide seul', () => {
    expect(
      schemaDemandeReinitialisationMotDePasse.safeParse({ email: 'garage@example.ch' }).success,
    ).toBe(true);
  });

  it('refuse un corps sans email', () => {
    expect(schemaDemandeReinitialisationMotDePasse.safeParse({}).success).toBe(false);
  });

  it('refuse une clé inconnue (.strict())', () => {
    expect(
      schemaDemandeReinitialisationMotDePasse.safeParse({
        email: 'garage@example.ch',
        tenantId: 'sneaky',
      }).success,
    ).toBe(false);
  });
});

describe('schemaConfirmationReinitialisationMotDePasse', () => {
  const VALIDE = {
    email: 'garage@example.ch',
    jeton: 'jeton-opaque-recu-par-courriel',
    nouveauMotDePasse: 'un-mot-de-passe-suffisamment-long',
  };

  it('accepte un corps valide', () => {
    expect(schemaConfirmationReinitialisationMotDePasse.safeParse(VALIDE).success).toBe(true);
  });

  it('refuse un nouveauMotDePasse trop court — la politique s’applique ICI, contrairement à la connexion', () => {
    const resultat = schemaConfirmationReinitialisationMotDePasse.safeParse({
      ...VALIDE,
      nouveauMotDePasse: 'court',
    });
    expect(resultat.success).toBe(false);
  });

  it('refuse un jeton vide', () => {
    const resultat = schemaConfirmationReinitialisationMotDePasse.safeParse({
      ...VALIDE,
      jeton: '',
    });
    expect(resultat.success).toBe(false);
  });

  it('refuse une clé inconnue (.strict())', () => {
    const resultat = schemaConfirmationReinitialisationMotDePasse.safeParse({
      ...VALIDE,
      tenantId: 'sneaky',
    });
    expect(resultat.success).toBe(false);
  });
});
