import { describe, expect, it } from 'vitest';

import {
  DECOMPTES_ELEMENTS_ADMIS,
  NOMBRE_CHAMPS_BLOC_ADRESSE,
  NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION,
  NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES,
  NOMBRE_ELEMENTS_AVEC_UNE_PROCEDURE_ALTERNATIVE,
  NOMBRE_ELEMENTS_JUSQU_A_EPD,
  NOMBRE_MAX_PROCEDURES_ALTERNATIVES,
  ORDRE_CHAMPS_PAYLOAD,
  TRAILER_EPD,
} from './structure';

/**
 * ────────────────────────────────────────────────────────────────────────────────────────
 * LE GARDE-FOU CONTRE LE DÉCALAGE D'UN CHAMP
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * `structure.ts` affirme le décompte de deux façons **indépendantes** : des constantes écrites
 * à la main (31 / 32 / 34) et la liste ordonnée `ORDRE_CHAMPS_PAYLOAD`. Ce fichier vérifie
 * qu'elles concordent. Si quelqu'un corrige l'une sans l'autre — ou ajoute un champ sans
 * réfléchir — il casse ici, avant qu'un garage n'imprime une facture illisible.
 *
 * Le nombre d'éléments réellement produits par l'encodeur est vérifié dans `encodeur.spec.ts` :
 * ce sont **trois** affirmations qui doivent tomber d'accord, pas une seule recopiée trois fois.
 */
describe('décompte des éléments de la charge utile (CF-21)', () => {
  it('un bloc d’adresse compte 7 champs — AdrTp plus ses six lignes, pas six', () => {
    // Le point exact contesté par `modele-documentaire-facturation.md` §5.3, qui écrit
    // « 6 lignes vides » pour l'Ultimate Creditor. C'est 7.
    expect(NOMBRE_CHAMPS_BLOC_ADRESSE).toBe(7);
  });

  it('la charge utile compte 31 éléments jusqu’au trailer EPD inclus', () => {
    expect(NOMBRE_ELEMENTS_JUSQU_A_EPD).toBe(31);
  });

  it('32 éléments avec l’information de facturation Swico, 34 avec les deux AltPmt', () => {
    expect(NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION).toBe(32);
    expect(NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES).toBe(34);
  });

  it('33 éléments est admissible aussi — la spécification interne l’oublie', () => {
    // `CF-21` énumère « 31, 32 ou 34 » et saute 33. Les deux procédures alternatives sont
    // indépendantes : n'en déclarer qu'une donne 33 éléments, parfaitement conforme. Un
    // garde-fou calqué sur l'énumération de la spécification refuserait une facture valide.
    expect(NOMBRE_ELEMENTS_AVEC_UNE_PROCEDURE_ALTERNATIVE).toBe(33);
    expect([...DECOMPTES_ELEMENTS_ADMIS]).toEqual([31, 32, 33, 34]);
  });

  it('le décompte se reconstitue bloc par bloc', () => {
    const enTete = 3;
    const iban = 1;
    const creancier = NOMBRE_CHAMPS_BLOC_ADRESSE;
    const ultimateCreditor = NOMBRE_CHAMPS_BLOC_ADRESSE;
    const montantEtDevise = 2;
    const debiteur = NOMBRE_CHAMPS_BLOC_ADRESSE;
    const reference = 2;
    const message = 1;
    const trailer = 1;

    expect(
      enTete +
        iban +
        creancier +
        ultimateCreditor +
        montantEtDevise +
        debiteur +
        reference +
        message +
        trailer,
    ).toBe(NOMBRE_ELEMENTS_JUSQU_A_EPD);
  });

  it('ORDRE_CHAMPS_PAYLOAD place EPD en 31e position et compte 34 entrées', () => {
    const positionTrailer = ORDRE_CHAMPS_PAYLOAD.indexOf('QRCH/RmtInf/AddInf/Trailer') + 1;

    expect(positionTrailer).toBe(NOMBRE_ELEMENTS_JUSQU_A_EPD);
    expect(ORDRE_CHAMPS_PAYLOAD).toHaveLength(NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES);
  });

  it('ORDRE_CHAMPS_PAYLOAD contient bien 7 champs UltmtCdtr et 7 champs UltmtDbtr', () => {
    const compter = (prefixe: string): number =>
      ORDRE_CHAMPS_PAYLOAD.filter((champ) => champ.startsWith(prefixe)).length;

    expect(compter('QRCH/UltmtCdtr/')).toBe(NOMBRE_CHAMPS_BLOC_ADRESSE);
    expect(compter('QRCH/UltmtDbtr/')).toBe(NOMBRE_CHAMPS_BLOC_ADRESSE);
    expect(compter('QRCH/CdtrInf/Cdtr/')).toBe(NOMBRE_CHAMPS_BLOC_ADRESSE);
  });

  it('l’ordre des blocs est celui de la spécification, sans exception', () => {
    // Un ordre différent est aussi fatal qu'un décompte différent : la banque lit par position,
    // pas par nom.
    expect([...ORDRE_CHAMPS_PAYLOAD]).toEqual([
      'QRCH/Hdr/QRType',
      'QRCH/Hdr/Version',
      'QRCH/Hdr/Coding',
      'QRCH/CdtrInf/IBAN',
      'QRCH/CdtrInf/Cdtr/AdrTp',
      'QRCH/CdtrInf/Cdtr/Name',
      'QRCH/CdtrInf/Cdtr/StrtNmOrAdrLine1',
      'QRCH/CdtrInf/Cdtr/BldgNbOrAdrLine2',
      'QRCH/CdtrInf/Cdtr/PstCd',
      'QRCH/CdtrInf/Cdtr/TwnNm',
      'QRCH/CdtrInf/Cdtr/Ctry',
      'QRCH/UltmtCdtr/AdrTp',
      'QRCH/UltmtCdtr/Name',
      'QRCH/UltmtCdtr/StrtNmOrAdrLine1',
      'QRCH/UltmtCdtr/BldgNbOrAdrLine2',
      'QRCH/UltmtCdtr/PstCd',
      'QRCH/UltmtCdtr/TwnNm',
      'QRCH/UltmtCdtr/Ctry',
      'QRCH/CcyAmt/Amt',
      'QRCH/CcyAmt/Ccy',
      'QRCH/UltmtDbtr/AdrTp',
      'QRCH/UltmtDbtr/Name',
      'QRCH/UltmtDbtr/StrtNmOrAdrLine1',
      'QRCH/UltmtDbtr/BldgNbOrAdrLine2',
      'QRCH/UltmtDbtr/PstCd',
      'QRCH/UltmtDbtr/TwnNm',
      'QRCH/UltmtDbtr/Ctry',
      'QRCH/RmtInf/Tp',
      'QRCH/RmtInf/Ref',
      'QRCH/RmtInf/AddInf/Ustrd',
      'QRCH/RmtInf/AddInf/Trailer',
      'QRCH/RmtInf/AddInf/StrdBkgInf',
      'QRCH/AltPmt[1]',
      'QRCH/AltPmt[2]',
    ]);
  });

  it('les deux procédures alternatives closent la structure', () => {
    expect(NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION + NOMBRE_MAX_PROCEDURES_ALTERNATIVES).toBe(
      NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES,
    );
    expect(TRAILER_EPD).toBe('EPD');
  });
});
