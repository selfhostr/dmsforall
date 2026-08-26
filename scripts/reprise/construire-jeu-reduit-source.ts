#!/usr/bin/env -S pnpm --filter @dfa/api exec tsx
/**
 * CLI — construit le jeu de test « réel réduit » : un sous-ensemble de la VRAIE archive Auto-i de
 * @laupernoe (2,4 Go), assez petit pour être rejoué plusieurs fois sans y passer la journée, mais toujours
 * de vraies données de garage (pas une fabrication).
 *
 * PAR DÉFAUT, un seul fichier : `AutoI/RepAw.backup` (242 Mo) — mesuré (`analyse/verification-
 * auto-i/verification.md`) comme le SEUL fichier des 10 de l'archive à porter les tables métier
 * (`Kunden`, `Verkauf`, `Bewertungen`, 104 tables au total). `AutoI/Autoi.mdb` (1,33 Go, la majeure
 * partie du poids total) est un catalogue tiers SANS donnée garage (même source), exclu par
 * défaut — l'inclure ferait dix fois grossir l'archive de test pour zéro ligne de client en plus.
 *
 * SOURCE EN LECTURE SEULE, SORTIE JAMAIS SOUS `/chemin/vers/echantillons/` — ce chantier n'a que la
 * lecture sur les originaux de @laupernoe (§ périmètre de la mission). Écrit par défaut sous
 * `$TMPDIR/dfa-reprise-jeux-test/`, jamais dans le dépôt (l'archive contient de VRAIES données
 * personnelles d'un client réel de @laupernoe — nLPD : elle ne doit jamais entrer dans un historique git).
 *
 * USAGE :
 *   tsx construire-jeu-reduit-source.ts [--fichier <chemin>]... [--sortie <dossier>] [--nom <base>]
 *
 * Sans `--fichier`, utilise le chemin par défaut ci-dessous — à adapter via `--fichier` sur toute
 * machine où l'archive de @laupernoe est ailleurs (§ « documentée pour que n'importe qui la refasse »).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { creerArchiveZip } from './lib/zip';

const FICHIER_PAR_DEFAUT = '/chemin/vers/echantillons/travail/auto-i/AutoI/RepAw.backup';

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
  const sourcesReelles = fichiers.length > 0 ? fichiers : [FICHIER_PAR_DEFAUT];
  const sortie = argument('sortie') ?? join(tmpdir(), 'dfa-reprise-jeux-test');
  const nom = argument('nom') ?? 'jeu-reduit-autoi';

  const { existsSync } = await import('node:fs');
  for (const f of sourcesReelles) {
    if (!existsSync(f)) {
      process.stderr.write(
        `Introuvable : ${f}\n` +
          `Cette archive vit hors du dépôt (originaux de @laupernoe, lecture seule). Sur une autre ` +
          `machine, pointer --fichier vers l'extraction locale équivalente ` +
          `(voir docs/reprise/ pour la procédure d'extraction sélective par unzip/mdb-tools).\n`,
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
