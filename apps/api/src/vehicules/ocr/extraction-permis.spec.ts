import { describe, expect, it } from 'vitest';

import {
  candidatsCodeType,
  checksumVinValide,
  extraireAdresse,
  extraireDate,
  extrairePlaque,
  extraireVin,
  nettoyerTexteLibre,
  rechercherVin,
} from './extraction-permis';

describe('checksumVinValide', () => {
  it('VIN de démonstration à clé de contrôle correcte (exemple pédagogique publié, non lié à un document réel) -> valide', () => {
    expect(checksumVinValide('1M8GDM9AXKP042788')).toBe(true);
  });

  it('VIN existant du dépôt (fixture vehicule.controller.ts) à clé de contrôle incorrecte -> invalide', () => {
    expect(checksumVinValide('WVWZZZ1KZAW123456')).toBe(false);
  });

  it('longueur différente de 17 -> invalide sans planter', () => {
    expect(checksumVinValide('TROP-COURT')).toBe(false);
  });

  it('caractère hors alphabet VIN (I/O/Q exclus par ISO 3779) -> invalide', () => {
    expect(checksumVinValide('IO8GDM9AXKP042788')).toBe(false);
  });
});

describe('extraireVin', () => {
  it('texte propre -> VIN + verdict du checksum', () => {
    const resultat = extraireVin('1M8GDM9AXKP042788');
    expect(resultat).toEqual({ valeur: '1M8GDM9AXKP042788', checksumValide: true });
  });

  it('groupes séparés par des espaces (mise en page du permis) -> espaces ignorés', () => {
    const resultat = extraireVin('1M8 GDM 9AX KP0 427 88');
    expect(resultat?.valeur).toBe('1M8GDM9AXKP042788');
  });

  it('texte sans run de 17 caractères exploitable -> null (jamais une valeur tronquée)', () => {
    expect(extraireVin('illisible')).toBeNull();
  });

  it('chaîne vide -> null', () => {
    expect(extraireVin('')).toBeNull();
  });
});

