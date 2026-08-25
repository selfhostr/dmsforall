import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculerTailleLotLecture, lireLignesDbf } from './lecteur-dbf';
import { ecrireDbf } from '../fixtures/constructeur-dbf';

describe('calculerTailleLotLecture', () => {
  it('reste borné en octets, indépendamment du nombre total de lignes de la table', () => {
    // La taille de lot ne dépend QUE de la taille d'un enregistrement, jamais du nombre de
    // lignes : une table de 20 000 lignes et une de 9,4 millions utilisent le même calcul.
    for (const tailleEnregistrement of [8, 50, 200, 1000, 5000]) {
      const lot = calculerTailleLotLecture(tailleEnregistrement);
      const octetsParLot = lot * tailleEnregistrement;
      expect(octetsParLot).toBeLessThanOrEqual(2 * 1_048_576); // marge : cible ~1 Mo, plafond dur 2 Mo
      expect(lot).toBeGreaterThanOrEqual(1);
    }
  });

  it('ne dépasse jamais 2000 enregistrements par lot, même pour un enregistrement minuscule', () => {
    expect(calculerTailleLotLecture(1)).toBeLessThanOrEqual(2000);
  });
});

describe('lireLignesDbf', () => {
  let rep: string;

  beforeEach(async () => {
    rep = await mkdtemp(join(tmpdir(), 'dfa-dbf-lecture-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rep, { recursive: true, force: true });
  });

  it('rend les valeurs décodées de chaque type de champ documenté', async () => {
    const chemin = join(rep, 'TYPES.DBF');
    await ecrireDbf(chemin, {
      champs: [
        { nom: 'NOM', type: 'C', longueur: 15 },
        { nom: 'PRIX', type: 'N', longueur: 10, decimales: 2 },
        { nom: 'DATE_ENTR', type: 'D', longueur: 8 },
        { nom: 'ACTIF', type: 'L', longueur: 1 },
      ],
      enregistrements: [
        { valeurs: { NOM: 'Garage Martin', PRIX: 1234.5, DATE_ENTR: '20260115', ACTIF: true } },
      ],
    });

    const lignes = [];
    for await (const ligne of lireLignesDbf(chemin)) lignes.push(ligne);

    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.valeurs.NOM).toBe('Garage Martin');
    expect(lignes[0]!.valeurs.PRIX).toBe(1234.5);
    expect(lignes[0]!.valeurs.ACTIF).toBe(true);
    const date = lignes[0]!.valeurs.DATE_ENTR as Date;
    expect(date.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('exclut systématiquement les enregistrements marqués supprimés (0x2A)', async () => {
    const chemin = join(rep, 'SUPPR.DBF');
    await ecrireDbf(chemin, {
      champs: [{ nom: 'NOM', type: 'C', longueur: 10 }],
      enregistrements: [
        { valeurs: { NOM: 'Actif1' } },
        { valeurs: { NOM: 'Supprime' }, supprime: true },
        { valeurs: { NOM: 'Actif2' } },
      ],
    });

    const noms = [];
    for await (const ligne of lireLignesDbf(chemin)) noms.push(ligne.valeurs.NOM);

    expect(noms).toEqual(['Actif1', 'Actif2']);
  });

  it('décode les mémos (.fpt) et gère les accents hérités (cp850)', async () => {
    const chemin = join(rep, 'MEMOS.DBF');
    await ecrireDbf(chemin, {
      champs: [
        { nom: 'NOM', type: 'C', longueur: 15 },
        { nom: 'REMARQUE', type: 'M', longueur: 4 },
      ],
      enregistrements: [
        { valeurs: { NOM: 'Müller', REMARQUE: { memo: 'Contrôle effectué à Genève, réparé.' } } },
      ],
      encodage: 'cp850',
      octetPageDeCode: 0x02,
    });

    const lignes = [];
    for await (const ligne of lireLignesDbf(chemin)) lignes.push(ligne);

    expect(lignes[0]!.valeurs.NOM).toBe('Müller');
    expect(lignes[0]!.valeurs.REMARQUE).toBe('Contrôle effectué à Genève, réparé.');
  });

  it('rend null pour un mémo pointant vers le bloc 0 (jamais renseigné)', async () => {
    const chemin = join(rep, 'MEMOVIDE.DBF');
    await ecrireDbf(chemin, {
      champs: [
        { nom: 'NOM', type: 'C', longueur: 10 },
        { nom: 'NOTE', type: 'M', longueur: 4 },
      ],
      enregistrements: [{ valeurs: { NOM: 'Sans note', NOTE: null } }],
    });

    const lignes = [];
    for await (const ligne of lireLignesDbf(chemin)) lignes.push(ligne);
    expect(lignes[0]!.valeurs.NOTE).toBeNull();
  });

  it('respecte `limite` et interrompt la lecture après N lignes actives', async () => {
    const chemin = join(rep, 'LIMITE.DBF');
    await ecrireDbf(chemin, {
      champs: [{ nom: 'N', type: 'N', longueur: 6 }],
      enregistrements: Array.from({ length: 50 }, (_, i) => ({ valeurs: { N: i } })),
    });

    const lignes = [];
    for await (const ligne of lireLignesDbf(chemin, { limite: 3 })) lignes.push(ligne);
    expect(lignes.map((l) => l.valeurs.N)).toEqual([0, 1, 2]);
  });

  it('`limite` compte les lignes ACTIVES rendues, pas les enregistrements physiques (suppressions ignorées)', async () => {
    const chemin = join(rep, 'LIMITESUPPR.DBF');
    await ecrireDbf(chemin, {
      champs: [{ nom: 'N', type: 'N', longueur: 6 }],
      enregistrements: [
        { valeurs: { N: 1 }, supprime: true },
        { valeurs: { N: 2 } },
        { valeurs: { N: 3 }, supprime: true },
        { valeurs: { N: 4 } },
      ],
    });

    const lignes = [];
    for await (const ligne of lireLignesDbf(chemin, { limite: 2 })) lignes.push(ligne);
    expect(lignes.map((l) => l.valeurs.N)).toEqual([2, 4]);
  });

  it('une table vide ne rend aucune ligne', async () => {
    const chemin = join(rep, 'VIDE.DBF');
    await ecrireDbf(chemin, {
      champs: [{ nom: 'X', type: 'C', longueur: 5 }],
      enregistrements: [],
    });
    const lignes = [];
    for await (const ligne of lireLignesDbf(chemin)) lignes.push(ligne);
    expect(lignes).toEqual([]);
  });

  it('lit correctement une grosse table par lots (20 000 lignes), sans erreur ni perte', async () => {
    const chemin = join(rep, 'GROSSE.DBF');
    const nbLignes = 20_000;
    await ecrireDbf(chemin, {
      champs: [{ nom: 'N', type: 'N', longueur: 8 }],
      enregistrements: Array.from({ length: nbLignes }, (_, i) => ({ valeurs: { N: i } })),
    });

    let n = 0;
    let dernierePresente = -1;
    for await (const ligne of lireLignesDbf(chemin)) {
      dernierePresente = ligne.valeurs.N as number;
      n++;
    }

    expect(n).toBe(nbLignes);
    expect(dernierePresente).toBe(nbLignes - 1);
  });

  it('échantillonne une grosse table sans la parcourir entièrement (`limite` rend rapidement)', async () => {
    const chemin = join(rep, 'GROSSE2.DBF');
    const nbLignes = 100_000;
    await ecrireDbf(chemin, {
      champs: [{ nom: 'N', type: 'N', longueur: 8 }],
      enregistrements: Array.from({ length: nbLignes }, (_, i) => ({ valeurs: { N: i } })),
    });

    const debutComplet = performance.now();
    let nComplet = 0;
    for await (const _ligne of lireLignesDbf(chemin)) nComplet++;
    const dureeComplete = performance.now() - debutComplet;

    const debutEchantillon = performance.now();
    let nEchantillon = 0;
    for await (const _ligne of lireLignesDbf(chemin, { limite: 5 })) nEchantillon++;
    const dureeEchantillon = performance.now() - debutEchantillon;

    expect(nComplet).toBe(nbLignes);
    expect(nEchantillon).toBe(5);
    // Preuve de paresse : échantillonner 5 lignes est nettement plus rapide que parcourir les
    // 100 000, donc la lecture s'arrête bien tôt plutôt que de tout consommer avant de trier.
    expect(dureeEchantillon).toBeLessThan(dureeComplete / 3);
  });
});
