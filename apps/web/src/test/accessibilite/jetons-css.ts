/**
 * Lecture des jetons de couleur (`--jeton: H S% L%;`) directement depuis `src/index.css`.
 *
 * Volontairement PAS une recopie à la main des valeurs : un jeton renommé, retiré ou dont la
 * valeur change dans `index.css` doit faire échouer `contraste-jetons.spec.ts` (jeton introuvable,
 * ou seuil qui casse), jamais dériver en silence derrière une copie obsolète dans `apps/web/src/test/`.
 * Lu depuis le disque à chaque exécution de test, pas au build.
 *
 * PIÈGE CORRIGÉ (refonte visuelle, mode sombre) — CE MODULE LISAIT AUPARAVANT LE FICHIER ENTIER
 * SANS TENIR COMPTE DU SÉLECTEUR QUI ENTOURE CHAQUE DÉCLARATION. Tant qu'`index.css` ne portait
 * qu'un thème (tout dans `:root`), ça ne se voyait pas. Depuis que le fichier porte AUSSI un bloc
 * `.dark { --background: ...; ... }`, un scan à plat aurait mélangé les deux thèmes dans une seule
 * `Map` — la déclaration la PLUS BASSE dans le fichier aurait silencieusement écrasé l'autre, quel
 * que soit le thème demandé par l'appelant. Un test « sombre » aurait alors mesuré des couleurs
 * claires (ou l'inverse) sans qu'aucune erreur ne le signale : un vert qui ne prouve rien.
 *
 * Le correctif : `analyser()` repère chaque bloc `:root { ... }` et `.dark { ... }` séparément (en
 * comptant les accolades, pas par une regex globale) et alimente DEUX cartes — `clair` (base, celle
 * qu'un navigateur applique par défaut) et `sombreSurcharges` (uniquement ce que `.dark` redéclare).
 * `valeurHslJeton(nom, theme)` reproduit alors la cascade CSS réelle : en thème `sombre`, un jeton
 * DÉCLARÉ dans `.dark` prend cette valeur ; un jeton ABSENT de `.dark` retombe sur sa valeur
 * `:root`, exactement ce qui se passe dans le navigateur pour un `<html class="dark">` (`:root` et
 * `.dark` ciblent le MÊME élément — la substitution de `var(--x)` se fait sur la cascade de CET
 * élément, jamais sur celle du fichier au moment où le jeton alias a été écrit).
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

/** Thème demandé par l'appelant — `'clair'` reproduit le comportement historique (défaut de tous
 *  les appels existants, aucune migration requise). */
export type Theme = 'clair' | 'sombre';

interface JetonsParses {
  /** Déclarations trouvées dans un bloc `:root { ... }` — la base, tous thèmes confondus. */
  readonly clair: ReadonlyMap<string, string>;
  /** Déclarations trouvées dans un bloc `.dark { ... }` — UNIQUEMENT ce que le thème sombre
   *  redéclare. Un jeton absent d'ici n'est pas « manquant » : il hérite de `clair`, comme dans le
   *  navigateur. */
  readonly sombreSurcharges: ReadonlyMap<string, string>;
}

let cache: JetonsParses | null = null;

const MOTIF_DECLARATION = /--([a-z0-9-]+):\s*([^;]+);/gi;

/** Extrait les paires `--nom: valeur;` d'UN SEUL bloc (le contenu déjà isolé entre `{` et `}`). */
function analyserDeclarations(corps: string, cible: Map<string, string>): void {
  let correspondance: RegExpExecArray | null;
  MOTIF_DECLARATION.lastIndex = 0;
  while ((correspondance = MOTIF_DECLARATION.exec(corps)) !== null) {
    const nom = correspondance[1];
    const valeur = correspondance[2];
    // Groupes non optionnels du motif ci-dessus : ne peuvent être `undefined` qu'en cas de bug du
    // moteur regex. Garde explicite plutôt qu'une assertion `!` — `noUncheckedIndexedAccess` sinon.
    if (nom === undefined || valeur === undefined) continue;
    // Dernière déclaration du bloc gagne (même règle que la cascade CSS pour deux sélecteurs de
    // même spécificité déclarés dans le même bloc logique — n'arrive pas aujourd'hui dans ce
    // fichier, mais ne pas paraître correct par accident si ça change).
    cible.set(nom.trim(), valeur.trim());
  }
}

/**
 * Repère chaque bloc `:root { ... }` et `.dark { ... }` de premier niveau, en comptant les
 * accolades (pas une regex `[^}]*` : `index.css` porte aussi `@theme inline { ... }`,
 * `@layer { ... }`, des `@keyframes` — une regex non-imbriquée les confondrait dès que l'un
 * d'eux referme une accolade avant `:root`/`.dark` suivant). Aucun de ces deux sélecteurs ne
 * contient lui-même de bloc imbriqué dans ce fichier ; la garde ci-dessous le vérifie plutôt que
 * de le supposer silencieusement.
 */