describe('rechercherVin', () => {
  /** Exemple pédagogique publié, non lié à un document réel (même fixture que `checksumVinValide`
   *  ci-dessus) — WMI `1M8`, absent de `WMI_PAR_MARQUE` (`wmi-marques.ts`). */
  const VRAI = '1M8GDM9AXKP042788';

  it('lecture déjà correcte (clé de contrôle valide telle quelle) -> rendue sans recherche de substitution', () => {
    expect(rechercherVin(VRAI)).toEqual({ valeur: VRAI, checksumValide: true });
  });

  it('une seule confusion visuelle plausible (8 lu B, position 3) -> corrigée, seule à valider la clé', () => {
    // '1MBGDM9AXKP042788' : VRAI avec un '8' lu 'B' (classe de confusion 8/B).
    const resultat = rechercherVin('1MBGDM9AXKP042788');
    expect(resultat).toEqual({ valeur: VRAI, checksumValide: true });
  });

  it('caractère hors alphabet VIN lu (I au lieu de 1, position forcée) COMBINÉ à une confusion optionnelle (8/B) -> corrigée quand même', () => {
    // 'I' (position 0) n'appartient pas à l'alphabet VIN (ISO 3779) : substitution FORCÉE, pas
    // comptée dans le budget de substitutions optionnelles (`MAX_SUBSTITUTIONS_SIMULTANEES`).
    const resultat = rechercherVin('IMBGDM9AXKP042788');
    expect(resultat).toEqual({ valeur: VRAI, checksumValide: true });
  });

  it('bruit de bordure (libellé + espaces autour) EN PLUS d’une confusion de caractère -> fenêtre correcte retrouvée par glissement, puis corrigée', () => {
    const resultat = rechercherVin('XX 1MBGDM9AXKP042788 YY');
    expect(resultat).toEqual({ valeur: VRAI, checksumValide: true });
  });

  it('deux candidats DISTINCTS valident la clé au même niveau minimal -> aucun choix, la lecture brute est rendue douteuse (jamais un VIN faux)', () => {
    // Cas réel trouvé par recherche exhaustive (rapport de livraison) : 'JM8CT4CZ3DYK9NY46' a
    // EXACTEMENT deux corrections à une substitution qui valident toutes deux la clé de contrôle
    // ('JMBCT4CZ3DYK9NY46' et 'JM8CT4CZ30YK9NY46') — sans marque connue, aucune ne doit être
    // choisie.
    const bruite = 'JM8CT4CZ3DYK9NY46';
    expect(rechercherVin(bruite)).toEqual({ valeur: bruite, checksumValide: false });
  });

  it('marque connue (croisement WMI) qui départage les deux candidats ci-dessus -> validée', () => {
    const bruite = 'JM8CT4CZ3DYK9NY46';
    expect(rechercherVin(bruite, 'MITSUBISHI')).toEqual({
      valeur: 'JMBCT4CZ3DYK9NY46',
      checksumValide: true,
    });
  });

  it('marque connue en contradiction avec l’UNIQUE candidat trouvé -> rejeté MÊME seul (gage de cohérence, pas seulement un départage — v. wmi-marques.ts)', () => {
    // Le seul candidat valide de '1MBGDM9AXKP042788' est VRAI (WMI `1M8`), qui n'appartient à
    // aucun WMI Volkswagen connu de la table.
    const resultat = rechercherVin('1MBGDM9AXKP042788', 'VOLKSWAGEN');
    expect(resultat).toEqual({ valeur: '1MBGDM9AXKP042788', checksumValide: false });
  });

  it('marque connue mais ABSENTE de la table curatée -> aucun effet, la correction sans contradiction établie reste validée', () => {
    const resultat = rechercherVin('1MBGDM9AXKP042788', 'MARQUE-INCONNUE-XYZ');
    expect(resultat).toEqual({ valeur: VRAI, checksumValide: true });
  });

  it('lecture existante à clé de contrôle incorrecte et sans AUCUNE substitution qui valide -> rendue douteuse, jamais une correction inventée', () => {
    // Fixture existante du dépôt (vehicule.controller.ts), déjà utilisée par `checksumVinValide`
    // ci-dessus : sa clé ne valide ni brute ni via aucune substitution à une position.
    const bruite = 'WVWZZZ1KZAW123456';
    expect(rechercherVin(bruite)).toEqual({ valeur: bruite, checksumValide: false });
  });

  it('texte sans run de 17 caractères exploitable, même après tolérance de fenêtre -> null', () => {
    expect(rechercherVin('illisible')).toBeNull();
  });

  it('texte vide -> null', () => {
    expect(rechercherVin('')).toBeNull();
  });
});

describe('candidatsCodeType', () => {
  it('texte propre -> le premier candidat (le plus probable, essayé en premier) est la valeur nettoyée telle quelle', () => {
    expect(candidatsCodeType('1VD455')[0]).toBe('1VD455');
  });

  it('bruit en fin de chaîne (colonne "Code"/poids voisine, mesuré sur échantillon réel) -> candidats tronqués en plus du candidat brut', () => {
    const candidats = candidatsCodeType('1VD455B');
    expect(candidats).toContain('1VD455B');
    expect(candidats).toContain('1VD455');
    // Coupe à 2 caractères seulement si la longueur restante reste exploitable (>= 4).
    expect(candidats).toContain('1VD45');
  });

  it('bruit en début de chaîne -> candidat privé du premier caractère aussi proposé', () => {
    const candidats = candidatsCodeType('X1VD455');
    expect(candidats).toContain('1VD455');
  });

  it('texte trop court pour être un code type -> aucun candidat', () => {
    expect(candidatsCodeType('AB')).toEqual([]);
  });

  it('espaces internes ignorés (mise en page « 1VD4 55 » du permis)', () => {
    expect(candidatsCodeType('1VD4 55')).toContain('1VD455');
  });

  it('bruit important en fin de chaîne (colonne "Poids total" voisine captée, mesuré sur échantillon réel) -> jusqu’à 4 caractères tolérés', () => {
    expect(candidatsCodeType('1VD455 33SN')).toContain('1VD455');
  });

  it('bruit important en DÉBUT de chaîne (libellé fr/de/it/rm empilé capté avant la valeur, mesuré sur le corpus réel) -> jusqu’à 4 caractères tolérés, pas seulement 1', () => {
    expect(candidatsCodeType('ABCD1VD455')).toContain('1VD455');
  });
});

