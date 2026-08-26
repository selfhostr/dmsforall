/**
 * Génération du plan proposé à partir de l'analyse — fonction PURE, testée sans base ni port de
 * lecture. Un seul levier client existe (`ElementPlanReprise.inclus`, PATCH .../plan) : cette
 * fonction ne fait que PROPOSER un premier état, jamais le dernier mot.
 *
 * AMBIGUÏTÉ SIGNALÉE (pas tranchée ici, faute de spécification) : `PerimetreReprise`
 * (`contrats/reprise.ts`) est une liste GELÉE de QUATRE valeurs, chacune tenant explicitement à
 * une décision D-29→D-34 (OR détail 24 mois, en-têtes documents 10 ans, soldes comptables ouverts,
 * scans rattachés) — aucune des quatre ne décrit un périmètre temporel pour les données de
 * RÉFÉRENCE (clients, véhicules, articles, fournisseurs, paiements), qui n'ont normalement AUCUNE
 * borne temporelle propre. Faute d'une cinquième valeur de périmètre pour ces domaines (le champ
 * n'est pas nullable côté contrat), ce module leur attribue PAR DÉFAUT `entetes_totaux_tva_10_ans`
 * — la valeur la plus proche d'« aucune restriction temporelle » parmi les quatre disponibles —
 * SANS AFFIRMER que c'est la bonne réponse métier : à confirmer avec `expert-metier`/le contrat.
 */

import type {
  DomaineReprise,
  ElementPlanReprise,
  ExclusionPlanReprise,
  MotifExclusionPlanReprise,
  PerimetreReprise,
  RoleTableReprise,
  TableDetecteeReprise,
} from '@dfa/shared';
import { randomUUID } from 'node:crypto';

const DOMAINE_PAR_ROLE: Readonly<Partial<Record<RoleTableReprise, DomaineReprise>>> = {
  clients: 'clients',
  vehicules: 'vehicules',
  ordres_reparation: 'ordres_reparation',
  lignes_ordre_reparation: 'ordres_reparation',
  documents_vente: 'documents_vente',
  lignes_document_vente: 'documents_vente',
  paiements: 'paiements',
  articles_stock: 'articles_stock',
  fournisseurs: 'fournisseurs',
  index_documents_scannes: 'documents_scannes',
};

const PERIMETRE_PAR_ROLE: Readonly<Partial<Record<RoleTableReprise, PerimetreReprise>>> = {
  ordres_reparation: 'detail_24_mois_glissants_et_ouverts',
  lignes_ordre_reparation: 'detail_24_mois_glissants_et_ouverts',
  documents_vente: 'entetes_totaux_tva_10_ans',
  lignes_document_vente: 'entetes_totaux_tva_10_ans',
  index_documents_scannes: 'documents_scannes_rattaches',
};
const PERIMETRE_DEFAUT: PerimetreReprise = 'entetes_totaux_tva_10_ans';

const SEUIL_CONFIANCE_MINIMUM = 40;

export interface ResultatGenerationPlanReprise {
  readonly elements: readonly ElementPlanReprise[];
  readonly exclusions: readonly ExclusionPlanReprise[];
}

