/**
 * Preuve d'assemblage RÉEL de `AdaptateurLecteurArchiveReprise` — vraie décompression ZIP (via
 * `yazl` pour construire les fixtures, `yauzl` côté adaptateur), vrais fichiers `.dbf` sur disque
 * (`lecteurs/fixtures/constructeur-dbf.ts`), vraie lecture/comptage/évaluation de rôle. Contrairement
 * à `AdaptateurLecteurArchiveRepriseFactice` (rejeu en mémoire, réservé aux tests du reste du
 * module), ce fichier prouve que l'adaptateur RÉEL fonctionne de bout en bout — pas seulement
 * qu'il respecte l'interface du port.
 */

import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import { construireDbf, type OptionsConstructionDbf } from '../lecteurs/fixtures/constructeur-dbf';
import {
  AdaptateurLecteurArchiveReprise,
  estCheminZipDangereux,
} from './adaptateur-lecteur-archive-reprise';

async function construireZip(
  entrees: readonly { chemin: string; contenu: Buffer }[],
): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), 'dfa-reprise-zip-'));
  const cheminZip = join(racine, 'archive.bin');
  const zip = new ZipFile();
  for (const entree of entrees) {
    zip.addBuffer(entree.contenu, entree.chemin);
  }
  await new Promise<void>((resolveP, rejectP) => {
    const sortie = createWriteStream(cheminZip);
    sortie.on('finish', () => resolveP());
    sortie.on('error', rejectP);
    zip.outputStream.pipe(sortie);
    zip.end();
  });
  return cheminZip;
}

function dbfClients(nbLignes: number): Buffer {
  const options: OptionsConstructionDbf = {
    champs: [
      { nom: 'NOM', type: 'C', longueur: 30 },
      { nom: 'NPA', type: 'C', longueur: 4 },
      { nom: 'EMAIL', type: 'C', longueur: 40 },
    ],
    enregistrements: Array.from({ length: nbLignes }, (_, i) => ({
      valeurs: { NOM: `Client ${i}`, NPA: '1000', EMAIL: `client${i}@exemple.ch` },
    })),
  };
  return construireDbf(options).dbf;
}

let racinesAEffacer: string[] = [];

async function nouvelAdaptateur(): Promise<AdaptateurLecteurArchiveReprise> {
  const racineTravail = await mkdtemp(join(tmpdir(), 'dfa-reprise-travail-'));
  racinesAEffacer.push(racineTravail);
  return new AdaptateurLecteurArchiveReprise(racineTravail);
}

beforeEach(() => {
  racinesAEffacer = [];
});

afterEach(async () => {
  await Promise.all(racinesAEffacer.map((r) => rm(r, { recursive: true, force: true })));
});

