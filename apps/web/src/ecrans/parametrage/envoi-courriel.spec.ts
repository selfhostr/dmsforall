import { describe, expect, it } from 'vitest';

import type { ReglageEnvoiCourriel } from '@dfa/shared';

import {
  appliquerFournisseur,
  champsInvalides,
  estModifie,
  fournisseurDe,
  SAISIE_VIDE,
  saisieDepuisReglage,
  versEntree,
} from './envoi-courriel';

const REGLAGE: ReglageEnvoiCourriel = {
  hote: 'mail.infomaniak.com',
  port: 587,
  securite: 'starttls',
  utilisateur: 'atelier@garage-martin.ch',
  motDePasseDefini: true,
  adresseExpediteur: 'atelier@garage-martin.ch',
  nomAffiche: null,
  adresseReponse: null,
  dernierTest: null,
};

describe('préréglages de fournisseur', () => {
  it('Infomaniak remplit serveur, port et sécurité et laisse le reste', () => {
    const saisie = appliquerFournisseur(
      { ...SAISIE_VIDE, utilisateur: 'moi@garage.ch' },
      'infomaniak',
    );
    expect(saisie).toMatchObject({
      hote: 'mail.infomaniak.com',
      port: '587',
      securite: 'starttls',
      utilisateur: 'moi@garage.ch',
    });
  });

  it('Gmail et Microsoft 365 : STARTTLS sur 587', () => {
    expect(appliquerFournisseur(SAISIE_VIDE, 'google')).toMatchObject({
      hote: 'smtp.gmail.com',
      port: '587',
    });
    expect(appliquerFournisseur(SAISIE_VIDE, 'microsoft365')).toMatchObject({
      hote: 'smtp.office365.com',
      securite: 'starttls',
    });
  });

  it('« Autre » ne touche à rien', () => {
    const saisie = { ...SAISIE_VIDE, hote: 'smtp.perso.ch', port: '2525' };
    expect(appliquerFournisseur(saisie, 'autre')).toBe(saisie);
  });

  it('reconnaît le fournisseur d’un serveur enregistré, sinon « autre »', () => {
    expect(fournisseurDe('MAIL.infomaniak.com')).toBe('infomaniak');
    expect(fournisseurDe('smtp.perso.ch')).toBe('autre');
  });
});

describe('validation de la saisie', () => {
  const valide = { ...SAISIE_VIDE, hote: 'smtp.perso.ch', adresseExpediteur: 'a@garage.ch' };

  it('une saisie complète est valide', () => {
    expect(champsInvalides(valide)).toEqual([]);
  });

  it('signale serveur manquant, port hors plage et adresses mal formées', () => {
    expect(champsInvalides({ ...valide, hote: '' })).toEqual(['hote']);
    expect(champsInvalides({ ...valide, hote: 'https://smtp.perso.ch' })).toEqual(['hote']);
    expect(champsInvalides({ ...valide, port: '0' })).toEqual(['port']);
    expect(champsInvalides({ ...valide, port: '70000' })).toEqual(['port']);
    expect(champsInvalides({ ...valide, port: '58.7' })).toEqual(['port']);
    expect(champsInvalides({ ...valide, adresseExpediteur: 'pas-une-adresse' })).toEqual([
      'adresseExpediteur',
    ]);
    expect(champsInvalides({ ...valide, adresseReponse: 'x@' })).toEqual(['adresseReponse']);
  });

  it('l’adresse de réponse est facultative', () => {
    expect(champsInvalides({ ...valide, adresseReponse: '' })).toEqual([]);
  });
});

describe('corps du PATCH', () => {
  it('sans mot de passe retapé : le champ est ABSENT (inchangé), jamais vide', () => {
    const entree = versEntree(saisieDepuisReglage(REGLAGE));
    expect('motDePasse' in entree).toBe(false);
    expect(entree).toMatchObject({ hote: 'mail.infomaniak.com', port: 587, nomAffiche: null });
  });

  it('mot de passe retapé : joint tel quel, sans retrait d’espaces', () => {
    const entree = versEntree({ ...saisieDepuisReglage(REGLAGE), motDePasse: ' secret ' });
    expect(entree.motDePasse).toBe(' secret ');
  });

  it('identifiant vidé : null (serveur sans authentification)', () => {
    expect(
      versEntree({ ...saisieDepuisReglage(REGLAGE), utilisateur: ' ' }).utilisateur,
    ).toBeNull();
  });
});

describe('estModifie', () => {
  it('faux tant que rien ne change, vrai pour un champ ou un mot de passe retapé', () => {
    expect(estModifie(saisieDepuisReglage(REGLAGE), REGLAGE)).toBe(false);
    expect(estModifie({ ...saisieDepuisReglage(REGLAGE), port: '465' }, REGLAGE)).toBe(true);
    expect(estModifie({ ...saisieDepuisReglage(REGLAGE), motDePasse: 'x' }, REGLAGE)).toBe(true);
  });

  it('formulaire vierge sans réglage : non modifié', () => {
    expect(estModifie(SAISIE_VIDE, null)).toBe(false);
  });
});
