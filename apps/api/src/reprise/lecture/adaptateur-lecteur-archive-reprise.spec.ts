/**
 * Preuve d'assemblage RÉEL de `AdaptateurLecteurArchiveReprise` — vraie décompression ZIP (via
 * `yazl` pour construire les fixtures, `yauzl` côté adaptateur), vrais fichiers `.dbf` sur disque
 * (`lecteurs/fixtures/constructeur-dbf.ts`), vraie lecture/comptage/évaluation de rôle. Contrairement
 * à `AdaptateurLecteurArchiveRepriseFactice` (rejeu en mémoire, réservé aux tests du reste du
 * module), ce fichier prouve que l'adaptateur RÉEL fonctionne de bout en bout — pas seulement
 * qu'il respecte l'interface du port.
 */

import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import { construireDbf, type OptionsConstructionDbf } from '../lecteurs/fixtures/constructeur-dbf';
import {
  AdaptateurLecteurArchiveReprise,
  estCheminZipDangereux,
  type LimitesExtractionArchiveReprise,
} from './adaptateur-lecteur-archive-reprise';
import { ErreurLimiteExtractionDepassee } from './port-lecteur-archive-reprise';

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

/** Variante qui rend AUSSI `racineTravail` — nécessaire aux tests de purge (finding sécurité
 *  HAUTE) qui doivent inspecter/manipuler directement le disque sous la racine. */
async function nouvelAdaptateurAvecRacine(
  limites: LimitesExtractionArchiveReprise = {},
): Promise<{ adaptateur: AdaptateurLecteurArchiveReprise; racineTravail: string }> {
  const racineTravail = await mkdtemp(join(tmpdir(), 'dfa-reprise-travail-'));
  racinesAEffacer.push(racineTravail);
  return { adaptateur: new AdaptateurLecteurArchiveReprise(racineTravail, limites), racineTravail };
}

async function existe(chemin: string): Promise<boolean> {
  try {
    await stat(chemin);
    return true;
  } catch {
    return false;
  }
}

/** Un buffer très compressible (répétition d'un seul octet) — utile pour dépasser une limite
 *  d'octets EXTRAITS avec une archive COMPRESSÉE minuscule. */
function bufferCompressible(tailleOctets: number): Buffer {
  return Buffer.alloc(tailleOctets, 'A');
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

  /**
   * ANOMALIE RÉELLE mesurée le 26.08.2026 sur l'archive Auto-i de @laupernoe (`RepAw.backup`, base Access
   * valide de 242 Mo SANS extension `.mdb`/`.accdb`) : la branche 'access' de `listerTables`
   * gardait sur l'EXTENSION du fichier avant même de sonder son contenu — violant la doctrine
   * documentée juste à côté (`lecteurs/detection-famille.ts`, qui cite EXPLICITEMENT ce même
   * fichier comme raison de reconnaître la famille « toujours sur le contenu, jamais sur
   * l'extension »). Conséquence mesurée en conditions réelles : `listerTables` rendait `[]` SANS
   * jamais invoquer `mdb-tables`, donc sans la moindre erreur remontée — un fichier Access
   * parfaitement lisible disparaissait silencieusement de l'analyse (et faisait échouer le dossier
   * entier si c'était le seul fichier de l'archive).
   *
   * `mdb-tables` (RÉEL, aucun mock — comme le reste de ce fichier) sert ici de sonde indirecte :
   * un en-tête Jet valide mais un corps délibérément invalide fait ÉCHOUER `mdb-tables` (code de
   * sortie non nul, prouvé en exécution) plutôt que de rendre une liste vide — la seule façon
   * d'observer, sans mock, que le contenu a bien été SONDÉ ET SOUMIS à `mdb-tables` malgré une
   * extension qui n'est ni `.mdb` ni `.accdb`.
   */
  it("listerTables (famille access_jet) : sonde le CONTENU, jamais l'extension — un en-tête Jet valide sous une extension quelconque atteint mdb-tables (erreur RÉELLE remontée, jamais un [] silencieux) ; un .mdb sans signature Jet reste ignoré ([])", async () => {
    const enteteJetValide = Buffer.alloc(4096);
    enteteJetValide.write('Standard Jet DB', 4, 'latin1'); // signature seule — corps délibérément invalide

    const cheminZip = await construireZip([
      { chemin: 'AutoI/RepAw.backup', contenu: enteteJetValide },
      {
        chemin: 'AutoI/FAUX.mdb',
        contenu: Buffer.from('ceci ne contient aucune signature Jet/ACE'),
      },
    ]);
    const adaptateur = await nouvelAdaptateur();
    const { repertoire, fichiers } = await adaptateur.extraireEtInventorier(cheminZip);
    racinesAEffacer.push(repertoire);

    const backup = fichiers.find((f) => f.chemin.endsWith('RepAw.backup'))!;
    const fauxMdb = fichiers.find((f) => f.chemin.endsWith('FAUX.mdb'))!;

    // Extension .backup, signature Jet valide : le contenu est sondé, mdb-tables est RÉELLEMENT
    // invoqué, son échec (corps invalide) remonte comme une erreur explicite — jamais un [] muet.
    await expect(adaptateur.listerTables(backup.chemin, 'access_jet')).rejects.toThrow();

    // Extension .mdb, aucune signature Jet : toujours ignoré sans appeler mdb-tables — la garde
    // par contenu ne fait pas régresser le cas où l'extension trompeuse ne suffit pas non plus.
    expect(await adaptateur.listerTables(fauxMdb.chemin, 'access_jet')).toEqual([]);
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

describe('purgerRepertoireExtrait — nettoyage immédiat (finding sécurité HAUTE, nLPD)', () => {
  it("supprime réellement le répertoire d'extraction du disque", async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(3) }]);
    const { adaptateur } = await nouvelAdaptateurAvecRacine();
    const { repertoire } = await adaptateur.extraireEtInventorier(cheminZip);

    expect(await existe(repertoire)).toBe(true);
    await adaptateur.purgerRepertoireExtrait(repertoire);
    expect(await existe(repertoire)).toBe(false);
  });

  it('est idempotente — un second appel sur un répertoire déjà purgé ne lève pas', async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(1) }]);
    const { adaptateur } = await nouvelAdaptateurAvecRacine();
    const { repertoire } = await adaptateur.extraireEtInventorier(cheminZip);

    await adaptateur.purgerRepertoireExtrait(repertoire);
    await expect(adaptateur.purgerRepertoireExtrait(repertoire)).resolves.not.toThrow();
  });

  it('refuse (et ne supprime jamais) un chemin hors de la racine de travail — même garde que le zip-slip', async () => {
    const { adaptateur, racineTravail } = await nouvelAdaptateurAvecRacine();
    const cheminHorsRacine = join(tmpdir(), 'dfa-reprise-jamais-touche');
    await expect(adaptateur.purgerRepertoireExtrait(cheminHorsRacine)).rejects.toThrow();
    // Le répertoire ne doit même pas avoir été TENTÉ de création/suppression — vérifie l'absence
    // de tout effet de bord sous la racine légitime.
    expect(await existe(racineTravail)).toBe(true);
  });
});

