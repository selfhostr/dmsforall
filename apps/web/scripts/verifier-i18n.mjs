#!/usr/bin/env node
// Vérifie trois invariants i18n (voir CONTRIBUTING.md : « aucune chaîne en dur ») :
//   1. toute clé `t('ns:chemin.cle')` utilisée dans src/ existe dans le FR (langue source) ;
//   2. FR, DE et IT exposent EXACTEMENT le même jeu de clés, namespace par namespace ;
//   3. tout namespace présent sur disque est ENREGISTRÉ À L'EXÉCUTION dans `src/i18n/index.ts`
//      (voir §3 ci-dessous — c'était l'angle mort qui a laissé passer le lot 1 en silence).
//
// Convention imposée dans tout src/apps/web : les appels à `t()` utilisent TOUJOURS une clé
// pleinement qualifiée `namespace:chemin.cle` (jamais une clé courte reposant sur le
// namespace par défaut) — c'est ce qui permet à ce script de rester une simple regex, sans
// avoir à rejouer la résolution de namespace par défaut d'i18next.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineDepuisScript = path.dirname(fileURLToPath(import.meta.url));
const racineWeb = path.resolve(racineDepuisScript, '..');
const dossierSrc = path.join(racineWeb, 'src');
const dossierLocales = path.join(dossierSrc, 'i18n', 'locales');
const cheminIndexI18n = path.join(dossierSrc, 'i18n', 'index.ts');
const LANGUES = ['fr', 'de', 'it'];

/**
 * Les namespaces sont DÉCOUVERTS sur le disque, jamais listés en dur.
 *
 * Une liste figée est un contrôle qui ment : quand l'étape 1 a ajouté sept namespaces, la
 * vérification a continué d'afficher « OK » en n'en contrôlant que six. Trois clés dont le NOM
 * avait été traduit en italien (`pointsManquants` → `pointsManquanti`) sont passées à travers —
 * des clés introuvables à l'exécution, donc des libellés bruts affichés au garagiste.
 *
 * La référence est le répertoire `fr` : le français est la langue source, un namespace n'existe
 * que s'il y est défini. Un fichier présent en `de` ou `it` mais absent en `fr` est signalé
 * comme orphelin plutôt qu'ignoré.
 */
const NAMESPACES = readdirSync(path.join(dossierLocales, 'fr'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

for (const langue of LANGUES.filter((l) => l !== 'fr')) {
  const orphelins = readdirSync(path.join(dossierLocales, langue))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((n) => !NAMESPACES.includes(n));
  if (orphelins.length > 0) {
    console.error(`i18n:check — namespace(s) présent(s) en ${langue} mais absent(s) en fr : ${orphelins.join(', ')}`);
    process.exit(1);
  }
}

function listerFichiersSource(dossier) {
  const resultats = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const cheminComplet = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (cheminComplet.startsWith(dossierLocales)) continue;
      resultats.push(...listerFichiersSource(cheminComplet));
    } else if (/\.(ts|tsx)$/.test(entree.name) && !entree.name.endsWith('.d.ts')) {
      resultats.push(cheminComplet);
    }
  }
  return resultats;
}

function aplatir(objet, prefixe = '') {
  const resultat = {};
  for (const [cle, valeur] of Object.entries(objet)) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur)) {
      Object.assign(resultat, aplatir(valeur, chemin));
    } else {
      resultat[chemin] = true;
    }
  }
  return resultat;
}

function chargerRessources() {
  /** @type {Record<string, Record<string, Record<string, true>>>} langue -> ns -> cles aplaties */
  const ressources = {};
  for (const langue of LANGUES) {
    ressources[langue] = {};
    for (const ns of NAMESPACES) {
      const chemin = path.join(dossierLocales, langue, `${ns}.json`);
      const contenu = JSON.parse(readFileSync(chemin, 'utf-8'));
      ressources[langue][ns] = aplatir(contenu);
    }
  }
  return ressources;
}

