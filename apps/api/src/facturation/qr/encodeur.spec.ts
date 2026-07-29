import { describe, expect, it } from 'vitest';

import type { AdresseStructuree } from './adresse';
import {
  decouperChargeUtileQr,
  encoderChargeUtileQr,
  type DonneesQrFacture,
} from './encodeur';
import { ErreurQrFacture } from './erreurs-qr';
import {
  LONGUEUR_MAX_PAYLOAD,
  NOMBRE_CHAMPS_BLOC_ADRESSE,
  NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION,
  NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES,
  NOMBRE_ELEMENTS_JUSQU_A_EPD,
  SEPARATEUR_LIGNE_PAYLOAD,
} from './structure';

const QR_IBAN = 'CH4431999123000889012';
const IBAN_ORDINAIRE = 'CH9300762011623852957';
const QRR = '210000000003139471430009017';
const SCOR = 'RF18539007547034';

/** Le garage : bloc créancier complet, comme il doit l'être pour émettre (RF-54). */
const GARAGE: AdresseStructuree = {
  nom: 'Garage Martin SA',
  rue: 'Route de Berne',
  numero: '42',
  npa: '1010',
  localite: 'Lausanne',
  pays: 'CH',
};

/** Un client dont la fiche est complète. */
const CLIENT_COMPLET: AdresseStructuree = {
  nom: 'Pia-Maria Rutschmann-Schnyder',
  rue: 'Grosse Marktgasse',
  numero: '28',
  npa: '9400',
  localite: 'Rorschach',
  pays: 'CH',
};

/**
 * `CF-21` : le client de passage, dont la fiche n'a qu'un nom et un téléphone. Cas fréquent au
 * comptoir et parfaitement légitime.
 */
const CLIENT_DE_PASSAGE: AdresseStructuree = { nom: 'Jean Dupont' };

/** Facture `CF-01` : CHF 566.60. */
const FACTURE_CF01: DonneesQrFacture = {
  ibanCreancier: QR_IBAN,
  creancier: GARAGE,
  montantCentimes: 56_660,
  devise: 'CHF',
  reference: QRR,
  messageNonStructure: 'Facture 2026-00424',
};

const elementsDe = (donnees: DonneesQrFacture): readonly string[] =>
  encoderChargeUtileQr(donnees).elements;

