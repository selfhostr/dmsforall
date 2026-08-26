import { describe, expect, it } from 'vitest';
import {
  signalChassis,
  signalDatePlausible,
  signalEmail,
  signalIdentifiant,
  signalMontant,
  signalNomFichier,
  signalNpaSuisse,
  signalPlaqueSuisse,
  signalTexteLibre,
} from './signaux-contenu';
import type { LigneTable } from './types';

function lignes(valeurs: unknown[]): LigneTable[] {
  return valeurs.map((v, i) => ({ index: i, valeurs: { COL: v as never } }));
}

describe('signalChassis', () => {
  it('reconnaît des châssis VIN 17 caractères valides', () => {
    const r = signalChassis(lignes(['WVWZZZ1JZXW000001', 'WVWZZZ1JZXW000002']), 'COL');
    expect(r.taux).toBe(1);
    expect(r.effectif).toBe(2);
  });

  it('rejette une valeur de mauvaise longueur ou contenant I/O/Q (hors alphabet VIN)', () => {
    const r = signalChassis(lignes(['TROPCOURT', 'WVWZZZ1JZXWIOQ001']), 'COL');
    expect(r.taux).toBe(0);
  });

  it('effectif=0 sans valeur exploitable', () => {
    expect(signalChassis(lignes([null, '']), 'COL')).toEqual({ taux: 0, effectif: 0 });
  });
});

describe('signalPlaqueSuisse', () => {
  it('reconnaît des plaques suisses courantes', () => {
    const r = signalPlaqueSuisse(lignes(['VD 123456', 'ZH123456', 'GE-9']), 'COL');
    expect(r.taux).toBe(1);
  });

  it('rejette un châssis (17 caractères, pas une plaque)', () => {
    const r = signalPlaqueSuisse(lignes(['WVWZZZ1JZXW000001']), 'COL');
    expect(r.taux).toBe(0);
  });
});

describe('signalNpaSuisse', () => {
  it('reconnaît des NPA suisses plausibles à 4 chiffres', () => {
    const r = signalNpaSuisse(lignes(['1000', '8001', '1950']), 'COL');
    expect(r.taux).toBe(1);
  });

  it('rejette un code postal à 5 chiffres (format étranger)', () => {
    const r = signalNpaSuisse(lignes(['75008']), 'COL');
    expect(r.taux).toBe(0);
  });
});

describe('signalEmail', () => {
  it('reconnaît des adresses courriel plausibles', () => {
    const r = signalEmail(lignes(['jean.dupont@example.ch', 'info@garage-martin.ch']), 'COL');
    expect(r.taux).toBe(1);
  });

  it('rejette du texte sans arobase', () => {
    expect(signalEmail(lignes(['pas une adresse']), 'COL').taux).toBe(0);
  });
});

describe('signalMontant', () => {
  it('reconnaît des montants avec centimes plausibles', () => {
    const r = signalMontant(lignes([1234.5, 99.9, 0.05]), 'COL');
    expect(r.taux).toBe(1);
  });

  it("un identifiant entier grand (immatriculation interne) a un taux de 1 (indistingable seul, à combiner avec d'autres signaux)", () => {
    // La fonction ne juge que la précision décimale ; la désambiguïsation vient de la combinaison
    // avec d'autres signaux dans le classement de rôle, pas de ce détecteur isolé.
    const r = signalMontant(lignes([42]), 'COL');
    expect(r.taux).toBe(1);
  });
});

describe('signalDatePlausible', () => {
  it('accepte une date dans la plage plausible', () => {
    const r = signalDatePlausible(lignes([new Date('2024-01-15T00:00:00Z')]), 'COL');
    expect(r.taux).toBe(1);
  });

  it('signale une date aberrante (erreur de siècle produisant une année lointaine)', () => {
    const r = signalDatePlausible(lignes([new Date(Date.UTC(9999, 0, 1))]), 'COL');
    expect(r.taux).toBe(0);
  });
});

describe('signalIdentifiant', () => {
  it('taux proche de 1 pour une colonne à valeurs toutes distinctes (clé plausible)', () => {
    const r = signalIdentifiant(lignes(['A1', 'A2', 'A3', 'A4']), 'COL');
    expect(r.taux).toBe(1);
  });

  it('taux faible pour une colonne très répétitive (pas une clé)', () => {
    const r = signalIdentifiant(lignes(['X', 'X', 'X', 'X', 'Y']), 'COL');
    expect(r.taux).toBeLessThan(0.5);
  });
});

describe('signalTexteLibre', () => {
  it('reconnaît un texte de désignation assez long', () => {
    const r = signalTexteLibre(
      lignes(['Plaquette de frein avant référence pour véhicule utilitaire léger']),
      'COL',
    );
    expect(r.taux).toBe(1);
  });

  it("ignore les valeurs Date : leur sérialisation ISO (24 caractères) n'est pas un texte libre", () => {
    // Régression : `valeursTexteColonne` sérialise une Date en ISO 8601 (24 caractères) pour
    // d'autres signaux ; sans exclusion explicite, cette longueur suffisait à faire passer une
    // colonne date pour une désignation plausible (bonus indu pour `evaluerArticle` sur une table
    // de factures pauvre en colonnes — cf. detecteur-role.spec.ts).
    const r = signalTexteLibre(lignes([new Date('2024-01-15T00:00:00Z')]), 'COL');
    expect(r).toEqual({ taux: 0, effectif: 0 });
  });

  it('rejette un texte court (code, sigle)', () => {
    const r = signalTexteLibre(lignes(['AB12']), 'COL');
    expect(r.taux).toBe(0);
  });
});

describe('signalNomFichier', () => {
  it('reconnaît des chemins/noms de fichiers documentaires', () => {
    const r = signalNomFichier(lignes(['scan_facture.pdf', 'photo_expertise.jpg']), 'COL');
    expect(r.taux).toBe(1);
  });

  it('rejette du texte sans extension documentaire', () => {
    expect(signalNomFichier(lignes(['Garage Martin SA']), 'COL').taux).toBe(0);
  });
});
