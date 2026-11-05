#!/usr/bin/env -S pnpm --filter @dfa/api exec tsx
/**
 * CLI — construit un jeu de test réduit à partir d'une archive de test privée (par exemple une
 * extraction locale d'un DMS tiers comme Auto-i) : un sous-ensemble assez petit pour être rejoué
 * plusieurs fois, mais fait de vraies données de garage (pas une fabrication).
 *
 * Le ou les fichiers à zipper sont OBLIGATOIRES (`--fichier`) : aucune valeur par défaut. Les
 * originaux sont lus en lecture seule ; la sortie est écrite par défaut sous
 * `$TMPDIR/dfa-reprise-jeux-test/`, jamais dans le dépôt (une archive de test privée peut contenir
 * des données personnelles — nLPD : elle ne doit jamais entrer dans un historique git).
 *
 * USAGE :
 *   tsx construire-jeu-reduit-source.ts --fichier <chemin> [--fichier <chemin>]... [--sortie <dossier>] [--nom <base>]
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { creerArchiveZip } from './lib/zip';

function argumentsMultiples(nom: string): string[] {
  const resultats: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${nom}`) {
      const v = process.argv[i + 1];
      if (v) resultats.push(v);
    }
  });
  return resultats;
}
function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const fichiers = argumentsMultiples('fichier');
  if (fichiers.length === 0) {
    process.stderr.write(
      'Argument obligatoire manquant : --fichier <chemin> (au moins un fichier de l’archive de test privée).\n',
    );
    process.exitCode = 2;
    return;
  }
  const sourcesReelles = fichiers;
  const sortie = argument('sortie') ?? join(tmpdir(), 'dfa-reprise-jeux-test');
  const nom = argument('nom') ?? 'jeu-reduit-autoi';

  const { existsSync } = await import('node:fs');
  for (const f of sourcesReelles) {
    if (!existsSync(f)) {
      process.stderr.write(
        `Introuvable : ${f}\n` +
          `Cette archive de test privée vit hors du dépôt (lecture seule). Pointer --fichier vers ` +
          `l'extraction locale (voir docs/reprise/ pour la procédure d'extraction sélective ` +
          `par unzip/mdb-tools).\n`,
      );
      process.exitCode = 2;
      return;
    }
  }

  const { mkdirSync } = await import('node:fs');
  mkdirSync(sortie, { recursive: true });
  const cheminZip = join(sortie, `${nom}.zip`);
  const resultat = await creerArchiveZip(cheminZip, sourcesReelles);
  process.stdout.write(`${JSON.stringify(resultat, null, 2)}\n`);
}

main().catch((erreur: unknown) => {
  const message = erreur instanceof Error ? (erreur.stack ?? erreur.message) : String(erreur);
  process.stderr.write(`Échec : ${message}\n`);
  process.exitCode = 1;
});
