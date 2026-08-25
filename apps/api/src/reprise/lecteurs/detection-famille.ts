import { open, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { FamilleMoteur, ResultatDetectionFamille } from './types';
import { analyserEnTeteDepuisTampon } from './dbf/en-tete-dbf';

/**
 * Reconnaissance de la famille de moteur — toujours sur le contenu binaire, jamais sur
 * l'extension du fichier. Cas mesuré qui a guidé ce choix : un fichier nommé `RepAw.backup`
 * était une base Access parfaitement valide.
 */
const SIGNATURES_ACCESS = ['Standard Jet DB', 'Standard ACE DB'];
const OFFSET_SIGNATURE_ACCESS = 4;
const TAILLE_SONDE = 8192; // couvre l'en-tête + la zone de champs de la grande majorité des DBF réels
const NB_FICHIERS_PREUVE_MAX = 20;
const PROFONDEUR_MAX = 8;

/**
 * Sonde pure (aucune I/O) : reconnaît la famille depuis un tampon contenant les premiers octets
 * d'un fichier. Rend `inconnu` sans lever d'exception — un fichier qui n'est ni l'un ni l'autre
 * est un cas normal (autre outil, doc, image, ...), pas une erreur.
 */
export function sniffFamilleFichier(tampon: Buffer): FamilleMoteur {
  if (tampon.length >= OFFSET_SIGNATURE_ACCESS + 15) {
    const zone = tampon
      .subarray(OFFSET_SIGNATURE_ACCESS, OFFSET_SIGNATURE_ACCESS + 16)
      .toString('latin1');
    if (SIGNATURES_ACCESS.some((signature) => zone.startsWith(signature))) return 'access';
  }
  if (analyserEnTeteDepuisTampon(tampon)) return 'foxpro-dbase';
  return 'inconnu';
}

async function listerFichiersRecursif(racine: string): Promise<string[]> {
  const resultats: string[] = [];
  async function parcourir(courant: string, profondeur: number): Promise<void> {
    if (profondeur > PROFONDEUR_MAX) return;
    let entrees;
    try {
      entrees = await readdir(courant, { withFileTypes: true });
    } catch {
      return; // répertoire illisible : ignoré, pas fatal pour le reste de l'archive
    }
    for (const entree of entrees) {
      const chemin = join(courant, entree.name);
      if (entree.isDirectory()) {
        await parcourir(chemin, profondeur + 1);
      } else if (entree.isFile()) {
        resultats.push(chemin);
      }
    }
  }
  await parcourir(racine, 0);
  return resultats;
}

async function lireSonde(chemin: string): Promise<Buffer | null> {
  let fd;
  try {
    fd = await open(chemin, 'r');
  } catch {
    return null;
  }
  try {
    const tampon = Buffer.alloc(TAILLE_SONDE);
    const { bytesRead } = await fd.read(tampon, 0, TAILLE_SONDE, 0);
    return tampon.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await fd.close();
  }
}

/**
 * Reconnaît la famille de moteur sur un répertoire décompressé : lit les premiers octets de
 * chaque fichier (I/O bornée, jamais le corps des tables) et sonde chacun. La présence d'ne
 * serait-ce qu'un seul fichier Access valide suffit à trancher — un dépôt réel mélange souvent
 * les binaires (.exe, .dll) et les vraies tables, la reconnaissance doit être robuste au bruit.
 */
export async function detecterFamilleRepertoire(
  cheminRepertoire: string,
): Promise<ResultatDetectionFamille> {
  const fichiers = await listerFichiersRecursif(cheminRepertoire);
  const preuvesAccess: string[] = [];
  const preuvesDbf: string[] = [];

  for (const chemin of fichiers) {
    const sonde = await lireSonde(chemin);
    if (!sonde) continue;
    const famille = sniffFamilleFichier(sonde);
    if (famille === 'access') preuvesAccess.push(relative(cheminRepertoire, chemin));
    else if (famille === 'foxpro-dbase') preuvesDbf.push(relative(cheminRepertoire, chemin));
  }

  if (preuvesAccess.length > 0) {
    return {
      famille: 'access',
      fichiersPertinents: preuvesAccess.slice(0, NB_FICHIERS_PREUVE_MAX),
      raison: `${preuvesAccess.length} fichier(s) portent la signature Jet/ACE ("Standard Jet DB"/"Standard ACE DB") dans leur en-tête, quelle que soit leur extension.`,
    };
  }
  if (preuvesDbf.length > 0) {
    return {
      famille: 'foxpro-dbase',
      fichiersPertinents: preuvesDbf.slice(0, NB_FICHIERS_PREUVE_MAX),
      raison: `${preuvesDbf.length} fichier(s) ont un en-tête DBF valide (descripteurs de champs cohérents avec la taille d'enregistrement déclarée), quelle que soit leur extension.`,
    };
  }
  return {
    famille: 'inconnu',
    fichiersPertinents: [],
    raison: `aucun des ${fichiers.length} fichier(s) analysés ne présente un en-tête Access ou DBF reconnu`,
  };
}
