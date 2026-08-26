/**
 * Mise en archive ZIP — délègue à `zip(1)` (présent sur la machine, `/usr/bin/zip`) plutôt que de
 * réimplémenter le format : le lecteur de reprise (`yauzl`, voir l'en-tête d'`adaptateur-lecteur-
 * archive-reprise.ts`) lit un ZIP standard, `zip(1)` en écrit un standard, aucune raison d'ajouter
 * un troisième acteur du format entre les deux.
 *
 * DÉTERMINISME (optionnel, `normaliserHorodatage`) — `zip(1)` embarque par défaut l'horodatage
 * MS-DOS de chaque fichier source dans l'archive ; deux exécutions produiraient donc deux ZIP
 * différents octet pour octet même à contenu de table strictement identique. Neutralisable
 * (horodatage fixe posé sur chaque fichier AVANT l'appel à `zip`) : une empreinte SHA-256 stable
 * pour une même graine est un repère utile en documentation. DÉSACTIVÉ PAR DÉFAUT et à laisser
 * ainsi pour tout fichier SOURCE qu'on ne possède pas en écriture légitime — `construire-jeu-
 * reduit-source.ts` zippe directement les originaux de @laupernoe (`/chemin/vers/echantillons/`, lecture
 * seule pour ce chantier) : `utimes()` dessus, même juste pour dater l'archive, en modifierait les
 * métadonnées. Seul `jeu-synthetique.ts` (fichiers dans un répertoire temporaire créé et détruit
 * par ce même appel) l'active.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, stat, utimes } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const HORODATAGE_FIXE = new Date('2020-01-01T00:00:00Z');

export interface ArchiveConstruite {
  readonly cheminZip: string;
  readonly tailleOctets: number;
  readonly sha256: string;
}

async function calculerSha256(chemin: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const flux = createReadStream(chemin);
    flux.on('data', (morceau) => hash.update(morceau));
    flux.on('end', () => resolve());
    flux.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Assemble `fichiers` (chemins absolus) en un ZIP à plat (`-j`, aucune arborescence de dossier
 * dans l'archive — les DMS sources déposent un dossier ou un fichier unique, jamais une hiérarchie
 * significative pour le sniff de famille) à `cheminZip`. Écrase silencieusement une archive
 * existante au même chemin (rejouabilité du harnais).
 */
export async function creerArchiveZip(
  cheminZip: string,
  fichiers: readonly string[],
  options: { normaliserHorodatage?: boolean } = {},
): Promise<ArchiveConstruite> {
  if (fichiers.length === 0) {
    throw new Error('creerArchiveZip : aucun fichier à archiver.');
  }
  if (options.normaliserHorodatage) {
    await Promise.all(fichiers.map((f) => utimes(f, HORODATAGE_FIXE, HORODATAGE_FIXE)));
  }
  await rm(cheminZip, { force: true });
  await execFileP('zip', ['-q', '-j', '-X', cheminZip, ...fichiers]);
  const { size } = await stat(cheminZip);
  const sha256 = await calculerSha256(cheminZip);
  return { cheminZip, tailleOctets: size, sha256 };
}