describe('CF-21 — QR au comptoir sans adresse de débiteur', () => {
  const resultat = encoderChargeUtileQr({ ...FACTURE_CF01, debiteur: CLIENT_DE_PASSAGE });

  it('produit exactement 31 éléments jusqu’à EPD inclus', () => {
    // ⚠️ Le garde-fou du décalage d'un champ. Un résultat à 30 ou 32 signale qu'un champ a été
    // ajouté ou perdu, que tout ce qui suit est décalé, et que le QR est illisible par les
    // banques. Ne « corriger » ce test qu'après avoir tranché contre la spécification SIX.
    expect(resultat.nombreElements).toBe(31);
    expect(resultat.nombreElements).toBe(NOMBRE_ELEMENTS_JUSQU_A_EPD);
    expect(resultat.elements).toHaveLength(31);
  });

  it('place EPD en 31e et dernière position', () => {
    expect(resultat.elements[30]).toBe('EPD');
    expect(resultat.elements.at(-1)).toBe('EPD');
  });

  it('émet 7 champs vides pour le bloc Ultimate Creditor — pas 6', () => {
    // Le point contesté par le modèle documentaire. Positions 12 à 18 (index 11 à 17).
    const ultimateCreditor = resultat.elements.slice(11, 11 + NOMBRE_CHAMPS_BLOC_ADRESSE);

    expect(ultimateCreditor).toHaveLength(7);
    expect(ultimateCreditor).toEqual(['', '', '', '', '', '', '']);
    // Le champ juste après doit être le montant : si l'Ultimate Creditor n'avait que 6 champs,
    // on lirait ici une chaîne vide, et la banque lirait le montant comme une devise.
    expect(resultat.elements[18]).toBe('566.60');
    expect(resultat.elements[19]).toBe('CHF');
  });

  it('omet le bloc débiteur EN ENTIER — pas même le nom (RF-59)', () => {
    const debiteur = resultat.elements.slice(20, 20 + NOMBRE_CHAMPS_BLOC_ADRESSE);

    expect(debiteur).toHaveLength(7);
    expect(debiteur).toEqual(['', '', '', '', '', '', '']);
    expect(debiteur).not.toContain('Jean Dupont');
    expect(resultat.payload).not.toContain('Jean Dupont');
    expect(resultat.blocDebiteurEmis).toBe(false);
  });

  it('refuse la variante fautive « nom rempli, adresse vide » plutôt que de l’émettre', () => {
    // C'est la variante qui produirait une charge utile invalide, refusée par la banque : le
    // bloc partiel n'entre JAMAIS dans le payload.
    const partiels: AdresseStructuree[] = [
      { nom: 'Jean Dupont' },
      { nom: 'Jean Dupont', localite: 'Lausanne' },
      { nom: 'Jean Dupont', npa: '1010', localite: 'Lausanne' },
      { nom: 'Jean Dupont', rue: 'Route de Berne', npa: '1010', localite: 'Lausanne' },
      { ...CLIENT_COMPLET, npa: '' },
      { ...CLIENT_COMPLET, nom: '   ' },
    ];

    for (const debiteur of partiels) {
      const partiel = encoderChargeUtileQr({ ...FACTURE_CF01, debiteur });
      expect(partiel.blocDebiteurEmis).toBe(false);
      expect(partiel.elements.slice(20, 27)).toEqual(['', '', '', '', '', '', '']);
      expect(partiel.nombreElements).toBe(31);
    }
  });

  it('avertit sans bloquer, en nommant les champs manquants (RF-61)', () => {
    expect(resultat.avertissements).toEqual([
      {
        code: 'BLOC_DEBITEUR_OMIS_ADRESSE_INCOMPLETE',
        champsManquants: ['rue', 'numero', 'npa', 'localite'],
      },
    ]);
  });

  it('distingue « pas de débiteur du tout » de « débiteur incomplet »', () => {
    const sansDebiteur = encoderChargeUtileQr(FACTURE_CF01);
    expect(sansDebiteur.avertissements[0]?.code).toBe('BLOC_DEBITEUR_ABSENT');
    expect(sansDebiteur.nombreElements).toBe(31);
  });

  it('compte 30 séparateurs CR+LF et une charge utile sous 997 caractères', () => {
    const separateurs = resultat.payload.split(SEPARATEUR_LIGNE_PAYLOAD).length - 1;
    expect(separateurs).toBe(30);
    expect(resultat.payload.length).toBeLessThanOrEqual(LONGUEUR_MAX_PAYLOAD);
  });

  it('n’utilise que CR+LF comme séparateur, jamais LF seul', () => {
    expect(resultat.payload).not.toMatch(/(?<!\r)\n/);
    expect(decouperChargeUtileQr(resultat.payload)).toEqual([...resultat.elements]);
  });

  it('rend la charge utile complète, élément par élément', () => {
    expect([...resultat.elements]).toEqual([
      'SPC',
      '0200',
      '1',
      'CH4431999123000889012',
      'S',
      'Garage Martin SA',
      'Route de Berne',
      '42',
      '1010',
      'Lausanne',
      'CH',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '566.60',
      'CHF',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'QRR',
      '210000000003139471430009017',
      'Facture 2026-00424',
      'EPD',
    ]);
  });
});

describe('la même facture avec une adresse complète', () => {
  const resultat = encoderChargeUtileQr({ ...FACTURE_CF01, debiteur: CLIENT_COMPLET });

  it('produit 7 champs remplis et une charge utile toujours à 31 éléments', () => {
    expect(resultat.blocDebiteurEmis).toBe(true);
    expect(resultat.avertissements).toEqual([]);
    expect(resultat.nombreElements).toBe(31);
    expect(resultat.elements.slice(20, 27)).toEqual([
      'S',
      'Pia-Maria Rutschmann-Schnyder',
      'Grosse Marktgasse',
      '28',
      '9400',
      'Rorschach',
      'CH',
    ]);
  });

  it('applique CH par défaut quand le pays n’est pas fourni', () => {
    const { pays: _pays, ...sansPays } = CLIENT_COMPLET;
    const sortie = encoderChargeUtileQr({ ...FACTURE_CF01, debiteur: sansPays });
    expect(sortie.blocDebiteurEmis).toBe(true);
    expect(sortie.elements[26]).toBe('CH');
  });
});

