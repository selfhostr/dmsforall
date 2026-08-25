import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyserEnTeteDbf, analyserEnTeteDepuisTampon } from './en-tete-dbf';
import { ErreurEnTeteDbfInvalide } from '../erreurs';
import { construireDbf, ecrireDbf } from '../fixtures/constructeur-dbf';

describe('analyserEnTeteDepuisTampon (pure, sans I/O)', () => {
  it('rend null pour un tampon trop court', () => {
    expect(analyserEnTeteDepuisTampon(Buffer.alloc(10))).toBeNull();
  });

  it('rend null pour un binaire arbitraire qui ressemble par coïncidence à un en-tête 32o', () => {
    // en-tête plausible sur les 32 premiers octets, mais aucune zone de champs cohérente derrière.
    const brouillon = Buffer.alloc(200, 0xab);
    brouillon.writeUInt16LE(64, 8); // tailleEntete
    brouillon.writeUInt16LE(20, 10); // tailleEnregistrement, sans rapport avec les "champs"
    expect(analyserEnTeteDepuisTampon(brouillon)).toBeNull();
  });

  it('accepte un en-tête DBF valide produit par le constructeur de fixtures', () => {
    const { dbf } = construireDbf({
      champs: [{ nom: 'NOM', type: 'C', longueur: 20 }],
      enregistrements: [],
    });
    const brute = analyserEnTeteDepuisTampon(dbf);
    expect(brute).not.toBeNull();
    expect(brute?.champs).toHaveLength(1);
    expect(brute?.champs[0]).toMatchObject({ nom: 'NOM', type: 'C', longueur: 20 });
  });
});

describe('analyserEnTeteDbf (I/O réelle bornée)', () => {
  let rep: string;

  beforeEach(async () => {
    rep = await mkdtemp(join(tmpdir(), 'dfa-dbf-'));
  });

  afterEach(async () => {
    await rm(rep, { recursive: true, force: true });
  });

  it('lit un en-tête DBF réel et associe le .fpt quand il existe', async () => {
    const chemin = join(rep, 'TABLE1.DBF');
    await ecrireDbf(chemin, {
      champs: [
        { nom: 'NOM', type: 'C', longueur: 20 },
        { nom: 'NOTES', type: 'M', longueur: 4 },
      ],
      enregistrements: [{ valeurs: { NOM: 'Test', NOTES: { memo: 'un mémo' } } }],
    });

    const entete = await analyserEnTeteDbf(chemin);
    expect(entete.champs.map((c) => c.nom)).toEqual(['NOM', 'NOTES']);
    expect(entete.cheminMemo).toBe(join(rep, 'TABLE1.fpt'));
    expect(entete.nbEnregistrementsDeclares).toBe(1);
  });

  it("rend cheminMemo=null en l'absence de .fpt", async () => {
    const chemin = join(rep, 'SANSMEMO.DBF');
    await ecrireDbf(chemin, {
      champs: [{ nom: 'X', type: 'N', longueur: 5 }],
      enregistrements: [],
    });
    const entete = await analyserEnTeteDbf(chemin);
    expect(entete.cheminMemo).toBeNull();
  });

  it("lève ErreurEnTeteDbfInvalide sur un fichier qui n'est pas un DBF", async () => {
    const { writeFile } = await import('node:fs/promises');
    const chemin = join(rep, 'PASDBF.DBF');
    await writeFile(chemin, Buffer.from('ceci nest pas un dbf, juste du texte arbitraire'));
    await expect(analyserEnTeteDbf(chemin)).rejects.toThrow(ErreurEnTeteDbfInvalide);
  });

  it("déduit l'encodage depuis l'octet page de code de l'en-tête (0x03 -> cp1252)", async () => {
    const chemin = join(rep, 'CP1252.DBF');
    await ecrireDbf(chemin, {
      champs: [{ nom: 'X', type: 'C', longueur: 5 }],
      enregistrements: [],
      octetPageDeCode: 0x03,
    });
    const entete = await analyserEnTeteDbf(chemin);
    expect(entete.encodage).toBe('cp1252');
  });

  it("ne lit que la zone d'en-tête, jamais le corps de la table (I/O bornée)", async () => {
    const chemin = join(rep, 'GROSSE.DBF');
    const enregistrements = Array.from({ length: 5000 }, (_, i) => ({ valeurs: { X: i } }));
    await ecrireDbf(chemin, { champs: [{ nom: 'X', type: 'N', longueur: 10 }], enregistrements });

    const fsPromises = await import('node:fs/promises');
    const stat = await fsPromises.stat(chemin);
    const entete = await analyserEnTeteDbf(chemin);
    // Preuve indirecte : la taille d'en-tête rendue est très inférieure à la taille du fichier
    // (50 000+ octets de données), donc l'implémentation ne peut pas avoir chargé le corps.
    expect(entete.tailleEntete).toBeLessThan(stat.size / 10);
  });
});
