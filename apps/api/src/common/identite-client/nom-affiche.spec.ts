import { describe, expect, it } from 'vitest';
import { calculerNomAffiche } from './nom-affiche';

describe('calculerNomAffiche', () => {
  describe('cas nominaux', () => {
    it('une entreprise affiche sa raison sociale', () => {
      expect(
        calculerNomAffiche({ type: 'entreprise', raisonSociale: 'Garage Martin SA', nom: null, prenom: null }),
      ).toBe('Garage Martin SA');
    });

    it('un particulier affiche "nom prénom"', () => {
      expect(
        calculerNomAffiche({ type: 'particulier', raisonSociale: null, nom: 'Dupont', prenom: 'Jean' }),
      ).toBe('Dupont Jean');
    });

    it('un particulier sans prénom affiche seulement le nom', () => {
      expect(
        calculerNomAffiche({ type: 'particulier', raisonSociale: null, nom: 'Dupont', prenom: null }),
      ).toBe('Dupont');
    });

    it('un particulier sans nom (donnée anormale) affiche seulement le prénom', () => {
      expect(
        calculerNomAffiche({ type: 'particulier', raisonSociale: null, nom: null, prenom: 'Jean' }),
      ).toBe('Jean');
    });

    it('un particulier sans aucun champ rend une chaîne vide, jamais une exception', () => {
      expect(
        calculerNomAffiche({ type: 'particulier', raisonSociale: null, nom: null, prenom: null }),
      ).toBe('');
    });
  });

  describe('RM-01 — le type fait autorité, jamais la présence d\'un champ (arbitrage @laupernoe, 28.07.2026)', () => {
    // `client_identite_chk` est un OR, pas un XOR (0006_clients.sql:55-58) : rien n'empêche en
    // base un `type='particulier'` avec `raisonSociale` renseignée aussi (legacy, import,
    // saisie erronée). L'ancienne implémentation de `clients/mappers.ts` branchait sur la
    // présence de `raisonSociale` et aurait ici rendu "Garage Martin SA" — un nom différent de
    // celui affiché par `vehicules/`/`recherche/` pour le même client. C'est le cas que ce test
    // fige désormais : NE PAS le "corriger" en réintroduisant le branchement sur la présence du
    // champ, ce serait recréer la divergence.
    it('un particulier avec une raisonSociale résiduelle affiche quand même "nom prénom"', () => {
      expect(
        calculerNomAffiche({
          type: 'particulier',
          raisonSociale: 'Garage Martin SA',
          nom: 'Dupont',
          prenom: 'Jean',
        }),
      ).toBe('Dupont Jean');
    });

    // Symétrique : une entreprise avec nom/prenom résiduels (même OR permissif) affiche quand
    // même sa raison sociale — `type` décide dans les deux sens.
    it('une entreprise avec un nom/prénom résiduel affiche quand même sa raison sociale', () => {
      expect(
        calculerNomAffiche({
          type: 'entreprise',
          raisonSociale: 'Garage Martin SA',
          nom: 'Dupont',
          prenom: 'Jean',
        }),
      ).toBe('Garage Martin SA');
    });
  });

  describe('espaces superflus — trimés, jamais une chaîne blanche traitée comme un nom (arbitrage @laupernoe, 28.07.2026)', () => {
    it('un nom et un prénom entourés d\'espaces sont trimés avant assemblage', () => {
      expect(
        calculerNomAffiche({ type: 'particulier', raisonSociale: null, nom: '  Dupont  ', prenom: '  Jean  ' }),
      ).toBe('Dupont Jean');
    });

    it('un nom composé uniquement d\'espaces est traité comme absent, pas comme un espace parasite', () => {
      expect(
        calculerNomAffiche({ type: 'particulier', raisonSociale: null, nom: '   ', prenom: 'Jean' }),
      ).toBe('Jean');
    });

    it('un prénom composé uniquement d\'espaces est traité comme absent', () => {
      expect(
        calculerNomAffiche({ type: 'particulier', raisonSociale: null, nom: 'Jean', prenom: '   ' }),
      ).toBe('Jean');
    });

    it('une raison sociale entourée d\'espaces est trimée', () => {
      expect(
        calculerNomAffiche({ type: 'entreprise', raisonSociale: '  Garage Martin SA  ', nom: null, prenom: null }),
      ).toBe('Garage Martin SA');
    });
  });

  describe('champ d\'autorité vide ou blanc — cas signalé à @laupernoe, non résolu ici', () => {
    // Atteignable en base (`client_identite_chk` exige `is not null`, pas une chaîne non vide),
    // mais PAS atteignable via `POST`/`PATCH /clients` : `schemaTexteCourt` = `z.string().trim().min(1)`
    // rejette une valeur blanche avant la base. Seul un contournement de la validation API
    // (import, correctif SQL direct) peut produire ce cas. Pas de repli choisi ici : voir le
        // commentaire de `calculerNomAffiche`.
    it('une entreprise avec raisonSociale = "" rend une chaîne vide', () => {
      expect(calculerNomAffiche({ type: 'entreprise', raisonSociale: '', nom: null, prenom: null })).toBe('');
    });

    it('une entreprise avec raisonSociale blanche rend une chaîne vide', () => {
      expect(calculerNomAffiche({ type: 'entreprise', raisonSociale: '   ', nom: null, prenom: null })).toBe('');
    });
  });
});
