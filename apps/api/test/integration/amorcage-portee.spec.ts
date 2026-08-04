/**
 * `JETON_DB_AMORCAGE` (contrat gelé §2.8) donne accès à `AccesAmorcage`, les 6 SEULES
 * opérations autorisées à travailler HORS contexte tenant. Sa portée doit rester strictement
 * limitée à src/db/ (qui le définit) et src/auth/ (le seul module qui a le droit de s'en
 * servir, via DbAmorcageModule — non global, importé uniquement par AuthModule). N'importe quel
 * autre module qui l'importerait pourrait contourner le RLS par accident : ce test parcourt le
 * système de fichiers pour l'interdire structurellement, pas seulement par convention.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// Module CommonJS : `__dirname` est fourni par le runtime, pas besoin de `import.meta.url`.
const RACINE_SRC = path.resolve(__dirname, '../../src');
const DOSSIERS_AUTORISES = [path.join(RACINE_SRC, 'db'), path.join(RACINE_SRC, 'auth')];

function listerFichiersTypeScript(dossier: string): string[] {
  const resultats: string[] = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules') continue;
    const cheminComplet = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      resultats.push(...listerFichiersTypeScript(cheminComplet));
    } else if (entree.isFile() && (entree.name.endsWith('.ts') || entree.name.endsWith('.tsx'))) {
      resultats.push(cheminComplet);
    }
  }
  return resultats;
}

describe("portée du jeton d'amorçage JETON_DB_AMORCAGE", () => {
  it("aucun fichier de src/ en dehors de src/db/ et src/auth/ n'importe ou ne référence JETON_DB_AMORCAGE", () => {
    if (!existsSync(RACINE_SRC)) {
      throw new Error(
        `${RACINE_SRC} n'existe pas encore — ce test suppose que apps/api/src/ a été initialisé.`,
      );
    }

    const fichiers = listerFichiersTypeScript(RACINE_SRC);
    const infractions: string[] = [];

    for (const fichier of fichiers) {
      const estDansUnDossierAutorise = DOSSIERS_AUTORISES.some((dossier) =>
        fichier.startsWith(dossier + path.sep),
      );
      if (estDansUnDossierAutorise) continue;

      const contenu = readFileSync(fichier, 'utf8');
      if (contenu.includes('JETON_DB_AMORCAGE')) {
        infractions.push(path.relative(RACINE_SRC, fichier));
      }
    }

    expect(infractions).toEqual([]);
  });
});
