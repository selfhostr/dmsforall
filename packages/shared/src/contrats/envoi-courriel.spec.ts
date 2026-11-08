import { describe, expect, it } from 'vitest';

import {
  hoteSmtpValide,
  schemaModificationEnvoiCourriel,
  schemaTestEnvoiCourriel,
} from './envoi-courriel';

describe('hoteSmtpValide', () => {
  it.each(['mail.infomaniak.com', 'smtp-1.exemple.ch', '10.0.0.5', '::1', '2a00:1450::1'])(
    'accepte %s',
    (hote) => {
      expect(hoteSmtpValide(hote)).toBe(true);
    },
  );

  it.each(['smtp.exemple.ch:25', 'http://smtp.exemple.ch', 'smtp exemple.ch', 'a/b', '', 'x@y.ch'])(
    'refuse %j (port, schéma, espace ou chemin)',
    (hote) => {
      expect(hoteSmtpValide(hote)).toBe(false);
    },
  );
});

describe('schemaModificationEnvoiCourriel', () => {
  it('accepte un corps vide (rien ne change) et un réglage complet', () => {
    expect(schemaModificationEnvoiCourriel.safeParse({}).success).toBe(true);
    expect(
      schemaModificationEnvoiCourriel.safeParse({
        hote: 'mail.infomaniak.com',
        port: 587,
        securite: 'starttls',
        utilisateur: 'atelier@garage.ch',
        motDePasse: 'secret',
        adresseExpediteur: 'Atelier@Garage.ch',
        nomAffiche: 'Garage Martin',
        adresseReponse: null,
      }).data?.adresseExpediteur,
    ).toBe('atelier@garage.ch');
  });

  it('refuse port hors plage, sécurité inconnue, adresse invalide et mot de passe vide', () => {
    for (const corps of [
      { port: 0 },
      { port: 65536 },
      { port: 25.5 },
      { securite: 'ssl' },
      { adresseExpediteur: 'pas-une-adresse' },
      { motDePasse: '' },
    ]) {
      expect(schemaModificationEnvoiCourriel.safeParse(corps).success, JSON.stringify(corps)).toBe(
        false,
      );
    }
  });

  it('refuse un saut de ligne dans le nom affiché ou l’identifiant (injection d’en-tête)', () => {
    expect(
      schemaModificationEnvoiCourriel.safeParse({ nomAffiche: 'Garage\r\nBcc: x@y.ch' }).success,
    ).toBe(false);
    expect(schemaModificationEnvoiCourriel.safeParse({ utilisateur: 'a\nb' }).success).toBe(false);
  });

  it('null efface le mot de passe, l’identifiant, le nom affiché et l’adresse de réponse', () => {
    expect(
      schemaModificationEnvoiCourriel.safeParse({
        motDePasse: null,
        utilisateur: null,
        nomAffiche: null,
        adresseReponse: null,
      }).success,
    ).toBe(true);
  });
});

describe('schemaTestEnvoiCourriel', () => {
  it('exige une adresse valide', () => {
    expect(schemaTestEnvoiCourriel.safeParse({ destinataire: 'a@garage.ch' }).success).toBe(true);
    expect(schemaTestEnvoiCourriel.safeParse({ destinataire: 'nope' }).success).toBe(false);
    expect(schemaTestEnvoiCourriel.safeParse({}).success).toBe(false);
  });
});
