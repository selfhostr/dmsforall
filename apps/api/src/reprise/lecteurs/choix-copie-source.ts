/**
 * Choix de la copie faisant foi, quand une archive contient plusieurs copies rivales des mêmes
 * données (sauvegardes datées, anciens emplacements, gabarits d'installation).
 *
 * Fait mesuré qui impose ce module : sur une archive réelle, l'emplacement qui ressemblait à
 * l'installation vive était un ancien répertoire abandonné (les journaux applicatifs montraient
 * un bascule vers un autre chemin) ; la copie la plus récente vivait dans un répertoire
 * d'apparence anodine, avec plus de tables que la sauvegarde "officielle" et que le gabarit
 * vierge de l'éditeur. Décider ne se fait donc JAMAIS sur le nom du chemin ni sur l'horodatage
 * fichier (une décompression réécrit les dates, une archive prise à chaud ment déjà sur sa
 * fraîcheur) — uniquement sur le contenu mesuré : volume d'enregistrements actifs et date
 * maximale réellement observée dans les données.
 *
 * Fonction pure : la couche d'assemblage lit chaque répertoire candidat (via
 * `detecterFamilleRepertoire`, `lireLignesDbf`/`lireLignesAccess`, `dateMaxPlausibleTable`) et
 * construit les `CandidatCopie` résumés ; ce module se contente de décider.
 */
import type { RapportTable, RoleMetier } from './types';

export interface TableResumeCopie {
  nom: string;
  colonnes: readonly string[];
  lignesActives: number;
  /** Date la plus récente et plausible observée dans cette table (cf. `dateMaxPlausibleTable`). */
  dateMaxObservee: Date | null;
}

export interface CandidatCopie {
  cheminRepertoire: string;
  tables: readonly TableResumeCopie[];
}

export interface CopieEcartee {
  cheminRepertoire: string;
  motif: string;
}

export interface GroupeCopiesRivales {
  chemins: string[];
  /** Similarité de Jaccard moyenne (sur les noms de table) entre les membres du groupe. */
  similariteMoyenne: number;
}

export interface ResultatSelectionCopie {
  copieRetenue: string | null;
  copiesEcartees: CopieEcartee[];
  groupes: GroupeCopiesRivales[];
  /** Constats à remonter explicitement au garagiste, jamais tranchés en silence. */
  incoherences: string[];
}

const SEUIL_SIMILARITE_GROUPE = 0.6;
const SEUIL_LIGNES_GABARIT = 5;

function totalLignesActives(c: CandidatCopie): number {
  return c.tables.reduce((s, t) => s + t.lignesActives, 0);
}

/**
 * Un jeu de tables structurellement non trivial (≥3 tables) mais dont le volume total
 * d'enregistrements actifs est quasi nul : le modèle d'installation vierge de l'éditeur, jamais
 * des données de garage. Piège mesuré : deux tables au nom officiel "clients"/"véhicules"
 * existaient à 0 enregistrement dans TOUTES les copies d'une archive réelle — les mapper aurait
 * produit une reprise vide sans lever d'erreur.
 */
export function estGabaritVide(candidat: CandidatCopie): boolean {
  return candidat.tables.length >= 3 && totalLignesActives(candidat) <= SEUIL_LIGNES_GABARIT;
}

function signatureTable(nom: string): string {
  return nom.trim().toLowerCase();
}

function similariteCopies(a: CandidatCopie, b: CandidatCopie): number {
  const sigA = new Set(a.tables.map((t) => signatureTable(t.nom)));
  const sigB = new Set(b.tables.map((t) => signatureTable(t.nom)));
  if (sigA.size === 0 && sigB.size === 0) return 1;
  const intersection = [...sigA].filter((s) => sigB.has(s)).length;
  const union = new Set([...sigA, ...sigB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Regroupe les répertoires candidats dont le jeu de noms de table se recoupe largement — des
 * copies du même système à des fraîcheurs différentes, indépendamment de leur chemin ou de leur
 * nom de répertoire.
 */
export function regrouperCopiesRivales(candidats: readonly CandidatCopie[]): GroupeCopiesRivales[] {
  const parent = candidats.map((_, i) => i);
  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  }
  function unir(i: number, j: number): void {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < candidats.length; i++) {
    for (let j = i + 1; j < candidats.length; j++) {
      if (similariteCopies(candidats[i]!, candidats[j]!) >= SEUIL_SIMILARITE_GROUPE) unir(i, j);
    }
  }

  const indicesParRacine = new Map<number, number[]>();
  for (let i = 0; i < candidats.length; i++) {
    const racine = find(i);
    if (!indicesParRacine.has(racine)) indicesParRacine.set(racine, []);
    indicesParRacine.get(racine)!.push(i);
  }

  return [...indicesParRacine.values()].map((indices) => {
    const chemins = indices.map((i) => candidats[i]!.cheminRepertoire);
    const similarites: number[] = [];
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        similarites.push(similariteCopies(candidats[indices[a]!]!, candidats[indices[b]!]!));
      }
    }
    const similariteMoyenne =
      similarites.length > 0 ? similarites.reduce((s, x) => s + x, 0) / similarites.length : 1;
    return { chemins, similariteMoyenne };
  });
}

function dateLisible(epochMs: number): string {
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString().slice(0, 10) : 'date inconnue';
}

/**
 * Choisit la copie faisant foi parmi plusieurs répertoires candidats d'une même archive.
 * Écarte d'abord les gabarits vides, puis départage le reste sur la fraîcheur réelle des
 * données (date maximale observée), puis le volume, puis le nombre de tables non vides — jamais
 * sur le chemin. Chaque écart porte un motif lisible ; toute incohérence de fraîcheur est
 * remontée, jamais tranchée en silence.
 */