describe('extraireEtInventorier — bombe de décompression (finding sécurité HAUTE) : abandon propre + nettoyage du résidu partiel', () => {
  it('dépasse la limite d\'OCTETS EXTRAITS (archive compressée minuscule, sortie décompressée énorme relativement au seuil de test) : ErreurLimiteExtractionDepassee, type "octets_extraits", répertoire nettoyé', async () => {
    const cheminZip = await construireZip([
      { chemin: 'GROS.BIN', contenu: bufferCompressible(200_000) },
    ]);
    const { adaptateur, racineTravail } = await nouvelAdaptateurAvecRacine({
      octetsExtraitsMax: 1_000,
    });

    let erreurCapturee: unknown;
    try {
      await adaptateur.extraireEtInventorier(cheminZip);
    } catch (erreur) {
      erreurCapturee = erreur;
    }

    expect(erreurCapturee).toBeInstanceOf(ErreurLimiteExtractionDepassee);
    expect((erreurCapturee as ErreurLimiteExtractionDepassee).type).toBe('octets_extraits');

    // Aucun résidu — ni le répertoire d'extraction partiel, ni rien d'autre sous la racine.
    expect(await readdir(racineTravail)).toEqual([]);
  });

  it('dépasse la limite du NOMBRE D\'ENTRÉES : ErreurLimiteExtractionDepassee, type "nombre_entrees", répertoire nettoyé', async () => {
    const entrees = Array.from({ length: 6 }, (_, i) => ({
      chemin: `FICHIER_${i}.TXT`,
      contenu: Buffer.from('x', 'utf-8'),
    }));
    const cheminZip = await construireZip(entrees);
    const { adaptateur, racineTravail } = await nouvelAdaptateurAvecRacine({ entreesMax: 3 });

    let erreurCapturee: unknown;
    try {
      await adaptateur.extraireEtInventorier(cheminZip);
    } catch (erreur) {
      erreurCapturee = erreur;
    }

    expect(erreurCapturee).toBeInstanceOf(ErreurLimiteExtractionDepassee);
    expect((erreurCapturee as ErreurLimiteExtractionDepassee).type).toBe('nombre_entrees');

    expect(await readdir(racineTravail)).toEqual([]);
  });

  it('une archive légitime, sous les deux seuils, extrait normalement (pas de faux positif)', async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(5) }]);
    const { adaptateur } = await nouvelAdaptateurAvecRacine({
      octetsExtraitsMax: 10_000_000,
      entreesMax: 100,
    });

    const { fichiers } = await adaptateur.extraireEtInventorier(cheminZip);
    expect(fichiers).toHaveLength(1);
    expect(fichiers[0]!.lisible).toBe(true);
  });
});

