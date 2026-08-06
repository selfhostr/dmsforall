import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Repli DÉVELOPPEMENT UNIQUEMENT pour `VERSION_APP`/`VERSION_APP_BRANCHE` (voir
 * `charger-config.ts`) — appelé par le `.default()` zod SEULEMENT quand la variable
 * d'environnement correspondante est absente (ou vide, via le `.preprocess` du schéma). En
 * production, l'image Docker fixe toujours ces deux variables au moment du build (voir
 * `apps/api/Dockerfile` : `ARG`/`ENV`, valeurs calculées par `.github/workflows/
 * publier-images.yml`) — ce module n'y est donc jamais sollicité, et le `.git` absent de l'image
 * finale n'est jamais un problème réel, seulement une hypothèse à ne pas casser accidentellement.
 *
 * Schéma retenu pour VERSION_APP : `MAJEUR.MINEUR` pris dans le `package.json` racine (bump
 * manuel, décision produit — jamais recalculé ici), CORRECTIF = nombre total de commits du dépôt
 * (`git rev-list --count HEAD`) — strictement croissant, ne recule jamais, incrémente à CHAQUE
 * commit (correctif comme fonctionnalité, exactement ce que @laupernoe demande : « aligné avec le
 * dernier push, mais pas les majeurs »). Le hash court est ajouté en métadonnée de build semver
 * (`+abcdef1`, ignorée par toute comparaison de versions) : c'est ce qui permet de retrouver le
 * commit exact d'un déploiement corrélé à un journal d'erreurs Sentry ou à une ligne de log JSON.
 *
 * Ne lève JAMAIS : dépôt sans `.git` (archive téléchargée), `git` absent du PATH, ou
 * `package.json` introuvable retombent tous sur un repli honnête plutôt qu'un plantage de la
 * validation zod pour une raison qui n'a rien à voir avec la configuration réelle de l'API.
 */

const RACINE_DEPOT_PAR_DEFAUT = join(__dirname, '../../../..');

function executerGit(args: readonly string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', args as string[], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function lireMajeurMineurPackageJson(cwd: string): string {
  try {
    const brut = readFileSync(join(cwd, 'package.json'), 'utf-8');
    const version = (JSON.parse(brut) as { version?: string }).version ?? '0.0.0';
    const [majeur = '0', mineur = '0'] = version.split('.');
    return `${majeur}.${mineur}`;
  } catch {
    return '0.0';
  }
}

export function calculerVersionAppParDefaut(racineDepot: string = RACINE_DEPOT_PAR_DEFAUT): string {
  const majeurMineur = lireMajeurMineurPackageJson(racineDepot);
  const nombreCommits = executerGit(['rev-list', '--count', 'HEAD'], racineDepot);
  const shaCourt = executerGit(['rev-parse', '--short', 'HEAD'], racineDepot);
  if (nombreCommits === undefined || shaCourt === undefined) {
    // Repli honnête : ni `git` ni l'historique ne sont disponibles (rare en développement, mais
    // pas impossible — archive sans .git, par exemple). Ne bloque jamais le démarrage.
    return `${majeurMineur}.0-dev+inconnu`;
  }
  return `${majeurMineur}.${nombreCommits}+${shaCourt}`;
}

/**
 * Repli DÉVELOPPEMENT UNIQUEMENT pour `VERSION_APP_BRANCHE` — même statut que la fonction
 * ci-dessus (jamais sollicité en production, l'image Docker fixe déjà la valeur au build).
 *
 * `git rev-parse --abbrev-ref HEAD` rend le nom de branche courant, SAUF en HEAD détaché
 * (checkout d'un commit ou d'un tag précis plutôt que d'une branche), où il rend littéralement
 * la chaîne `HEAD` — inutilisable telle quelle pour un support qui doit identifier ce qui tourne.
 * Dans ce cas, le hash court reste la seule information traçable : `detache-<sha>` plutôt que
 * `HEAD` tout court.
 */
export function calculerBrancheParDefaut(racineDepot: string = RACINE_DEPOT_PAR_DEFAUT): string {
  const brut = executerGit(['rev-parse', '--abbrev-ref', 'HEAD'], racineDepot);
  if (brut === undefined) {
    return 'inconnue';
  }
  if (brut !== 'HEAD') {
    return brut;
  }
  const shaCourt = executerGit(['rev-parse', '--short', 'HEAD'], racineDepot);
  return shaCourt !== undefined ? `detache-${shaCourt}` : 'inconnue';
}