export function choisirCopieSourceDeVerite(
  candidats: readonly CandidatCopie[],
): ResultatSelectionCopie {
  const groupes = regrouperCopiesRivales(candidats);

  if (candidats.length === 0) {
    return { copieRetenue: null, copiesEcartees: [], groupes, incoherences: [] };
  }

  const copiesEcartees: CopieEcartee[] = [];
  const eligibles: CandidatCopie[] = [];

  for (const candidat of candidats) {
    if (estGabaritVide(candidat)) {
      copiesEcartees.push({
        cheminRepertoire: candidat.cheminRepertoire,
        motif: `gabarit vierge probable : ${candidat.tables.length} table(s) structurellement présentes mais ${totalLignesActives(candidat)} enregistrement(s) actif(s) au total — un modèle d'installation, jamais des données de garage.`,
      });
    } else {
      eligibles.push(candidat);
    }
  }

  if (eligibles.length === 0) {
    return {
      copieRetenue: null,
      copiesEcartees,
      groupes,
      incoherences: [
        "aucune copie exploitable : toutes les copies trouvées sont vides ou quasi vides (gabarits d'installation probables).",
      ],
    };
  }

  const notes = eligibles.map((candidat) => ({
    candidat,
    dateMax: Math.max(
      -Infinity,
      ...candidat.tables.map((t) => t.dateMaxObservee?.getTime() ?? -Infinity),
    ),
    total: totalLignesActives(candidat),
    nbTablesNonVides: candidat.tables.filter((t) => t.lignesActives > 0).length,
  }));
  notes.sort(
    (a, b) => b.dateMax - a.dateMax || b.total - a.total || b.nbTablesNonVides - a.nbTablesNonVides,
  );

  const retenue = notes[0]!;
  for (const note of notes.slice(1)) {
    let motif: string;
    if (note.dateMax < retenue.dateMax) {
      motif = `copie plus ancienne : donnée la plus récente observée le ${dateLisible(note.dateMax)}, contre le ${dateLisible(retenue.dateMax)} pour la copie retenue.`;
    } else if (note.total < retenue.total) {
      motif = `fraîcheur équivalente mais volume inférieur (${note.total} enregistrement(s) actif(s) contre ${retenue.total}).`;
    } else {
      motif = "écartée au profit d'une copie à fraîcheur et volume au moins équivalents.";
    }
    copiesEcartees.push({ cheminRepertoire: note.candidat.cheminRepertoire, motif });
  }

  const incoherences: string[] = [];
  const totalMax = Math.max(...notes.map((n) => n.total));
  if (retenue.total < totalMax) {
    const plusVolumineuse = notes.find((n) => n.total === totalMax)!;
    incoherences.push(
      `la copie retenue ("${retenue.candidat.cheminRepertoire}") n'est pas la plus volumineuse de l'archive : "${plusVolumineuse.candidat.cheminRepertoire}" contient ${plusVolumineuse.total} enregistrement(s) actif(s) contre ${retenue.total} — vérifier que la fraîcheur ne masque pas un import partiel avant de confirmer.`,
    );
  }

  return { copieRetenue: retenue.candidat.cheminRepertoire, copiesEcartees, groupes, incoherences };
}

const ROLES_DEPENDANTS: Partial<Record<RoleMetier, RoleMetier[]>> = {
  client: ['document_vente', 'ordre_reparation', 'paiement'],
  vehicule: ['ordre_reparation'],
};

/**
 * Signale, au sein d'une même copie déjà classifiée (`evaluerRoleTable` sur chacune de ses
 * tables), qu'un rôle central (client, véhicule) n'a été retenu par aucune table alors qu'un
 * rôle qui en dépend typiquement (document de vente, OR, paiement) est lui bien peuplé — cas
 * mesuré : la facturation résolvait ses clients à 99,4% contre un fichier clients absent de son
 * propre répertoire, signal que la copie est incomplète plutôt qu'un simple constat neutre.
 */
export function detecterIncoherenceRoleVide(rapports: readonly RapportTable[]): string[] {
  const meilleureParRole = new Map<RoleMetier, RapportTable>();
  for (const rapport of rapports) {
    const top = rapport.evaluations[0];
    if (!top || top.role === 'inconnu') continue;
    const existant = meilleureParRole.get(top.role);
    if (!existant || top.confiance > existant.evaluations[0]!.confiance)
      meilleureParRole.set(top.role, rapport);
  }

  const messages: string[] = [];
  for (const roleCentral of Object.keys(ROLES_DEPENDANTS) as RoleMetier[]) {
    if (meilleureParRole.has(roleCentral)) continue; // rôle central bien représenté : rien à signaler
    const dependants = ROLES_DEPENDANTS[roleCentral] ?? [];
    const dependantPeuple = dependants
      .map((d) => meilleureParRole.get(d))
      .find((r): r is RapportTable => r !== undefined && r.lignesActives > 0);
    if (dependantPeuple) {
      messages.push(
        `aucune table de cette copie n'a été classée "${roleCentral}" avec confiance, alors que "${dependantPeuple.table}" (classée "${dependantPeuple.evaluations[0]!.role}", ${dependantPeuple.lignesActives} lignes actives) en dépend typiquement : la table centrale attendue est probablement absente ou vide dans cette copie.`,
      );
    }
  }
  return messages;
}
