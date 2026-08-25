import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

/**
 * Sous-ensemble de `ChildProcess` dont cette bibliothèque a besoin — assez étroit pour être
 * substitué en test sans dépendre d'un vrai sous-processus `mdbtools`.
 */
export interface ProcessusExecute {
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(evenement: 'error', gestionnaire: (erreur: NodeJS.ErrnoException) => void): void;
  on(evenement: 'close', gestionnaire: (code: number | null) => void): void;
  /** Optionnel : permet de couper le sous-processus sur sortie anticipée (échantillonnage). */
  kill?(): void;
}

export type FabriqueProcessus = (
  commande: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => ProcessusExecute;

/** Fabrique par défaut : un vrai sous-processus (`mdb-tables`, `mdb-export`, ...). */
export const fabriqueProcessusReelle: FabriqueProcessus = (commande, args, options) =>
  spawn(commande, args, { env: options.env }) as unknown as ProcessusExecute;

export interface SortieCommande {
  stdout: Buffer;
  stderr: Buffer;
  codeSortie: number | null;
}

/**
 * Exécute une commande courte et capture intégralement sa sortie (mdb-tables, mdb-schema,
 * --version) — jamais utilisée pour l'export de table, dont la sortie peut être énorme.
 */
export async function executerCommandeCapturee(
  fabrique: FabriqueProcessus,
  commande: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<SortieCommande> {
  return new Promise((resolve, reject) => {
    let processus: ProcessusExecute;
    try {
      processus = fabrique(commande, args, { env });
    } catch (erreur) {
      reject(erreur);
      return;
    }
    const morceauxStdout: Buffer[] = [];
    const morceauxStderr: Buffer[] = [];
    processus.stdout.on('data', (d: Buffer) => morceauxStdout.push(d));
    processus.stderr.on('data', (d: Buffer) => morceauxStderr.push(d));
    processus.on('error', reject);
    processus.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(morceauxStdout),
        stderr: Buffer.concat(morceauxStderr),
        codeSortie: code,
      });
    });
  });
}