/**
 * Compare deux tables candidates pour LE MÊME rôle métier (copies rivales trouvées dans une même
 * archive — ex. Auto-i réel de @laupernoe : `Kunden` présente à la fois dans une base courante et une
 * ancienne sauvegarde) : rend `true` si `candidate` doit REMPLACER `retenue` comme table faisant
 * foi pour ce rôle.
 *
 * DÉFAUT RÉEL corrigé ici (26.08.2026, mesuré sur archive réelle, zéro ligne écrite avant ce
 * correctif) : la comparaison précédente ne portait QUE sur `indiceConfiance`, en `>` STRICT.
 * `indiceConfiance` est un entier 0-100 (`Math.round` d'un score de CONTENU DE COLONNES 0-1, cf.
 * `lecteurs/detecteur-role.ts`) — deux copies d'une même table au même schéma obtiennent quasiment
 * toujours la MÊME confiance arrondie (mesuré : `Anwender_corrompu.mdb`, 7143 lignes, ET
 * `RepAw.backup`, 9977 lignes, confiance 90 identique pour "Kunden"). Sur cette égalité, `>`
 * strict ne remplaçait JAMAIS `retenue` : gagnait systématiquement la table vue EN PREMIER dans
 * `tables` — l'ORDRE D'EXTRACTION DU ZIP, un hasard, jamais un critère métier.
 *
 * CRITÈRES RETENUS, DANS CET ORDRE, ET POURQUOI (question posée par le coordinateur : fraîcheur ?
 * égalité totale ? chemin recevable ? — tranchées ici, explicitement) :
 *   1. `indiceConfiance` — déjà en place, inchangé : signal le plus fort (contenu des colonnes),
 *      rien à départager tant qu'il tranche.
 *   2. `nombreLignes` (volume RÉEL de la table, pas l'échantillon — `lecture/adaptateur-lecteur-
 *      archive-reprise.ts::evaluerRole` réécrit déjà ce champ avec le total exact avant projection)
 *      — critère de CONTENU, jamais de nom/chemin. UN SIGNAL DE FRAÎCHEUR SERAIT MEILLEUR mais
 *      N'EXISTE PAS À CE NIVEAU AUJOURD'HUI : `TableDetecteeReprise.periodeCouverte` — le champ du
 *      contrat prévu pour ça — est TOUJOURS `null` (vérifié : `analyse/projection-analyse-
 *      reprise.ts` le fixe en dur, sans jamais appeler `lecteurs/profilage.ts::
 *      dateMaxPlausibleTable`, qui existe et calculerait pourtant ce signal — câblage absent,
 *      hors du périmètre de ce chantier, `analyse/` non accordé). LIMITE ASSUMÉE du volume comme
 *      repli : un garage qui purge des fiches clients pourrait avoir une base courante plus
 *      PETITE qu'une vieille sauvegarde jamais purgée — volume retenu FAUTE DE MIEUX, signalé, pas
 *      caché. Câbler `dateMaxPlausibleTable` dans `analyse/` pour peupler `periodeCouverte` serait
 *      le vrai correctif long terme ; à confier explicitement si voulu, pas fait ici en douce.
 *   3. `fichierChemin`, ordre lexicographique — DERNIER RECOURS déterministe pour une égalité
 *      RÉELLE sur les deux critères ci-dessus (rarissime : deux fichiers identiques au contenu ET
 *      au volume — plus rare encore qu'un `Backups/` dans un des deux chemins). Ce n'est PAS un
 *      jugement sur le CONTENU ou la POSITION du chemin (interdit, voir ci-dessous) : c'est une
 *      clé de tri STABLE qui rend le résultat REPRODUCTIBLE d'une exécution à l'autre sur la MÊME
 *      archive, là où l'ancien comportement dépendait de l'ordre d'énumération du zip (silencieux,
 *      jamais documenté comme un choix). La distinction tenue ici, explicitement : comparer deux
 *      CHAÎNES pour les ordonner n'affirme RIEN sur la fiabilité de ce qu'elles désignent — un tri
 *      alphabétique n'est pas un jugement de valeur, contrairement à « ce chemin contient
 *      `Backups/` donc j'écarte ce fichier », qui EST un jugement (et l'exact réflexe que la
 *      doctrine ci-dessous interdit).
 *
 * JAMAIS RETENU, DÉLIBÉRÉMENT, MÊME SOUS FORME "STRUCTURELLE" : le nom de fichier OU sa position
 * dans l'arborescence (ex. un chemin sous `Backups/`, ou contenant "corrompu") comme SIGNAL DE
 * DÉCISION — question posée explicitement par le coordinateur (« un chemin de structure n'est-il
 * pas différent d'un nom de fichier ? ») ; réponse mesurée : NON, pas ici. Doctrine déjà posée par
 * `lecteurs/detection-famille.ts` pour la reconnaissance de moteur, et par le module de départage
 * de copies aujourd'hui supprimé pour code mort (`choix-copie-source.ts`, voir `lecteurs/
 * index.ts`) : « une décompression réécrit les dates, une archive prise à chaud ment déjà sur sa
 * fraîcheur » — et, mesuré sur une archive réelle avant ce chantier, l'emplacement qui RESSEMBLAIT
 * à l'installation vive était un ancien répertoire ABANDONNÉ, la copie la plus récente vivant dans
 * un répertoire d'apparence anodine. Un chemin `Backups/` n'est pas différent EN NATURE d'un nom
 * de fichier « corrompu » : les deux sont des indices de PRÉSENTATION (comment l'archive a été
 * rangée par quelqu'un), jamais du CONTENU mesuré (ce que la table contient réellement) — le seul
 * axe que cette doctrine autorise à trancher. Le critère 3 ci-dessus n'échappe pas à cette règle :
 * il n'utilise `fichierChemin` que comme clé de tri arbitraire, jamais pour lui faire dire quoi
 * que ce soit sur la fiabilité du fichier qu'il désigne.
 */
