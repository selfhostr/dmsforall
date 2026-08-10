/**
 * Échelle typographique — lecture programmatique des tailles AUTORISÉES, directement depuis
 * `src/index.css` (les trois blocs `.densite-dense/aeree/tres-aeree`), même principe que
 * `jetons-css.ts` pour les couleurs : la source de vérité est le CSS, jamais une recopie à la main
 * dans ce module — un rôle renommé, retiré ou dont la taille change dans `index.css` doit se
 * répercuter ici automatiquement, jamais dériver en silence derrière une copie obsolète.
 *
 * Rappel du contrat posé au Lot K (voir le tableau en tête d'`index.css`, section « ÉCHELLE
 * TYPOGRAPHIQUE COMPLÈTE ») : six rôles nommés (`texte-libelle`, `texte-corps`,
 * `texte-titre-section`, `texte-titre-page`, `texte-donnee`, `texte-chiffre-geant`), chacun décliné
 * en trois densités. Dix-huit déclarations, mais seulement un petit nombre de valeurs de pixels
 * distinctes — c'est CETTE liste de valeurs qui constitue « l'échelle ». Une taille de police qui
 * n'y figure pas n'est pas un choix parmi les six rôles : c'est une taille inventée au jugé.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Même précaution que `jetons-css.ts` : ne pas laisser Vite réécrire ce chemin en référence
// d'asset servie par le serveur de test. Voir le commentaire équivalent dans `jetons-css.ts`.
const CHEMIN_MODULE = fileURLToPath(import.meta.url);
const CHEMIN_INDEX_CSS = path.resolve(path.dirname(CHEMIN_MODULE), '../../index.css');

// Racine non modifiée dans ce dépôt : aucun `html { font-size: ... }` dans `index.css` (vérifié à
// la lecture du fichier), donc `1rem` vaut le défaut navigateur de 16px. Si ça changeait un jour,
// toute conversion ci-dessous deviendrait fausse — raison de plus pour ne PAS dupliquer ce nombre
// ailleurs que dans ce module.
const REM_EN_PX = 16;

export interface EntreeEchelle {
  /** Nom du rôle sans le préfixe `texte-` ni le suffixe `-taille`, ex. `corps`, `titre-page`. */
  readonly role: string;
  readonly densite: 'dense' | 'aeree' | 'tres-aeree';
  readonly px: number;
}

interface EchelleAnalysee {
  readonly entrees: readonly EntreeEchelle[];
  readonly taillesPx: ReadonlySet<number>;
}

let cache: EchelleAnalysee | null = null;

function convertirEnPx(valeur: string): number {
  const correspondanceRem = /^([\d.]+)rem$/.exec(valeur);
  const groupeRem = correspondanceRem?.[1];
  if (groupeRem !== undefined) return parseFloat(groupeRem) * REM_EN_PX;

  const correspondancePx = /^([\d.]+)px$/.exec(valeur);
  const groupePx = correspondancePx?.[1];
  if (groupePx !== undefined) return parseFloat(groupePx);

  throw new Error(
    `Valeur de taille non reconnue dans index.css : « ${valeur} » (ni rem ni px — le format a-t-il changé ?).`,
  );
}

const DENSITES = ['dense', 'aeree', 'tres-aeree'] as const;