describe('extrairePlaque', () => {
  it('canton + numéro -> extraits, la couleur suivante ignorée', () => {
    expect(extrairePlaque('VS 135792 blanc')).toEqual({ canton: 'VS', numero: '135792' });
  });

  it('sans séparateur -> extraits quand même', () => {
    expect(extrairePlaque('VD123456')).toEqual({ canton: 'VD', numero: '123456' });
  });

  it('texte qui ne commence pas par deux lettres de canton, et où aucun canton n’est suivi de chiffres -> null', () => {
    expect(extrairePlaque('135792 VS')).toBeNull();
  });

  it('chaîne vide -> null', () => {
    expect(extrairePlaque('')).toBeNull();
  });

  it('libellé fr/de/it/rm empilé capté avant la valeur (bruit de tête, mesuré sur le corpus réel — la découpe de zone est volontairement généreuse, voir zones-cadrees.mjs) -> canton+numéro trouvés quand même, PAS ancré en tête de chaîne', () => {
    expect(extrairePlaque('SCHILDPLAQUETARGANUMER VS 135792 blanc')).toEqual({
      canton: 'VS',
      numero: '135792',
    });
  });

  it('deux lettres qui NE sont PAS une abréviation cantonale suisse -> null, même suivies de chiffres (whitelist des 26 cantons, pas [A-Z]{2} quelconque)', () => {
    expect(extrairePlaque('XX 123456')).toBeNull();
  });
});

describe('extraireDate', () => {
  const MAINTENANT = new Date('2026-08-17T00:00:00Z');

  it('jj.mm.aaaa valide -> ISO aaaa-mm-jj', () => {
    expect(extraireDate('31.01.2007', MAINTENANT)).toBe('2007-01-31');
  });

  it('bruit en fin de chaîne (colonne voisine, mesuré sur échantillon réel) -> ignoré', () => {
    expect(extraireDate('31.01.20072', MAINTENANT)).toBe('2007-01-31');
  });

  it('jour hors bornes calendaires (31 février) -> null, jamais normalisé en silence', () => {
    expect(extraireDate('31.02.2007', MAINTENANT)).toBeNull();
  });

  it('mois hors bornes -> null', () => {
    expect(extraireDate('15.13.2007', MAINTENANT)).toBeNull();
  });

  it('date dans le futur -> null (une 1re mise en circulation ne peut pas être à venir)', () => {
    expect(extraireDate('01.01.2099', MAINTENANT)).toBeNull();
  });

  it('aucune date reconnaissable -> null', () => {
    expect(extraireDate('texte sans date', MAINTENANT)).toBeNull();
  });
});

describe('nettoyerTexteLibre', () => {
  it('espaces multiples réduits, bords rognés', () => {
    expect(nettoyerTexteLibre('  Un   Nom   ')).toBe('Un Nom');
  });

  it('chaîne vide après nettoyage -> null', () => {
    expect(nettoyerTexteLibre('   ')).toBeNull();
  });
});

describe('extraireAdresse', () => {
  it('rue puis ligne NPA+localité -> décomposées', () => {
    const resultat = extraireAdresse('Route Exemple 4D\n1906 Localite');
    expect(resultat).toEqual({ rue: 'Route Exemple 4D', npa: '1906', localite: 'Localite' });
  });

  it('bloc sans NPA reconnaissable -> npa/localite null, rue quand même prise', () => {
    const resultat = extraireAdresse('Un bloc sans code postal reconnu');
    expect(resultat.npa).toBeNull();
    expect(resultat.localite).toBeNull();
    expect(resultat.rue).toBe('Un bloc sans code postal reconnu');
  });

  it('bloc vide -> tout null', () => {
    expect(extraireAdresse('')).toEqual({ rue: null, npa: null, localite: null });
  });
});