describe('AdaptateurLecteurArchiveReprise — extraction ZIP réelle + lecture DBF réelle', () => {
  it('extrait une archive ZIP réelle et inventorie les fichiers avec taille/empreinte réelles', async () => {
    const cheminZip = await construireZip([
      { chemin: 'DATA/CLIENTS.DBF', contenu: dbfClients(10) },
      { chemin: 'LISEZMOI.TXT', contenu: Buffer.from('rien à voir', 'utf-8') },
    ]);
    const adaptateur = await nouvelAdaptateur();

    const { repertoire, fichiers } = await adaptateur.extraireEtInventorier(cheminZip);
    racinesAEffacer.push(repertoire);

    expect(fichiers).toHaveLength(2);
    const dbf = fichiers.find((f) => f.chemin.endsWith('CLIENTS.DBF'))!;
    expect(dbf.lisible).toBe(true);
    expect(dbf.tailleOctets).toBeGreaterThan(0);
    expect(dbf.empreinteSha256).toMatch(/^[0-9a-f]{64}$/);

    const contenuSurDisque = await readFile(dbf.chemin);
    expect(contenuSurDisque.length).toBe(dbf.tailleOctets);
  });

  it('reconnaît la famille foxpro_dbf (contrat, PAS le vocabulaire interne "foxpro-dbase")', async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(5) }]);
    const adaptateur = await nouvelAdaptateur();
    const { repertoire } = await adaptateur.extraireEtInventorier(cheminZip);
    racinesAEffacer.push(repertoire);

    const resultat = await adaptateur.detecterFamille(repertoire);
    expect(resultat.famille).toBe('foxpro_dbf');
  });

  it('listerTables : un .dbf valide rend son nom de table, un fichier non-dbf est ignoré ([])', async () => {
    const cheminZip = await construireZip([
      { chemin: 'CLIENTS.DBF', contenu: dbfClients(3) },
      { chemin: 'NOTES.TXT', contenu: Buffer.from('bruit', 'utf-8') },
    ]);
    const adaptateur = await nouvelAdaptateur();
    const { repertoire, fichiers } = await adaptateur.extraireEtInventorier(cheminZip);
    racinesAEffacer.push(repertoire);

    const dbf = fichiers.find((f) => f.chemin.endsWith('CLIENTS.DBF'))!;
    const txt = fichiers.find((f) => f.chemin.endsWith('NOTES.TXT'))!;

    expect(await adaptateur.listerTables(dbf.chemin, 'foxpro_dbf')).toEqual(['CLIENTS']);
    expect(await adaptateur.listerTables(txt.chemin, 'foxpro_dbf')).toEqual([]);
  });

  it('evaluerRole rend le total RÉEL de lignes actives, pas la taille de l’échantillon', async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(7) }]);
    const adaptateur = await nouvelAdaptateur();
    const { repertoire, fichiers } = await adaptateur.extraireEtInventorier(cheminZip);
    racinesAEffacer.push(repertoire);
    const dbf = fichiers[0]!;

    const rapport = await adaptateur.evaluerRole(dbf.chemin, 'foxpro_dbf', 'CLIENTS');
    expect(rapport.lignesActives).toBe(7);
    expect(rapport.table).toBe('CLIENTS');

    const compte = await adaptateur.compterLignes(dbf.chemin, 'foxpro_dbf', 'CLIENTS');
    expect(compte).toBe(7);
  });

  it('lireLignes rend exactement les valeurs écrites, en flux', async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(2) }]);
    const adaptateur = await nouvelAdaptateur();
    const { repertoire, fichiers } = await adaptateur.extraireEtInventorier(cheminZip);
    racinesAEffacer.push(repertoire);
    const dbf = fichiers[0]!;

    const lignes = [];
    for await (const ligne of adaptateur.lireLignes(dbf.chemin, 'foxpro_dbf', 'CLIENTS')) {
      lignes.push(ligne);
    }
    expect(lignes).toHaveLength(2);
    expect(lignes[0]!.valeurs['NOM']).toBe('Client 0');
    expect(lignes[1]!.valeurs['NOM']).toBe('Client 1');
  });

  describe("estCheminZipDangereux (zip-slip) — testée isolément : yazl refuse lui-même de PRODUIRE un chemin '..'/absolu dans une archive de test, donc impossible de fabriquer une archive malveillante réaliste de bout en bout", () => {
    it.each([
      ['../../evil.dbf', true],
      ['DATA/../../evil.dbf', true],
      ['/etc/passwd', true],
      ['DATA\\..\\..\\evil.dbf', true],
      ['CLIENTS.DBF', false],
      ['DATA/CLIENTS.DBF', false],
      ['DATA/SOUS-DOSSIER/CLIENTS.DBF', false],
    ] as const)('%s -> dangereux=%s', (chemin, attendu) => {
      expect(estCheminZipDangereux(chemin)).toBe(attendu);
    });
  });

  it('choisirCopieFaisantFoi : départage deux fichiers candidats par volume de lignes actives', async () => {
    const cheminZip = await construireZip([
      { chemin: 'COPIE_A/CLIENTS.DBF', contenu: dbfClients(2) },
      { chemin: 'COPIE_B/CLIENTS.DBF', contenu: dbfClients(50) },
    ]);
    const adaptateur = await nouvelAdaptateur();
    const { repertoire, fichiers } = await adaptateur.extraireEtInventorier(cheminZip);
    racinesAEffacer.push(repertoire);

    const candidats = fichiers.map((f) => f.chemin);
    const retenu = await adaptateur.choisirCopieFaisantFoi(candidats);
    expect(retenu).toBe(fichiers.find((f) => f.chemin.includes('COPIE_B'))!.chemin);
  });

  it('choisirCopieFaisantFoi : un seul candidat est rendu tel quel, aucun candidat rend null', async () => {
    const adaptateur = await nouvelAdaptateur();
    expect(await adaptateur.choisirCopieFaisantFoi(['/x/y.dbf'])).toBe('/x/y.dbf');
    expect(await adaptateur.choisirCopieFaisantFoi([])).toBeNull();
  });
});
