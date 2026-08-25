import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { ErreurDelaiDepasseProcessus } from '../erreurs';

/**
 * Sous-ensemble de `ChildProcess` dont cette bibliothèque a besoin — assez étroit pour être
 * substitué en test sans dépendre d'un vrai sous-processus `mdbtools`.
 */
export interface ProcessusExecute {
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(evenement: 'error', gestionnaire: (erreur: NodeJS.ErrnoException) => void): void;
  on(evenement: 'close', gestionnaire: (code: number | null) => void): void;
  /** Optionnel : permet de couper le sous-processus (sortie anticipée d'échantillonnage OU
   *  dépassement de délai — voir `tuerProcessusAvecEscalade` ci-dessous). Signal facultatif : la
   *  fabrique RÉELLE (`ChildProcess.kill`) l'accepte ; `SIGTERM` est le défaut Node si omis. */
  kill?(signal?: NodeJS.Signals): void;
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
 * Délai dur par défaut pour une commande COURTE (`mdb-tables`, `mdb-schema`, `--version`) —
 * jamais utilisé pour l'export de table (`lireLignesAccess`, délai propre : inactivité + plafond
 * absolu, voir `lecteur-access.ts`). MESURÉ, pas deviné : `mdb-tables -1` sur une base Access
 * RÉELLE de 1,4 Go a rendu la main en 25 ms — ces commandes lisent des MÉTADONNÉES (catalogue de
 * tables/schéma), jamais le contenu des lignes, donc leur durée est indépendante du volume de
 * données. 30 s laisse une marge de plus de 1000× sur le temps mesuré tout en bornant strictement
 * un blocage (fichier `.mdb` forgé qui fait boucler `mdbtools` avant même de lister quoi que ce
 * soit).
 */
export const DELAI_MAX_COMMANDE_COURTE_MS = 30_000;

/** Délai de grâce entre `SIGTERM` et `SIGKILL` — laisse à `mdbtools` une chance de se terminer
 *  proprement (fermeture de fichier) avant la terminaison forcée. */
const DELAI_ESCALADE_SIGKILL_MS = 5_000;

/** `SIGTERM` immédiat, `SIGKILL` après un court délai de grâce si le processus n'a pas obéi —
 *  un sous-processus qui ignore `SIGTERM` (boucle serrée en espace utilisateur, par exemple) ne
 *  doit jamais survivre à la terminaison. */
function tuerProcessusAvecEscalade(processus: ProcessusExecute): void {
  processus.kill?.('SIGTERM');
  const minuteurSigkill = setTimeout(() => processus.kill?.('SIGKILL'), DELAI_ESCALADE_SIGKILL_MS);
  minuteurSigkill.unref?.();
}

/**
 * Exécute une commande courte et capture intégralement sa sortie (mdb-tables, mdb-schema,
 * --version) — jamais utilisée pour l'export de table, dont la sortie peut être énorme.
 *
 * BORNÉE DANS LE TEMPS (`delaiMaxMs`) — sans quoi un fichier `.mdb` forgé qui fait boucler
 * `mdbtools` occupe un slot de worker BullMQ indéfiniment, bloquant la file pour TOUS les tenants
 * (finding sécurité, voir `DELAI_MAX_COMMANDE_COURTE_MS`). Le sous-processus est explicitement
 * terminé (`tuerProcessusAvecEscalade`) avant que la promesse ne soit rejetée — jamais un simple
 * abandon logique qui laisserait le processus tourner en arrière-plan.
 */
export async function executerCommandeCapturee(
  fabrique: FabriqueProcessus,
  commande: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  delaiMaxMs: number = DELAI_MAX_COMMANDE_COURTE_MS,
): Promise<SortieCommande> {
  return new Promise((resolve, reject) => {
    let processus: ProcessusExecute;
    try {
      processus = fabrique(commande, args, { env });
    } catch (erreur) {
      reject(erreur);
      return;
    }

    let delaiDepasse = false;
    const minuteurDelai = setTimeout(() => {
      delaiDepasse = true;
      tuerProcessusAvecEscalade(processus);
      reject(new ErreurDelaiDepasseProcessus(commande, args.join(' '), 'absolu', delaiMaxMs));
    }, delaiMaxMs);
    minuteurDelai.unref?.();

    const morceauxStdout: Buffer[] = [];
    const morceauxStderr: Buffer[] = [];
    processus.stdout.on('data', (d: Buffer) => morceauxStdout.push(d));
    processus.stderr.on('data', (d: Buffer) => morceauxStderr.push(d));
    processus.on('error', (erreur) => {
      if (delaiDepasse) return; // déjà rejeté par le délai — ne pas rejeter une seconde fois
      clearTimeout(minuteurDelai);
      reject(erreur);
    });
    processus.on('close', (code) => {
      if (delaiDepasse) return; // déjà rejeté par le délai — ne pas résoudre après coup
      clearTimeout(minuteurDelai);
      resolve({
        stdout: Buffer.concat(morceauxStdout),
        stderr: Buffer.concat(morceauxStderr),
        codeSortie: code,
      });
    });
  });
}
