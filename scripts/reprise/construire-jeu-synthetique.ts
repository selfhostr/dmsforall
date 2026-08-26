#!/usr/bin/env -S pnpm --filter @dfa/api exec tsx
/**
 * CLI — construit le jeu de test SYNTHÉTIQUE (voir `lib/jeu-synthetique.ts` pour le détail et
 * l'arbitrage nLPD qui justifie de ne PAS partir des CSV réels de @laupernoe).
 *
 * USAGE :
 *   pnpm --filter @dfa/api exec tsx /chemin/vers/dmsforall/scripts/reprise/construire-jeu-synthetique.ts \
 *     [--sortie <dossier>] [--clients N] [--vehicules N] [--factures N] [--graine N]
 *
 * Défaut `--sortie` : `$TMPDIR/dfa-reprise-jeux-test` (jamais dans le dépôt ni sous
 * `/chemin/vers/echantillons/` — l'un est versionné, l'autre est en lecture seule pour ce chantier).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ecrireJeuSynthetique } from './lib/jeu-synthetique';

function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const sortie = argument('sortie') ?? join(tmpdir(), 'dfa-reprise-jeux-test');
  const resultat = await ecrireJeuSynthetique(sortie, {
    nbClients: argument('clients') ? Number(argument('clients')) : undefined,
    nbVehicules: argument('vehicules') ? Number(argument('vehicules')) : undefined,
    nbFactures: argument('factures') ? Number(argument('factures')) : undefined,
    graine: argument('graine') ? Number(argument('graine')) : undefined,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        cheminZip: resultat.cheminZip,
        tailleOctets: resultat.tailleOctets,
        sha256: resultat.sha256,
        nbClients: resultat.nbClients,
        nbVehicules: resultat.nbVehicules,
        nbFactures: resultat.nbFactures,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((erreur: unknown) => {
  const message = erreur instanceof Error ? (erreur.stack ?? erreur.message) : String(erreur);
  process.stderr.write(`Échec : ${message}\n`);
  process.exitCode = 1;
});