function pourChaqueBlocRacineEtSombre(
  source: string,
  fn: (selecteur: ':root' | '.dark', corps: string) => void,
): void {
  const motifOuverture = /(:root|\.dark)\s*\{/g;
  let correspondance: RegExpExecArray | null;
  while ((correspondance = motifOuverture.exec(source)) !== null) {
    const selecteur = correspondance[1] as ':root' | '.dark';
    const debutCorps = motifOuverture.lastIndex;
    let profondeur = 1;
    let i = debutCorps;
    for (; i < source.length && profondeur > 0; i++) {
      if (source[i] === '{') profondeur++;
      else if (source[i] === '}') profondeur--;
    }
    if (profondeur !== 0) {
      throw new Error(
        `Bloc ${selecteur} non refermé dans index.css (accolade manquante) — analyse impossible.`,
      );
    }
    const corps = source.slice(debutCorps, i - 1);
    fn(selecteur, corps);
    motifOuverture.lastIndex = i;
  }
}

function analyser(): JetonsParses {
  const source = readFileSync(CHEMIN_INDEX_CSS, 'utf-8');
  const clair = new Map<string, string>();
  const sombreSurcharges = new Map<string, string>();
  pourChaqueBlocRacineEtSombre(source, (selecteur, corps) => {
    analyserDeclarations(corps, selecteur === ':root' ? clair : sombreSurcharges);
  });
  if (clair.size === 0) {
    throw new Error('Aucun bloc :root trouvé dans index.css — analyse impossible.');
  }
  if (sombreSurcharges.size === 0) {
    throw new Error(
      'Aucun bloc .dark trouvé dans index.css — le thème sombre a-t-il été retiré ? ' +
        'Si oui, ce module et Theme doivent être simplifiés en conséquence, pas laissés à mesurer du vide.',
    );
  }
  return { clair, sombreSurcharges };
}

function jetons(): JetonsParses {
  cache ??= analyser();
  return cache;
}

/** Valeur brute (HSL littéral ou alias `var(--x)`) d'UN jeton dans UN thème, cascade CSS réelle :
 *  `.dark` d'abord si le thème est `sombre` et que le jeton y est redéclaré, sinon repli sur
 *  `:root`. */
function valeurBrute(nom: string, theme: Theme): string | undefined {
  const { clair, sombreSurcharges } = jetons();
  if (theme === 'sombre') {
    const surcharge = sombreSurcharges.get(nom);
    if (surcharge !== undefined) return surcharge;
  }
  return clair.get(nom);
}

/** Résout un jeton jusqu'à sa valeur HSL littérale, en suivant les alias `var(--autre-jeton)`
 *  (ex. `--primary: var(--marque);`) — LA RÉSOLUTION DE L'ALIAS RESTE DANS LE MÊME THÈME à chaque
 *  saut, exactement comme la cascade CSS réelle : `--ring: var(--marque)` posé une seule fois dans
 *  `:root` résout vers le `--marque` SOMBRE quand on demande `valeurHslJeton('ring', 'sombre')`,
 *  parce que `.dark` et `:root` ciblent le même élément et que la substitution se fait à la valeur
 *  utilisée, jamais à la ligne où l'alias a été écrit. Lève une erreur nommée si le jeton n'existe
 *  dans aucun des deux thèmes, ou si la chaîne d'alias ne termine pas sur un triplet HSL — jamais
 *  un `undefined` silencieux. */
export function valeurHslJeton(nom: string, theme: Theme = 'clair', profondeur = 0): string {
  if (profondeur > PROFONDEUR_MAX_ALIAS) {
    throw new Error(`Chaîne d'alias trop longue pour le jeton « --${nom} » (boucle ?).`);
  }
  const valeur = valeurBrute(nom, theme);
  if (valeur === undefined) {
    const { clair } = jetons();
    const disponibles = [...clair.keys()].sort().join(', ');
    throw new Error(
      `Jeton « --${nom} » introuvable (thème ${theme}) dans src/index.css (a-t-il été renommé ?). ` +
        `Jetons disponibles : ${disponibles}`,
    );
  }
  const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(valeur);
  const nomAlias = alias?.[1];
  if (nomAlias !== undefined) {
    return valeurHslJeton(nomAlias, theme, profondeur + 1);
  }
  return valeur;
}

/** Vide le cache — utile si un test veut relire `index.css` après une modification en cours de
 *  suite (aucun test actuel n'en a besoin, gardé pour ne pas piéger un futur test qui écrirait
 *  dans le fichier). */
export function reinitialiserCacheJetons(): void {
  cache = null;
}
