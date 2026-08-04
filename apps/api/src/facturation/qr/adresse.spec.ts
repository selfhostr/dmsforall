import { describe, expect, it } from 'vitest';

import {
  assainirChamp,
  blocAdresseVide,
  encoderBlocAdresse,
  evaluerCompletudeAdresse,
  CHAMPS_REQUIS_BLOC_CREANCIER,
  CHAMPS_REQUIS_BLOC_DEBITEUR,
  PAYS_PAR_DEFAUT,
  type AdresseStructuree,
} from './adresse';
import { ErreurQrFacture } from './erreurs-qr';
import { NOMBRE_CHAMPS_BLOC_ADRESSE } from './structure';

const COMPLETE: AdresseStructuree = {
  nom: 'Pia-Maria Rutschmann-Schnyder',
  rue: 'Grosse Marktgasse',
  numero: '28',
  npa: '9400',
  localite: 'Rorschach',
  pays: 'CH',
};

describe('blocAdresseVide', () => {
  it('rend 7 chaînes vides — le format d’un bloc omis ou réservé', () => {
    expect(blocAdresseVide()).toHaveLength(NOMBRE_CHAMPS_BLOC_ADRESSE);
    expect(blocAdresseVide()).toEqual(['', '', '', '', '', '', '']);
  });
});

describe('encoderBlocAdresse', () => {
  it('rend 7 champs dans l’ordre de la spécification', () => {
    expect(encoderBlocAdresse(COMPLETE, 'debiteur')).toEqual([
      'S',
      'Pia-Maria Rutschmann-Schnyder',
      'Grosse Marktgasse',
      '28',
      '9400',
      'Rorschach',
      'CH',
    ]);
  });

  it('normalise le pays en majuscules et applique CH par défaut', () => {
    expect(encoderBlocAdresse({ ...COMPLETE, pays: 'ch' }, 'debiteur')[6]).toBe('CH');
    const { pays: _pays, ...sansPays } = COMPLETE;
    expect(encoderBlocAdresse(sansPays, 'debiteur')[6]).toBe(PAYS_PAR_DEFAUT);
  });

  it('émet toujours 7 champs, même quand rue et numéro sont absents', () => {
    // Le décompte ne dépend jamais du contenu : c'est la position qui porte le sens.
    const bloc = encoderBlocAdresse({ nom: 'X', npa: '1000', localite: 'Lausanne' }, 'debiteur');
    expect(bloc).toHaveLength(NOMBRE_CHAMPS_BLOC_ADRESSE);
    expect(bloc).toEqual(['S', 'X', '', '', '1000', 'Lausanne', 'CH']);
  });
});

describe('evaluerCompletudeAdresse — la règle du comptoir (RF-59, RF-60)', () => {
  it('déclare complète une adresse qui a les cinq champs', () => {
    const evaluation = evaluerCompletudeAdresse(COMPLETE, CHAMPS_REQUIS_BLOC_DEBITEUR);
    expect(evaluation.complete).toBe(true);
    expect(evaluation.champsManquants).toEqual([]);
    expect(evaluation.partielle).toBe(false);
  });

  it('déclare partielle l’adresse du client de passage — nom seul', () => {
    const evaluation = evaluerCompletudeAdresse(
      { nom: 'Jean Dupont' },
      CHAMPS_REQUIS_BLOC_DEBITEUR,
    );
    expect(evaluation.complete).toBe(false);
    expect(evaluation.partielle).toBe(true);
    expect(evaluation.champsManquants).toEqual(['rue', 'numero', 'npa', 'localite']);
  });

  it('distingue « aucune adresse » de « adresse partielle »', () => {
    expect(evaluerCompletudeAdresse(null, CHAMPS_REQUIS_BLOC_DEBITEUR).partielle).toBe(false);
    expect(evaluerCompletudeAdresse(undefined, CHAMPS_REQUIS_BLOC_DEBITEUR).partielle).toBe(false);
  });

  it('traite une chaîne d’espaces comme un champ absent', () => {
    const evaluation = evaluerCompletudeAdresse(
      { ...COMPLETE, npa: '   ' },
      CHAMPS_REQUIS_BLOC_DEBITEUR,
    );
    expect(evaluation.complete).toBe(false);
    expect(evaluation.champsManquants).toEqual(['npa']);
  });

  it('exige le pays pour le créancier, mais pas pour le débiteur (CH par défaut)', () => {
    const { pays: _pays, ...sansPays } = COMPLETE;
    expect(evaluerCompletudeAdresse(sansPays, CHAMPS_REQUIS_BLOC_DEBITEUR).complete).toBe(true);
    // Le créancier lit `pays ?? 'CH'`, donc reste complet — le défaut vaut pour les deux blocs.
    expect(evaluerCompletudeAdresse(sansPays, CHAMPS_REQUIS_BLOC_CREANCIER).complete).toBe(true);
  });

  it('fige la règle RF-60, plus stricte que la spécification SIX', () => {
    // ⚠️ Divergence documentée en tête de `adresse.ts`. SIX se contenterait de
    // nom + NPA + localité + pays ; RF-60 exige en plus la rue et le numéro. Ce test existe
    // pour que le jour où l'on relâche la règle, ce soit un choix explicite et non un effet
    // de bord — il suffira de retirer 'rue' et 'numero' de la constante.
    expect([...CHAMPS_REQUIS_BLOC_DEBITEUR]).toEqual(['nom', 'rue', 'numero', 'npa', 'localite']);

    // Conséquence concrète : une case postale sans numéro de rue perd son bloc débiteur.
    const casePostale: AdresseStructuree = {
      nom: 'Jean Dupont',
      rue: 'Case postale',
      npa: '1963',
      localite: 'Vétroz',
    };
    expect(evaluerCompletudeAdresse(casePostale, CHAMPS_REQUIS_BLOC_DEBITEUR).complete).toBe(false);
    expect(evaluerCompletudeAdresse(casePostale, ['nom', 'npa', 'localite', 'pays']).complete).toBe(
      true,
    );
  });
});

describe('assainirChamp', () => {
  it('supprime les espaces de bord', () => {
    expect(assainirChamp('  Garage Martin SA  ', 'creancier.nom', 70)).toBe('Garage Martin SA');
  });

  it('refuse CR, LF et les caractères de contrôle', () => {
    for (const valeur of ['a\r\nb', 'a\nb', 'a\rb', 'a\u0000b', 'a\u0007b', 'a\u007Fb']) {
      expect(() => assainirChamp(valeur, 'debiteur.nom', 70)).toThrowError(ErreurQrFacture);
    }
  });

  it('accepte les accents et diacritiques usuels en Suisse', () => {
    expect(assainirChamp('Garage Frédéric Zünd Sàrl', 'creancier.nom', 70)).toBe(
      'Garage Frédéric Zünd Sàrl',
    );
    expect(assainirChamp('Vétroz', 'debiteur.localite', 35)).toBe('Vétroz');
  });

  it('refuse un dépassement de longueur', () => {
    expect(() => assainirChamp('x'.repeat(71), 'creancier.nom', 70)).toThrowError(ErreurQrFacture);
    expect(assainirChamp('x'.repeat(70), 'creancier.nom', 70)).toHaveLength(70);
  });

  it('nomme le champ fautif dans l’erreur', () => {
    try {
      assainirChamp('x'.repeat(36), 'debiteur.localite', 35);
      expect.unreachable('localité trop longue');
    } catch (erreur) {
      expect((erreur as ErreurQrFacture).champ).toBe('debiteur.localite');
      expect((erreur as ErreurQrFacture).code).toBe('CHAMP_TROP_LONG');
    }
  });
});
