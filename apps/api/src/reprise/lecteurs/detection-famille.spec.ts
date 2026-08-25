import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detecterFamilleRepertoire, sniffFamilleFichier } from './detection-famille';
import { construireDbf } from './fixtures/constructeur-dbf';

function tamponAccess(signature: 'Standard Jet DB' | 'Standard ACE DB'): Buffer {
  const tampon = Buffer.alloc(64);
  tampon.writeUInt8(0x00, 0);
  tampon.writeUInt8(0x01, 1);
  Buffer.from(signature + '\0', 'latin1').copy(tampon, 4);
  return tampon;
}

describe('sniffFamilleFichier (pure, sur en-tête)', () => {
  it('reconnaît la signature Jet3/Jet4 ("Standard Jet DB")', () => {
    expect(sniffFamilleFichier(tamponAccess('Standard Jet DB'))).toBe('access');
  });

  it('reconnaît la signature ACE (.accdb, "Standard ACE DB")', () => {
    expect(sniffFamilleFichier(tamponAccess('Standard ACE DB'))).toBe('access');
  });

  it('reconnaît un en-tête DBF valide', () => {
    const { dbf } = construireDbf({
      champs: [{ nom: 'X', type: 'C', longueur: 10 }],
      enregistrements: [],
    });
    expect(sniffFamilleFichier(dbf)).toBe('foxpro-dbase');
  });

  it("rend 'inconnu' pour un binaire arbitraire, sans lever d'exception", () => {
    expect(sniffFamilleFichier(Buffer.alloc(200, 0x7a))).toBe('inconnu');
  });

  it("rend 'inconnu' pour un tampon vide", () => {
    expect(sniffFamilleFichier(Buffer.alloc(0))).toBe('inconnu');
  });
});

describe('detecterFamilleRepertoire (I/O, sur un répertoire décompressé)', () => {
  let rep: string;

  beforeEach(async () => {
    rep = await mkdtemp(join(tmpdir(), 'dfa-famille-'));
  });

  afterEach(async () => {
    await rm(rep, { recursive: true, force: true });
  });

  it("reconnaît une base Access dont l'extension ne le laisse pas deviner (cas mesuré : RepAw.backup)", async () => {
    await writeFile(join(rep, 'RepAw.backup'), tamponAccess('Standard Jet DB'));
    const resultat = await detecterFamilleRepertoire(rep);
    expect(resultat.famille).toBe('access');
    expect(resultat.fichiersPertinents).toContain('RepAw.backup');
  });

  it('reconnaît des tables DBF sous une extension trompeuse, en profondeur', async () => {
    await mkdir(join(rep, 'donnees', 'export'), { recursive: true });
    const chemin = join(rep, 'donnees', 'export', 'CLIENTS.DAT');
    const { dbf } = construireDbf({
      champs: [{ nom: 'NOM', type: 'C', longueur: 20 }],
      enregistrements: [],
    });
    await writeFile(chemin, dbf);

    const resultat = await detecterFamilleRepertoire(rep);
    expect(resultat.famille).toBe('foxpro-dbase');
    expect(resultat.fichiersPertinents).toContain(join('donnees', 'export', 'CLIENTS.DAT'));
  });

  it("rend 'inconnu' quand rien ne ressemble à un en-tête Access ou DBF (cas normal, pas une erreur)", async () => {
    await writeFile(join(rep, 'notice.txt'), 'Ceci est un fichier texte quelconque, sans rapport.');
    await writeFile(join(rep, 'photo.bin'), Buffer.alloc(500, 0x11));
    const resultat = await detecterFamilleRepertoire(rep);
    expect(resultat.famille).toBe('inconnu');
    expect(resultat.fichiersPertinents).toEqual([]);
  });

  it('donne priorité à Access quand les deux familles cohabitent dans la même archive', async () => {
    await writeFile(join(rep, 'BASE.MDB'), tamponAccess('Standard Jet DB'));
    const { dbf } = construireDbf({
      champs: [{ nom: 'X', type: 'N', longueur: 5 }],
      enregistrements: [],
    });
    await writeFile(join(rep, 'RESIDU.DBF'), dbf);

    const resultat = await detecterFamilleRepertoire(rep);
    expect(resultat.famille).toBe('access');
  });

  it('la raison rendue est lisible et cite le nombre de fichiers en preuve', async () => {
    await writeFile(join(rep, 'BASE.MDB'), tamponAccess('Standard Jet DB'));
    const resultat = await detecterFamilleRepertoire(rep);
    expect(resultat.raison).toMatch(/1 fichier/);
  });
});
