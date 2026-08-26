/**
 * Résolution d'un alias de colonne source, INSENSIBLE À LA CASSE.
 *
 * DÉFAUT RÉEL mesuré le 26.08.2026, import Auto-i réel de @laupernoe (100% des lignes rejetées, zéro
 * client retenu) : `mdb-export` (`lecteurs/access/lecteur-access.ts`) préserve la casse D'ORIGINE
 * des colonnes Access (`KundenNr`, `Name`, `ChassisNr`, `Kontrollschild`...) ; les écrivains de
 * domaine comparaient ces clés à des alias écrits EN MINUSCULES (`'kundennr'`, `'nom'`, `'vin'`...)
 * par ACCÈS OBJET JavaScript, sensible à la casse — chaque ligne échouait en `reference_manquante`
 * ("identifiant source absent"), aucune ne portait jamais réellement cette raison.
 *
 * CHOIX D'IMPLÉMENTATION, MESURÉ : normaliser ICI (écrivains), PAS à la lecture (`lecteurs/`).
 * Les deux voies ont été comparées avant de trancher :
 *   - Normaliser à la lecture (`lireLignesAccess`/`listerColonnesAccess`, `analyserEnTeteDbf`)
 *     règle le problème une seule fois pour toutes les sources (Access ET FoxPro/DBF, dont les
 *     noms de champ sont conventionnellement en MAJUSCULES) — séduisant en théorie.
 *   - MESURÉ CONCRÈTEMENT : ce choix change ce que `lecteurs/` EXPOSE (noms de colonnes des
 *     rapports d'analyse — `TableDetecteeReprise.motifsDeduction`, `ProfilColonne.colonne` —
 *     affichés au garagiste) et casse des tests FIGÉS HORS DU PÉRIMÈTRE DE CE CHANTIER
 *     (`lecture/adaptateur-lecteur-archive-reprise.spec.ts:217-218`,
 *     `lecteurs/dbf/en-tete-dbf.spec.ts:55`, `lecteurs/access/lecteur-access.spec.ts:106,115`)
 *     sans aucun bénéfice supplémentaire ici : SEULS les écrivains de domaine ont besoin d'un
 *     alias insensible à la casse — `lecteurs/` elle-même manipule les noms de colonnes comme des
 *     chaînes OPAQUES (jamais comme des clés d'alias à comparer à une liste figée).
 * Résolution ici, dans les écrivains, corrige exactement le point de défaillance mesuré, à coût
 * de blast-radius nul en dehors du périmètre `import/`.
 *
 * Le même besoin se posera IDENTIQUEMENT pour FoxPro/DBF (noms de champ conventionnellement en
 * MAJUSCULES) : ce module est déjà générique au moteur d'origine (`LigneTable`/`ValeurChamp`,
 * vocabulaire commun aux deux lecteurs), rien à refaire à ce moment-là.
 *
 * TOUJOURS utiliser ce module pour résoudre un alias de colonne source dans un écrivain de
 * domaine (présent ou futur) — JAMAIS un accès direct `ligne.valeurs[alias]`, qui reproduit
 * silencieusement le défaut ci-dessus dès que la casse de la source diffère de l'alias.
 */
import type { LigneTable, ValeurChamp } from '../lecteurs/types';

/** Index insensible à la casse des colonnes d'UNE ligne — à construire UNE FOIS par ligne
 *  (`indexerColonnesLigne`), puis réutiliser pour toutes les résolutions d'alias de cette ligne
 *  (une ligne peut porter 15-20 alias à résoudre : reconstruire l'index à chaque alias serait du
 *  travail O(colonnes × alias) inutile). */
export function indexerColonnesLigne(ligne: LigneTable): ReadonlyMap<string, ValeurChamp> {
  const index = new Map<string, ValeurChamp>();
  for (const [cle, valeur] of Object.entries(ligne.valeurs)) {
    const cleNormalisee = cle.trim().toLowerCase();
    // Première colonne gagne en cas de collision (deux colonnes source qui ne diffèrent QUE par
    // la casse — jamais vu en pratique sur une archive réelle) : jamais une exception, un import
    // ne doit pas s'arrêter sur ce cas limite.
    if (!index.has(cleNormalisee)) index.set(cleNormalisee, valeur);
  }
  return index;
}