function estMeilleureCopie(
  candidate: TableDetecteeReprise,
  retenue: TableDetecteeReprise,
): boolean {
  if (candidate.indiceConfiance !== retenue.indiceConfiance) {
    return candidate.indiceConfiance > retenue.indiceConfiance;
  }
  if (candidate.nombreLignes !== retenue.nombreLignes) {
    return candidate.nombreLignes > retenue.nombreLignes;
  }
  return candidate.fichierChemin < retenue.fichierChemin;
}

export function genererPlanDepuisTables(
  tables: readonly TableDetecteeReprise[],
  tablesRattacheesParIndex: ReadonlySet<string> = new Set(),
): ResultatGenerationPlanReprise {
  const elements: ElementPlanReprise[] = [];
  const exclusions: ExclusionPlanReprise[] = [];

  const meilleureParRole = new Map<RoleTableReprise, TableDetecteeReprise>();
  for (const table of tables) {
    const actuelle = meilleureParRole.get(table.roleDeduit);
    if (!actuelle || estMeilleureCopie(table, actuelle)) {
      meilleureParRole.set(table.roleDeduit, table);
    }
  }

  for (const table of tables) {
    const exclusionFixe = motifExclusionFixe(table);
    if (exclusionFixe) {
      exclusions.push({ tableDetecteeId: table.id, motif: exclusionFixe });
      continue;
    }

    if (table.nombreLignes === 0) {
      exclusions.push({ tableDetecteeId: table.id, motif: 'table_vide' });
      continue;
    }

    if (table.roleDeduit === 'index_documents_scannes' && !tablesRattacheesParIndex.has(table.id)) {
      exclusions.push({ tableDetecteeId: table.id, motif: 'document_non_rattachable' });
      continue;
    }

    if (table.indiceConfiance < SEUIL_CONFIANCE_MINIMUM) {
      exclusions.push({
        tableDetecteeId: table.id,
        motif: 'role_indetermine',
        donnees: { indiceConfiance: table.indiceConfiance },
      });
      continue;
    }

    const meilleure = meilleureParRole.get(table.roleDeduit);
    if (meilleure && meilleure.id !== table.id) {
      exclusions.push({
        tableDetecteeId: table.id,
        motif: 'doublon_table_meme_role',
        donnees: { tableRetenueId: meilleure.id },
      });
      continue;
    }

    const domaine = DOMAINE_PAR_ROLE[table.roleDeduit];
    if (!domaine) {
      exclusions.push({ tableDetecteeId: table.id, motif: 'role_indetermine' });
      continue;
    }

    elements.push({
      id: randomUUID(),
      domaine,
      tableDetecteeId: table.id,
      perimetre: PERIMETRE_PAR_ROLE[table.roleDeduit] ?? PERIMETRE_DEFAUT,
      volumeAttenduLignes: table.nombreLignes,
      inclus: true,
      ajustable: true,
    });
  }

  return { elements, exclusions };
}

/**
 * Garde-fou de bon sens (défaut réel du 25.08.2026) : un plan sans AUCUN élément inclus ne doit
 * jamais être validé silencieusement — `ServicePlanReprise.valider()` transitionne dans le MÊME
 * GESTE vers `import_en_cours` (§ tête de `contrats/reprise.ts`), et un import qui ne traite aucun
 * élément inclus se termine « avec succès » sans avoir rien écrit : le pire des retours pour un
 * garagiste qui vient de confier son archive. Couvre les DEUX origines possibles d'un plan vide :
 * aucun élément généré par l'analyse (0 table exploitable, ou — précisément le défaut du
 * 25.08.2026 — un bug d'échelle qui exclut tout), ET un plan dont le garagiste a manuellement
 * décoché tous les éléments via `PATCH .../plan` avant de valider.
 */
export function planSansElementInclus(elements: readonly ElementPlanReprise[]): boolean {
  return !elements.some((e) => e.inclus);
}

function motifExclusionFixe(table: TableDetecteeReprise): MotifExclusionPlanReprise | null {
  if (table.roleDeduit === 'referentiel_constructeur')
    return 'referentiel_constructeur_jamais_repris';
  if (table.roleDeduit === 'comptabilite_generale') return 'comptabilite_non_reprise';
  if (table.roleDeduit === 'inconnu') return 'role_indetermine';
  return null;
}
