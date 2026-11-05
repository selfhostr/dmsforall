/**
 * I/O fichier pour l'upload par tranches — en flux, jamais un chargement intégral en mémoire :
 * une archive complète de DMS peut peser des dizaines de Go, un `readFileSync` la ferait exploser en RAM.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';

export async function tailleFichier(chemin: string): Promise<number> {
  return (await stat(chemin)).size;
}

export async function sha256Fichier(chemin: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const flux = createReadStream(chemin);
    flux.on('data', (m) => hash.update(m));
    flux.on('end', () => resolve());
    flux.on('error', reject);
  });
  return hash.digest('hex');
}

/** Lit UNE tranche (positionnelle, pas de curseur partagé) — sûr à appeler en boucle séquentielle
 *  sur un très gros fichier sans jamais garder plus d'une tranche en mémoire à la fois. */
export async function lireTranche(
  chemin: string,
  offset: number,
  longueur: number,
): Promise<Buffer> {
  const fd = await open(chemin, 'r');
  try {
    const tampon = Buffer.alloc(longueur);
    const { bytesRead } = await fd.read(tampon, 0, longueur, offset);
    return tampon.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}