/** Valeur brute (quel que soit son type) de la première colonne renseignée parmi les alias
 *  fournis (déjà en minuscules, doctrine des écrivains de domaine) — `null` si aucune. */
export function valeurParAlias(
  index: ReadonlyMap<string, ValeurChamp>,
  ...aliases: readonly string[]
): ValeurChamp | null {
  for (const alias of aliases) {
    const valeur = index.get(alias);
    if (valeur !== null && valeur !== undefined) return valeur;
  }
  return null;
}

/** Première valeur TEXTE non vide (après `trim`) parmi les alias fournis. */
export function texteParAlias(
  index: ReadonlyMap<string, ValeurChamp>,
  ...aliases: readonly string[]
): string | null {
  for (const alias of aliases) {
    const valeur = index.get(alias);
    if (typeof valeur === 'string' && valeur.trim() !== '') return valeur.trim();
  }
  return null;
}

const RE_DATE_TEXTE_A_POINTS = /^(\d{1,4})\.(\d{1,2})\.(\d{1,4})$/;

/**
 * `jj.mm.aaaa` OU `aaaa.mm.jj` (le groupe à 4 chiffres désigne l'année, quel que soit son côté) ->
 * ISO `aaaa-mm-jj` — jamais l'inverse (une chaîne déjà ISO, ex. sortie native `mdb-export -D
 * '%Y-%m-%d'`, ne matche pas ce motif et ressort inchangée par l'appelant).
 *
 * Défaut réel mesuré le 26.08.2026 (archive Auto-i complète de @laupernoe, colonne `Lager.ErstIV`,
 * déclarée `Text(10)` côté Access, donc TOUJOURS une chaîne, jamais un type date natif) : SANS
 * cette conversion, une date `jj.mm.aaaa` partait TELLE QUELLE dans l'`INSERT` SQL de
 * `vehicule_plaque`/`vehicule_detention` — Postgres refuse ce format par défaut
 * (`DateStyle` ISO), l'écriture de l'intervalle échouait silencieusement (branche jamais
 * atteinte, ou erreur SQL selon la valeur). Même heuristique de désambiguïsation que
 * `lecteurs/profilage.ts::parseDateTexteFrOuIso` (détection de fraîcheur, but différent : `Date`
 * approximative sur échantillon, jamais persistée) — DUPLIQUÉE ICI À DESSEIN, jamais importée :
 * `lecteurs/` est la bibliothèque de RECONNAISSANCE, sans dépendance vers `import/` (frontière
 * délibérée, § tête de `lecteurs/index.ts`) ; dupliquer une fonction pure de dix lignes coûte
 * moins cher que la traverser.
 */
function normaliserDateTexteVersIso(v: string): string | null {
  const m = RE_DATE_TEXTE_A_POINTS.exec(v.trim());
  if (!m) return null;
  const g1 = m[1]!;
  const g2 = m[2]!;
  const g3 = m[3]!;
  const jourMois = g2.padStart(2, '0');
  if (g1.length === 4) return `${g1}-${jourMois}-${g3.padStart(2, '0')}`; // aaaa.mm.jj
  if (g3.length === 4) return `${g3}-${jourMois}-${g1.padStart(2, '0')}`; // jj.mm.aaaa
  return null; // ni g1 ni g3 sur 4 chiffres : pas une année plausible, jamais deviné à l'aveugle
}

/** Date ISO (`aaaa-mm-jj`) — `Date` native convertie, texte `jj.mm.aaaa`/`aaaa.mm.jj` normalisé
 *  (voir `normaliserDateTexteVersIso`), sinon texte brut tel quel (déjà ISO, ou format non
 *  reconnu — jamais réinventé à l'aveugle) — première valeur exploitable parmi les alias. Même
 *  doctrine que l'ancien `dateIso` local de `ecrivain-vehicule-reprise.ts`, avant ce partage. */
export function dateIsoParAlias(
  index: ReadonlyMap<string, ValeurChamp>,
  ...aliases: readonly string[]
): string | null {
  for (const alias of aliases) {
    const valeur = index.get(alias);
    if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
    if (typeof valeur === 'string' && valeur.trim() !== '') {
      return normaliserDateTexteVersIso(valeur) ?? valeur.trim();
    }
  }
  return null;
}