describe('bloc créancier', () => {
  it('bloque l’émission si le créancier est incomplet (RF-54)', () => {
    const { rue: _rue, ...garageSansRue } = GARAGE;

    try {
      encoderChargeUtileQr({ ...FACTURE_CF01, creancier: garageSansRue });
      expect.unreachable('un créancier incomplet doit bloquer l’émission');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurQrFacture);
      expect((erreur as ErreurQrFacture).code).toBe('CREANCIER_INCOMPLET');
      expect((erreur as ErreurQrFacture).message).toContain('rue');
    }
  });

  it('nomme tous les champs manquants, pas seulement le premier', () => {
    try {
      encoderChargeUtileQr({ ...FACTURE_CF01, creancier: { nom: 'Garage Martin SA' } });
      expect.unreachable('créancier incomplet');
    } catch (erreur) {
      const message = (erreur as ErreurQrFacture).message;
      for (const champ of ['rue', 'numero', 'npa', 'localite']) {
        expect(message).toContain(champ);
      }
    }
  });
});

describe('montant et devise', () => {
  it('encode le montant en centimes vers « 566.60 »', () => {
    expect(elementsDe(FACTURE_CF01)[18]).toBe('566.60');
  });

  it('laisse le champ montant vide pour un QR sans montant (RF-57)', () => {
    const sansMontant = encoderChargeUtileQr({ ...FACTURE_CF01, montantCentimes: null });
    expect(sansMontant.elements[18]).toBe('');
    expect(sansMontant.elements[19]).toBe('CHF');
    expect(sansMontant.nombreElements).toBe(31);
  });

  it('refuse une devise hors CHF/EUR (RF-58)', () => {
    expect(() => encoderChargeUtileQr({ ...FACTURE_CF01, devise: 'USD' })).toThrowError(
      ErreurQrFacture,
    );
  });
});

describe('référence', () => {
  it('IBAN ordinaire + SCOR → type SCOR, toujours 31 éléments', () => {
    const resultat = encoderChargeUtileQr({
      ...FACTURE_CF01,
      ibanCreancier: IBAN_ORDINAIRE,
      reference: SCOR,
    });

    expect(resultat.typeReference).toBe('SCOR');
    expect(resultat.elements[27]).toBe('SCOR');
    expect(resultat.elements[28]).toBe(SCOR);
    expect(resultat.nombreElements).toBe(31);
  });

  it('IBAN ordinaire sans référence → NON, champ référence vide', () => {
    const resultat = encoderChargeUtileQr({
      ...FACTURE_CF01,
      ibanCreancier: IBAN_ORDINAIRE,
      reference: null,
    });

    expect(resultat.typeReference).toBe('NON');
    expect(resultat.elements[27]).toBe('NON');
    expect(resultat.elements[28]).toBe('');
    expect(resultat.nombreElements).toBe(31);
  });
});