const REGEX_APPEL_T = /\bt\(\s*(['"`])([a-zA-Z0-9_]+):([a-zA-Z0-9_.]+)\1/g;

function extraireClesUtilisees(fichiers) {
  /** @type {Map<string, {ns:string, cle:string, fichiers:Set<string>}>} */
  const utilisees = new Map();
  for (const fichier of fichiers) {
    const contenu = readFileSync(fichier, 'utf-8');
    for (const correspondance of contenu.matchAll(REGEX_APPEL_T)) {
      const [, , ns, cle] = correspondance;
      const idComplet = `${ns}:${cle}`;
      if (!utilisees.has(idComplet)) {
        utilisees.set(idComplet, { ns, cle, fichiers: new Set() });
      }
      utilisees.get(idComplet).fichiers.add(path.relative(racineWeb, fichier));
    }
  }
  return utilisees;
}

function verifierClesUtiliseesExistentEnFr(clesUtilisees, ressources) {
  const problemes = [];
  for (const [idComplet, { ns, cle, fichiers }] of clesUtilisees) {
    if (!NAMESPACES.includes(ns)) {
      problemes.push(`Namespace inconnu « ${ns} » (clé ${idComplet}) — utilisé dans ${[...fichiers].join(', ')}`);
      continue;
    }
    if (!ressources.fr[ns][cle]) {
      problemes.push(`Clé FR manquante « ${idComplet} » — utilisée dans ${[...fichiers].join(', ')}`);
    }
  }
  return problemes;
}

/**
 * §3 — Enregistrement runtime. Un namespace peut exister au complet sur disque (fichiers FR/DE/IT
 * en parité stricte, `i18n:check` déjà vert sur les points 1 et 2) sans jamais être chargé par
 * i18next, si personne ne l'a ajouté à `NAMESPACES` et à `ressources` dans `src/i18n/index.ts`.
 * Dans ce cas, `t('nsOublié:cle')` rend la clé BRUTE à l'écran — aucun test, aucun lint, aucune
 * CI ne le voit tant que ce contrôle n'existe pas (c'est exactement ce qui s'est produit avec les
 * sept namespaces du lot 1 : voir docs/plan-lot1-frontend-execution.md §2.3).
 *
 * Lecture par regex plutôt que par exécution de `index.ts` : ce script est du Node pur (`.mjs`),
 * sans étape de build ni de runtime TypeScript. Les deux motifs recherchés (le tableau
 * `NAMESPACES` et l'objet `ressources`) ont une forme stable et volontairement simple — voir la
 * garde en tête de chaque fonction si cette forme change un jour.
 */
function extraireBlocEquilibre(contenu, indexAccoladeOuverte) {
  let profondeur = 0;
  for (let i = indexAccoladeOuverte; i < contenu.length; i += 1) {
    if (contenu[i] === '{') profondeur += 1;
    else if (contenu[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return contenu.slice(indexAccoladeOuverte, i + 1);
    }
  }
  return null;
}

function extraireNamespacesDuTableau(contenuIndex) {
  const correspondance = contenuIndex.match(/export const NAMESPACES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!correspondance) return null;
  return [...correspondance[1].matchAll(/['"`]([a-zA-Z0-9_]+)['"`]/g)].map((m) => m[1]);
}

function extraireNamespacesParLangueDeRessources(contenuIndex) {
  const debutObjet = contenuIndex.indexOf('const ressources = {');
  if (debutObjet === -1) return null;
  const blocRessources = extraireBlocEquilibre(contenuIndex, debutObjet + 'const ressources = '.length);
  if (!blocRessources) return null;

  const resultat = {};
  for (const langue of LANGUES) {
    const motif = new RegExp(`\\b${langue}:\\s*\\{`);
    const correspondanceLangue = blocRessources.match(motif);
    if (!correspondanceLangue) return null;
    const debutBlocLangue = blocRessources.indexOf('{', correspondanceLangue.index);
    const blocLangue = extraireBlocEquilibre(blocRessources, debutBlocLangue);
    if (!blocLangue) return null;
    // Clés d'objet en tête de ligne : `nom: identifiant,` — pas de valeurs imbriquées ici,
    // seulement des références vers les imports JSON.
    resultat[langue] = [...blocLangue.matchAll(/(?:^|[{,])\s*([a-zA-Z0-9_]+)\s*:/g)].map((m) => m[1]);
  }
  return resultat;
}

/** Le contrôle demandé : tout namespace présent sur disque (fr = référence) doit apparaître à la
 *  fois dans `NAMESPACES` et dans le bloc `ressources` des trois langues de `src/i18n/index.ts`. */
function verifierEnregistrementRuntime() {
  const problemes = [];
  let contenuIndex;
  try {
    contenuIndex = readFileSync(cheminIndexI18n, 'utf-8');
  } catch {
    return [`Impossible de lire ${path.relative(racineWeb, cheminIndexI18n)}.`];
  }

  const namespacesTableau = extraireNamespacesDuTableau(contenuIndex);
  if (namespacesTableau === null) {
    return [
      `Impossible de repérer le tableau « export const NAMESPACES = [...] as const » dans ` +
        `${path.relative(racineWeb, cheminIndexI18n)} — sa forme a changé, ce contrôle doit être adapté avant de continuer.`,
    ];
  }

  const manquantsDuTableau = NAMESPACES.filter((ns) => !namespacesTableau.includes(ns));
  if (manquantsDuTableau.length > 0) {
    problemes.push(
      `Namespace(s) présent(s) sur disque (src/i18n/locales/fr/) mais absent(s) du tableau NAMESPACES ` +
        `dans src/i18n/index.ts : ${manquantsDuTableau.join(', ')} — t('${manquantsDuTableau[0]}:...') afficherait ` +
        `la clé brute à l'écran au lieu d'une traduction.`,
    );
  }

  const namespacesParLangue = extraireNamespacesParLangueDeRessources(contenuIndex);
  if (namespacesParLangue === null) {
    problemes.push(
      `Impossible de repérer l'objet « const ressources = {...} » (ou l'un des blocs fr/de/it) dans ` +
        `${path.relative(racineWeb, cheminIndexI18n)} — sa forme a changé, ce contrôle doit être adapté avant de continuer.`,
    );
  } else {
    for (const langue of LANGUES) {
      const manquants = NAMESPACES.filter((ns) => !namespacesParLangue[langue].includes(ns));
      if (manquants.length > 0) {
        problemes.push(
          `Namespace(s) présent(s) sur disque mais absent(s) du bloc « ${langue}: {...} » de ` +
            `ressources dans src/i18n/index.ts : ${manquants.join(', ')}.`,
        );
      }
    }
  }

  return problemes;
}

function verifierParite(ressources) {
  const problemes = [];
  for (const ns of NAMESPACES) {
    const clesParLangue = LANGUES.map((langue) => new Set(Object.keys(ressources[langue][ns])));
    const [clesFr, clesDe, clesIt] = clesParLangue;
    const toutesLesCles = new Set([...clesFr, ...clesDe, ...clesIt]);
    for (const cle of toutesLesCles) {
      const langueManquantes = LANGUES.filter((_, index) => !clesParLangue[index].has(cle));
      if (langueManquantes.length > 0) {
        problemes.push(`Clé « ${ns}:${cle} » absente de : ${langueManquantes.join(', ')}`);
      }
    }
  }
  return problemes;
}

function main() {
  const ressources = chargerRessources();
  const fichiers = listerFichiersSource(dossierSrc);
  const clesUtilisees = extraireClesUtilisees(fichiers);

  const problemesUtilisation = verifierClesUtiliseesExistentEnFr(clesUtilisees, ressources);
  const problemesParite = verifierParite(ressources);
  const problemesEnregistrement = verifierEnregistrementRuntime();
  const problemes = [...problemesUtilisation, ...problemesParite, ...problemesEnregistrement];

  if (problemes.length > 0) {
    console.error(`i18n:check — ${problemes.length} problème(s) :\n`);
    for (const probleme of problemes) console.error(`  - ${probleme}`);
    process.exitCode = 1;
    return;
  }

  console.warn(
    `i18n:check — OK (${clesUtilisees.size} clés utilisées, ${NAMESPACES.length} namespaces × ${LANGUES.length} langues en parité).`,
  );
}

main();
