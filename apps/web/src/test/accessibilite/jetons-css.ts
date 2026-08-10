/**
 * Lecture des jetons de couleur (`--jeton: H S% L%;`) directement depuis `src/index.css`.
 *
 * Volontairement PAS une recopie à la main des valeurs : un jeton renommé, retiré ou dont la
 * valeur change dans `index.css` doit faire échouer `contraste-jetons.spec.ts` (jeton introuvable,
 * ou seuil qui casse), jamais dériver en silence derrière une copie obsolète dans `apps/web/src/test/`.
 * Lu depuis le disque à chaque exécution de test, pas au build.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Volontairement PAS `new URL('../../index.css', import.meta.url)` : Vite reconnaît ce motif
// littéral et le réécrit en référence d'asset servie par le serveur de test
// (`http://localhost:3000/src/index.css`), pas en chemin fichier — `fileURLToPath` échoue alors
// avec « The URL must be of scheme file ». Lire son propre `import.meta.url` seul (sans le
// combiner dans un `new URL` inline) échappe à cette réécriture ; la résolution relative se fait
// ensuite avec `path`, hors de portée du plugin Vite.
const CHEMIN_MODULE = fileURLToPath(import.meta.url);
const CHEMIN_INDEX_CSS = path.resolve(path.dirname(CHEMIN_MODULE), '../../index.css');

const PROFONDEUR_MAX_ALIAS = 5;

interface JetonsParses {
  readonly brut: ReadonlyMap<string, string>;
}

let cache: JetonsParses | null = null;

function analyser(): JetonsParses {
  const source = readFileSync(CHEMIN_INDEX_CSS, 'utf-8');
  const brut = new Map<string, string>();
  // Capture toute déclaration `--nom: valeur;` au niveau des blocs `:root` — la valeur peut être
  // un triplet HSL littéral (`288 58% 36%`) ou un alias (`var(--marque)`).
  const motif = /--([a-z0-9-]+):\s*([^;]+);/gi;
  let correspondance: RegExpExecArray | null;
  while ((correspondance = motif.exec(source)) !== null) {
    const nom = correspondance[1];
    const valeur = correspondance[2];
    // Groupes non optionnels du motif ci-dessus : ne peuvent être `undefined` qu'en cas de bug du
    // moteur regex. Garde explicite plutôt qu'une assertion `!` — `noUncheckedIndexedAccess` sinon.
    if (nom === undefined || valeur === undefined) continue;
    brut.set(nom.trim(), valeur.trim());
  }
  return { brut };
}

function jetons(): JetonsParses {
  cache ??= analyser();
  return cache;
}

/** Résout un jeton jusqu'à sa valeur HSL littérale, en suivant les alias `var(--autre-jeton)`
 *  (ex. `--primary: var(--marque);`). Lève une erreur nommée si le jeton n'existe pas ou si la
 *  chaîne d'alias ne termine pas sur un triplet HSL — jamais un `undefined` silencieux. */
export function valeurHslJeton(nom: string, profondeur = 0): string {
  if (profondeur > PROFONDEUR_MAX_ALIAS) {
    throw new Error(`Chaîne d'alias trop longue pour le jeton « --${nom} » (boucle ?).`);
  }
  const { brut } = jetons();
  const valeur = brut.get(nom);
  if (valeur === undefined) {
    const disponibles = [...brut.keys()].sort().join(', ');
    throw new Error(
      `Jeton « --${nom} » introuvable dans src/index.css (a-t-il été renommé ?). ` +
        `Jetons disponibles : ${disponibles}`,
    );
  }
  const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(valeur);
  const nomAlias = alias?.[1];
  if (nomAlias !== undefined) {
    return valeurHslJeton(nomAlias, profondeur + 1);
  }
  return valeur;
}

/** Vide le cache — utile si un test veut relire `index.css` après une modification en cours de
 *  suite (aucun test actuel n'en a besoin, gardé pour ne pas piéger un futur test qui écrirait
 *  dans le fichier). */
export function reinitialiserCacheJetons(): void {
  cache = null;
}
