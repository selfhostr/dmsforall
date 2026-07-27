#!/usr/bin/env node
// Vérifie deux invariants i18n (voir CONTRIBUTING.md : « aucune chaîne en dur ») :
//   1. toute clé `t('ns:chemin.cle')` utilisée dans src/ existe dans le FR (langue source) ;
//   2. FR, DE et IT exposent EXACTEMENT le même jeu de clés, namespace par namespace.
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
  const problemes = [...problemesUtilisation, ...problemesParite];

  if (problemes.length > 0) {
    console.error(`i18n:check — ${problemes.length} problème(s) :\n`);
    for (const probleme of problemes) console.error(`  - ${probleme}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `i18n:check — OK (${clesUtilisees.size} clés utilisées, ${NAMESPACES.length} namespaces × ${LANGUES.length} langues en parité).`,
  );
}

main();
