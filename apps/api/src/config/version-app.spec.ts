/**
 * Test unitaire colocalisé, propriété expert-devops (`apps/api/src/config/version-app.ts` est
 * dans son périmètre exclusif — repli DÉVELOPPEMENT du calcul de VERSION_APP/VERSION_APP_BRANCHE,
 * voir l'en-tête du module). Utilise de VRAIS dépôts Git temporaires (`mkdtempSync` + `git init`)
 * plutôt que de mocker `execFileSync` : ce module existe précisément pour survivre aux aspérités
 * réelles de Git (HEAD détaché, dépôt absent) — les reproduire pour de vrai est plus fiable qu'un
 * mock qui recopierait la même hypothèse que le code testé.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { calculerBrancheParDefaut, calculerVersionAppParDefaut } from './version-app';

let depot: string;

// `stdio: ['ignore', 'pipe', 'ignore']` : stderr est réduit au silence — sans ça, le conseil
// « You are in 'detached HEAD' state... » de `git checkout <sha>` (test HEAD détaché ci-dessous)
// s'affiche dans la sortie de test alors qu'il n'a aucune valeur diagnostique ici (comportement
// Git normal et attendu, pas une erreur).
function git(args: readonly string[], cwd: string = depot): string {
  return execFileSync('git', args as string[], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Un commit minimal, auteur figé en config locale (jamais de dépendance à une config Git globale
 *  — la CI ne porte pas forcément un `user.name`/`user.email`). */
function commit(message: string): void {
  writeFileSync(join(depot, 'fichier.txt'), `${message}\n`, { flag: 'a' });
  git(['add', '.']);
  git(['commit', '-m', message]);
}

beforeEach(() => {
  depot = mkdtempSync(join(tmpdir(), 'dfa-version-app-'));
  git(['init', '--initial-branch=dev-locale']);
  git(['config', 'user.email', 'test@dmsforall.example']);
  git(['config', 'user.name', 'Test DFA']);
});

afterEach(() => {
  rmSync(depot, { recursive: true, force: true });
});

describe('calculerVersionAppParDefaut — repli développement (voir charger-config.ts)', () => {
  it('MAJEUR.MINEUR vient du package.json racine, CORRECTIF du nombre total de commits, hash court en métadonnée build', () => {
    writeFileSync(join(depot, 'package.json'), JSON.stringify({ version: '2.7.9' }));
    git(['add', '.']);
    git(['commit', '-m', 'ajout package.json']);
    commit('deuxieme commit');
    commit('troisieme commit');

    const shaCourt = git(['rev-parse', '--short', 'HEAD']);

    expect(calculerVersionAppParDefaut(depot)).toBe(`2.7.3+${shaCourt}`);
  });

  it('CORRECTIF avance de un à chaque nouveau commit, jamais de saut', () => {
    writeFileSync(join(depot, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    git(['add', '.']);
    git(['commit', '-m', 'ajout package.json']);
    const avant = calculerVersionAppParDefaut(depot);
    expect(avant).toBe(`1.0.1+${git(['rev-parse', '--short', 'HEAD'])}`);

    commit('un commit de plus');
    const apres = calculerVersionAppParDefaut(depot);
    expect(apres).toBe(`1.0.2+${git(['rev-parse', '--short', 'HEAD'])}`);
  });

  it('package.json absent retombe sur MAJEUR.MINEUR = 0.0, sans jamais lever', () => {
    commit('un seul commit, pas de package.json');
    expect(calculerVersionAppParDefaut(depot)).toBe(
      `0.0.1+${git(['rev-parse', '--short', 'HEAD'])}`,
    );
  });

  it('dépôt sans `.git` (ex. archive téléchargée) : repli honnête `MAJEUR.MINEUR.0-dev+inconnu`, jamais un plantage', () => {
    const sansGit = mkdtempSync(join(tmpdir(), 'dfa-sans-git-'));
    try {
      writeFileSync(join(sansGit, 'package.json'), JSON.stringify({ version: '3.1.0' }));
      expect(calculerVersionAppParDefaut(sansGit)).toBe('3.1.0-dev+inconnu');
    } finally {
      rmSync(sansGit, { recursive: true, force: true });
    }
  });
});

describe('calculerBrancheParDefaut — repli développement (voir charger-config.ts)', () => {
  it('rend le nom de la branche courante quand HEAD est attaché', () => {
    commit('un commit sur dev-locale');
    expect(calculerBrancheParDefaut(depot)).toBe('dev-locale');
  });

  it("HEAD détaché (checkout d'un commit ou d'un tag précis) : jamais la chaîne littérale « HEAD », rend `detache-<sha>`", () => {
    commit('premier commit');
    commit('deuxieme commit');
    const shaCourt = git(['rev-parse', '--short', 'HEAD']);
    git(['checkout', shaCourt]);

    // Sanity : on est bien en HEAD détaché avant de vérifier le repli.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD');
    expect(calculerBrancheParDefaut(depot)).toBe(`detache-${shaCourt}`);
  });

  it('dépôt sans `.git` : repli honnête `inconnue`, jamais un plantage', () => {
    const sansGit = mkdtempSync(join(tmpdir(), 'dfa-sans-git-'));
    try {
      expect(calculerBrancheParDefaut(sansGit)).toBe('inconnue');
    } finally {
      rmSync(sansGit, { recursive: true, force: true });
    }
  });
});