describe('extraireEtInventorier / purgerRepertoireExtrait — cycle complet succès ET échec (preuve du `finally` des appelants)', () => {
  it("un traitement RÉUSSI : le répertoire n'existe plus une fois purgerRepertoireExtrait appelé", async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(2) }]);
    const { adaptateur } = await nouvelAdaptateurAvecRacine();

    const { repertoire } = await adaptateur.extraireEtInventorier(cheminZip);
    try {
      // "traitement" quelconque réussi — même patron que service-analyse-reprise.ts/
      // service-import-reprise.ts : le répertoire est utilisé PUIS purgé dans un `finally`.
      await readFile(join(repertoire, 'CLIENTS.DBF'));
    } finally {
      await adaptateur.purgerRepertoireExtrait(repertoire);
    }

    expect(await existe(repertoire)).toBe(false);
  });

  it("un traitement en ÉCHEC (exception levée après extraction) : le répertoire n'existe plus non plus — le `finally` purge dans les deux cas", async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(2) }]);
    const { adaptateur } = await nouvelAdaptateurAvecRacine();

    const { repertoire } = await adaptateur.extraireEtInventorier(cheminZip);
    await expect(
      (async () => {
        try {
          throw new Error('panne simulée pendant le traitement (analyse/import)');
        } finally {
          await adaptateur.purgerRepertoireExtrait(repertoire);
        }
      })(),
    ).rejects.toThrow('panne simulée');

    expect(await existe(repertoire)).toBe(false);
  });
});

describe('Balayage des résidus de PLANTAGE (purgerResidusAnciens, appelée en tête de chaque extraireEtInventorier)', () => {
  it('un résidu plus vieux que le seuil est supprimé au passage suivant ; un résidu récent est conservé', async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(1) }]);
    const { adaptateur } = await nouvelAdaptateurAvecRacine({
      dureeMaxResiduMs: 50,
    });

    // Premier « plantage » : extraction jamais purgée (simule une mort du process worker).
    const { repertoire: repertoireOrphelin } = await adaptateur.extraireEtInventorier(cheminZip);
    // Vieillit artificiellement le répertoire au-delà du seuil (50 ms) — sans dépendre d'un vrai
    // `sleep` dans le test.
    const dateAncienne = new Date(Date.now() - 10_000);
    await utimes(repertoireOrphelin, dateAncienne, dateAncienne);

    // Une activité normale, plus tard : le balayage en tête d'extraireEtInventorier doit
    // supprimer le résidu orphelin AVANT de créer le nouveau répertoire.
    const { repertoire: repertoireFrais } = await adaptateur.extraireEtInventorier(cheminZip);

    expect(await existe(repertoireOrphelin)).toBe(false);
    expect(await existe(repertoireFrais)).toBe(true);

    await adaptateur.purgerRepertoireExtrait(repertoireFrais);
  });
});

describe('onModuleInit (purge INCONDITIONNELLE au redémarrage, défaut 25.08.2026)', () => {
  it('un résidu TOUT FRAIS (donc jamais atteint par le seuil de 24h) est quand même purgé au redémarrage', async () => {
    const cheminZip = await construireZip([{ chemin: 'CLIENTS.DBF', contenu: dbfClients(1) }]);
    const { adaptateur, racineTravail } = await nouvelAdaptateurAvecRacine();

    // Simule un plantage : extraction jamais purgée par le `finally` de l'appelant (mort du
    // process). AUCUN vieillissement artificiel ici — contrairement au test précédent, cette
    // purge doit fonctionner MÊME pour un résidu créé il y a quelques secondes : au redémarrage,
    // aucune extraction n'est légitimement en cours pour CE process.
    const { repertoire: repertoireOrphelin } = await adaptateur.extraireEtInventorier(cheminZip);

    // Nouvelle instance sur la MÊME racine disque — simule le redémarrage du process (racine
    // partagée entre deux "vies" du process, pas une racine isolée).
    const adaptateurRedemarre = new AdaptateurLecteurArchiveReprise(racineTravail);
    await adaptateurRedemarre.onModuleInit();

    expect(await existe(repertoireOrphelin)).toBe(false);
  });

  it("racine d'extraction pas encore créée (premier démarrage) -> ne plante jamais", async () => {
    const racineParente = await mkdtemp(join(tmpdir(), 'dfa-reprise-travail-'));
    racinesAEffacer.push(racineParente);
    const racineTravail = join(racineParente, 'jamais-cree');
    const adaptateur = new AdaptateurLecteurArchiveReprise(racineTravail);
    await expect(adaptateur.onModuleInit()).resolves.toBeUndefined();
  });
});