describe('éléments facultatifs de queue', () => {
  it('32 éléments avec l’information de facturation Swico', () => {
    const resultat = encoderChargeUtileQr({
      ...FACTURE_CF01,
      informationFacturation: '//S1/10/2026-00424/11/260729/30/CHE-123.456.789/32/8.1',
    });

    expect(resultat.nombreElements).toBe(NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION);
    expect(resultat.elements[30]).toBe('EPD');
    expect(resultat.elements[31]).toContain('//S1/');
  });

  it('34 éléments avec les deux procédures alternatives', () => {
    const resultat = encoderChargeUtileQr({
      ...FACTURE_CF01,
      informationFacturation: '//S1/10/2026-00424',
      proceduresAlternatives: ['Name AV1: UV;UltraPay005;12345', 'Name AV2: XY;XYService;54321'],
    });

    expect(resultat.nombreElements).toBe(NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES);
    expect(resultat.elements[32]).toBe('Name AV1: UV;UltraPay005;12345');
    expect(resultat.elements[33]).toBe('Name AV2: XY;XYService;54321');
  });

  it('conserve un StrdBkgInf vide quand une AltPmt suit sans information Swico', () => {
    // Sans ce champ vide, les AltPmt remonteraient d'un rang et seraient lues comme
    // l'information de facturation : décalage classique et silencieux.
    const resultat = encoderChargeUtileQr({
      ...FACTURE_CF01,
      proceduresAlternatives: ['Name AV1: UV;UltraPay005;12345'],
    });

    expect(resultat.nombreElements).toBe(33);
    expect(resultat.elements[30]).toBe('EPD');
    expect(resultat.elements[31]).toBe('');
    expect(resultat.elements[32]).toBe('Name AV1: UV;UltraPay005;12345');
  });

  it('refuse plus de deux procédures alternatives', () => {
    expect(() =>
      encoderChargeUtileQr({ ...FACTURE_CF01, proceduresAlternatives: ['a', 'b', 'c'] }),
    ).toThrowError(ErreurQrFacture);
  });
});

describe('injection de structure et longueurs', () => {
  it('refuse un CR+LF dans un champ — un saut de ligne insère un élément et décale tout', () => {
    const attaque: AdresseStructuree = {
      ...CLIENT_COMPLET,
      nom: 'Jean Dupont\r\nS\r\nFaux Créancier',
    };

    try {
      encoderChargeUtileQr({ ...FACTURE_CF01, debiteur: attaque });
      expect.unreachable('un saut de ligne dans un champ doit être refusé');
    } catch (erreur) {
      expect((erreur as ErreurQrFacture).code).toBe('CHAMP_CARACTERE_INTERDIT');
    }
  });

  it('refuse un LF seul et un caractère de contrôle', () => {
    for (const nom of ['Jean\nDupont', 'Jean\u0007Dupont', 'Jean\u007FDupont', 'Jean\rDupont']) {
      expect(() =>
        encoderChargeUtileQr({ ...FACTURE_CF01, debiteur: { ...CLIENT_COMPLET, nom } }),
      ).toThrowError(ErreurQrFacture);
    }
  });

  it('refuse un nom de créancier de plus de 70 caractères', () => {
    expect(() =>
      encoderChargeUtileQr({
        ...FACTURE_CF01,
        creancier: { ...GARAGE, nom: 'G'.repeat(71) },
      }),
    ).toThrowError(ErreurQrFacture);
  });

  it('refuse un message non structuré de plus de 140 caractères', () => {
    expect(() =>
      encoderChargeUtileQr({ ...FACTURE_CF01, messageNonStructure: 'x'.repeat(141) }),
    ).toThrowError(ErreurQrFacture);
  });

  it('refuse un message et une information Swico totalisant plus de 140 caractères', () => {
    try {
      encoderChargeUtileQr({
        ...FACTURE_CF01,
        messageNonStructure: 'x'.repeat(100),
        informationFacturation: 'y'.repeat(41),
      });
      expect.unreachable('la contrainte conjointe des 140 caractères doit s’appliquer');
    } catch (erreur) {
      expect((erreur as ErreurQrFacture).code).toBe('CHAMP_TROP_LONG');
    }
  });
});

describe('stabilité de la charge utile (RF-63, RF-64)', () => {
  it('est déterministe — deux encodages des mêmes données sont identiques octet pour octet', () => {
    const premier = encoderChargeUtileQr({ ...FACTURE_CF01, debiteur: CLIENT_COMPLET });
    const second = encoderChargeUtileQr({ ...FACTURE_CF01, debiteur: CLIENT_COMPLET });
    expect(second.payload).toBe(premier.payload);
  });

  it('porte le montant total, qu’un acompte ait été versé ou non', () => {
    // Le QR d'une facture ne change jamais après un paiement partiel : l'encodeur ne connaît
    // même pas la notion de solde, et c'est volontaire.
    expect(elementsDe({ ...FACTURE_CF01 })[18]).toBe('566.60');
  });
});