function analyser(): EchelleAnalysee {
  const source = readFileSync(CHEMIN_INDEX_CSS, 'utf-8');
  const entrees: EntreeEchelle[] = [];

  for (const densite of DENSITES) {
    // PIÈGE VÉRIFIÉ : `index.css` déclare DEUX blocs dont le sélecteur se termine par
    // `.densite-tres-aeree {` — le sélecteur groupé en tête de section (qui ne pose que les
    // variables `--densite-tuile-or-*`, partagées par les trois densités) ET le bloc individuel
    // plus bas (qui pose, lui, les `--texte-*-taille`). Un `exec()` non global s'arrête sur le
    // PREMIER, groupé — silencieusement vide de toute taille de police. Un bloc `.densite-X { ... }`
    // ne contient jamais d'accolade imbriquée ici (custom properties à plat), donc `[^}]*` non
    // gourmand suffit ; la correction tient dans le `g` global ci-dessous : on prend TOUTES les
    // occurrences du sélecteur et on garde celle qui contient réellement des `--texte-*-taille`.
    const motifBloc = new RegExp(`\\.densite-${densite}\\s*\\{([^}]*)\\}`, 'gs');
    let corpsBloc: string | undefined;
    let correspondanceBloc: RegExpExecArray | null;
    while ((correspondanceBloc = motifBloc.exec(source)) !== null) {
      const corps = correspondanceBloc[1];
      if (corps !== undefined && corps.includes('--texte-')) {
        corpsBloc = corps;
        break;
      }
    }
    if (corpsBloc === undefined) {
      throw new Error(
        `Bloc « .densite-${densite} » (contenant des --texte-*-taille) introuvable dans index.css ` +
          '(renommé, supprimé, ou fusionné dans le sélecteur groupé ?).',
      );
    }

    const motifTaille = /--texte-([a-z-]+)-taille:\s*([\d.]+(?:rem|px))/g;
    let correspondanceTaille: RegExpExecArray | null;
    while ((correspondanceTaille = motifTaille.exec(corpsBloc)) !== null) {
      const role = correspondanceTaille[1];
      const valeur = correspondanceTaille[2];
      if (role === undefined || valeur === undefined) continue;
      entrees.push({ role, densite, px: convertirEnPx(valeur) });
    }
  }

  if (entrees.length === 0) {
    throw new Error(
      "Aucune taille d'échelle trouvée dans index.css — les blocs .densite-* ou le motif " +
        '`--texte-*-taille` ont-ils changé de forme ?',
    );
  }

  return { entrees, taillesPx: new Set(entrees.map((e) => e.px)) };
}

function echelle(): EchelleAnalysee {
  cache ??= analyser();
  return cache;
}

/** Ensemble des tailles de police (px) couvertes par un rôle nommé, toutes densités confondues.
 *  C'EST l'échelle : toute taille absente de cet ensemble est hors échelle par définition. */
export function taillesEchellePx(): ReadonlySet<number> {
  return echelle().taillesPx;
}

// Cosmétique UNIQUEMENT : sert à afficher le vrai nom de classe utilitaire (`.texte-donnee-
// proeminente`) plutôt que le nom brut de la variable CSS (`donnee`) dans les messages d'erreur.
// N'intervient à AUCUN moment dans le calcul d'appartenance à l'échelle (`taillesEchellePx`),
// entièrement dérivé de `index.css` — un rôle absent de cette table retombe sur `texte-<rôle>`
// plutôt que de faire échouer le module.
const NOMS_CLASSES: Readonly<Record<string, string>> = {
  corps: 'texte-corps',
  libelle: 'texte-libelle',
  titre: 'texte-titre-section',
  'titre-page': 'texte-titre-page',
  donnee: 'texte-donnee-proeminente',
  'chiffre-geant': 'texte-chiffre-geant',
};

/** Rôle(s) + densité(s) qui produisent une taille donnée (px) — pour un message d'erreur qui dit
 *  quoi utiliser à la place, pas seulement ce qui est interdit. Tableau vide si la taille est
 *  hors échelle (c'est justement le cas qu'on signale). */
export function rolesPourTaille(px: number): readonly string[] {
  return echelle()
    .entrees.filter((e) => e.px === px)
    .map((e) => `${NOMS_CLASSES[e.role] ?? `texte-${e.role}`} (${e.densite})`);
}

/** Utile pour un test qui modifierait `index.css` en mémoire (aucun cas actuel), gardé pour ne pas
 *  piéger un futur test — même geste que `reinitialiserCacheJetons()`. */
export function reinitialiserCacheEchelle(): void {
  cache = null;
}
