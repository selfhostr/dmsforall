import { describe, expect, it } from 'vitest';

import { cleIdeValide, schemaModificationParametresEntreprise, schemaNumeroTva } from './tenant';
import {
  schemaCreationMotifRendezVous,
  schemaModificationMotifRendezVous,
} from './rendezvous/motif';

describe('schemaNumeroTva', () => {
  it('accepte un IDE valide (clé 0 : somme multiple de 11) et normalise la casse', () => {
    expect(schemaNumeroTva.parse('CHE-116.281.710 TVA')).toBe('CHE-116.281.710 TVA');
    expect(schemaNumeroTva.parse(' che-116.281.710 mwst ')).toBe('CHE-116.281.710 MWST');
    expect(schemaNumeroTva.parse('CHE-116.281.710 IVA')).toBe('CHE-116.281.710 IVA');
  });

  it('refuse une clé de contrôle fausse', () => {
    expect(schemaNumeroTva.safeParse('CHE-116.281.711 TVA').success).toBe(false);
  });

  it('refuse un format approximatif', () => {
    for (const v of [
      '116.281.710',
      'CHE116281710TVA',
      'CHE-116.281.710',
      'CHE-116.281.710 HT',
      '',
    ]) {
      expect(schemaNumeroTva.safeParse(v).success).toBe(false);
    }
  });

  it('un IDE dont la clé calculée vaudrait 10 n’existe pas : aucun 9e chiffre ne passe', () => {
    const prefixe = '00000012'; // somme 13, reste 2, clé 9
    expect(cleIdeValide(`${prefixe}9`)).toBe(true);
    const prefixeCle10 = '10000000'; // somme 5, reste 5, clé 6
    expect(cleIdeValide(`${prefixeCle10}6`)).toBe(true);
    // '00000003' : somme 12, reste 1, clé 10 : impossible
    for (let d = 0; d <= 9; d += 1) expect(cleIdeValide(`00000003${String(d)}`)).toBe(false);
  });

  it('null efface, absent ne change rien', () => {
    expect(schemaModificationParametresEntreprise.parse({ numeroTva: null })).toEqual({
      numeroTva: null,
    });
    expect(schemaModificationParametresEntreprise.parse({})).toEqual({});
  });
});

describe('contrats motifs de rendez-vous', () => {
  it('code normalisé en majuscules, libellé obligatoire', () => {
    const m = schemaCreationMotifRendezVous.parse({ code: ' freins-av ', libelleFr: 'Freins' });
    expect(m.code).toBe('FREINS-AV');
    expect(schemaCreationMotifRendezVous.safeParse({ code: 'X' }).success).toBe(false);
  });

  it('refuse un code avec espace ou accent, une durée nulle ou négative', () => {
    expect(schemaCreationMotifRendezVous.safeParse({ code: 'A B', libelleFr: 'x' }).success).toBe(
      false,
    );
    expect(schemaCreationMotifRendezVous.safeParse({ code: 'É', libelleFr: 'x' }).success).toBe(
      false,
    );
    expect(
      schemaCreationMotifRendezVous.safeParse({ code: 'A', libelleFr: 'x', dureeDefautMinutes: 0 })
        .success,
    ).toBe(false);
  });

  it('la modification ne contient pas le code (immuable)', () => {
    const r = schemaModificationMotifRendezVous.parse({ code: 'AUTRE', actif: false });
    expect(r).toEqual({ actif: false });
  });
});

describe('délai de paiement par défaut', () => {
  it('entier 0 à 365, 0 compris', () => {
    const schema = schemaModificationParametresEntreprise;
    expect(schema.parse({ delaiPaiementJoursDefaut: 0 })).toEqual({ delaiPaiementJoursDefaut: 0 });
    expect(schema.safeParse({ delaiPaiementJoursDefaut: 366 }).success).toBe(false);
    expect(schema.safeParse({ delaiPaiementJoursDefaut: -1 }).success).toBe(false);
    expect(schema.safeParse({ delaiPaiementJoursDefaut: 10.5 }).success).toBe(false);
  });
});

describe('raison sociale', () => {
  const schema = schemaModificationParametresEntreprise;
  it('retire les espaces de bord et accepte 1 à 200 caractères', () => {
    expect(schema.parse({ raisonSociale: '  Garage Martin Sàrl ' })).toEqual({
      raisonSociale: 'Garage Martin Sàrl',
    });
    expect(schema.safeParse({ raisonSociale: 'x'.repeat(200) }).success).toBe(true);
  });
  it('refuse vide, blanche ou trop longue', () => {
    expect(schema.safeParse({ raisonSociale: '' }).success).toBe(false);
    expect(schema.safeParse({ raisonSociale: '   ' }).success).toBe(false);
    expect(schema.safeParse({ raisonSociale: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ raisonSociale: null }).success).toBe(false);
  });
});
