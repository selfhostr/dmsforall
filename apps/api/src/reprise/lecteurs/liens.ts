/**
 * Détection de liens entre tables par appariement de valeurs mesuré — aucun de ces moteurs ne
 * déclare de clé étrangère (intégrité 100% applicative), donc les liens ne peuvent être que
 * mesurés, jamais lus dans un schéma.
 *
 * Fonction pure : prend des tables déjà échantillonnées en mémoire, aucune I/O.
 */
import type { LienCandidat, LigneTable } from './types';

export interface TableEchantillonnee {
  nom: string;
  colonnes: readonly string[];
  lignes: readonly LigneTable[];
}

const EFFECTIF_MIN = 5;
const TAUX_APPARIEMENT_MIN = 0.6;
/** La colonne cible doit ressembler à une clé (quasi toutes ses valeurs distinctes) pour servir de référence. */
const UNICITE_CLE_MIN = 0.9;

function pct(x: number): number {
  return Math.round(x * 100);
}

function valeursColonneBrutes(lignes: readonly LigneTable[], colonne: string): string[] {
  const valeurs: string[] = [];
  for (const ligne of lignes) {
    const v = ligne.valeurs[colonne];
    if (v === null || v === undefined || v instanceof Buffer) continue;
    const texte = (v instanceof Date ? v.toISOString() : String(v)).trim();
    if (texte.length === 0) continue;
    valeurs.push(texte);
  }
  return valeurs;
}

/**
 * Pour chaque paire de tables et chaque paire de colonnes, mesure le taux d'appariement d'une
 * colonne "source" contre une colonne "cible" candidate-clé (quasi unique). Rend les liens dont
 * le taux dépasse le seuil, triés du plus fort au plus faible.
 *
 * Coût O(nb_tables² × nb_colonnes²) : acceptable sur un échantillon borné (quelques centaines à
 * quelques milliers de lignes par table), pas sur des tables entières de plusieurs millions de
 * lignes — c'est un choix délibéré, documenté dans le rapport de livraison.
 */
export function detecterLiens(tables: readonly TableEchantillonnee[]): LienCandidat[] {
  const liens: LienCandidat[] = [];

  for (const cible of tables) {
    for (const colonneCible of cible.colonnes) {
      const valeursCible = valeursColonneBrutes(cible.lignes, colonneCible);
      if (valeursCible.length < EFFECTIF_MIN) continue;
      const ensembleCible = new Set(valeursCible);
      const unicite = ensembleCible.size / valeursCible.length;
      if (unicite < UNICITE_CLE_MIN) continue;

      for (const source of tables) {
        if (source.nom === cible.nom) continue;
        for (const colonneSource of source.colonnes) {
          const valeursSource = valeursColonneBrutes(source.lignes, colonneSource);
          if (valeursSource.length < EFFECTIF_MIN) continue;

          let nbApparies = 0;
          for (const v of valeursSource) if (ensembleCible.has(v)) nbApparies++;
          const taux = nbApparies / valeursSource.length;
          if (taux < TAUX_APPARIEMENT_MIN) continue;

          liens.push({
            tableSource: source.nom,
            colonneSource,
            tableCible: cible.nom,
            colonneCible,
            tauxAppariement: taux,
            raison: `${pct(taux)}% des ${valeursSource.length} valeurs non vides de "${source.nom}.${colonneSource}" se retrouvent dans "${cible.nom}.${colonneCible}" (colonne quasi unique, ${pct(unicite)}% de valeurs distinctes) : lien plausible.`,
          });
        }
      }
    }
  }

  return liens.sort((a, b) => b.tauxAppariement - a.tauxAppariement);
}

/**
 * Trahit un rapport de cardinalité en-tête/lignes : la table B a nettement plus d'enregistrements
 * que la table A ET un lien mesuré de B vers A existe (B référence A) -> B est plausiblement les
 * lignes détaillées de l'en-tête A.
 */
export function suggererPairesEnTeteLignes(
  tables: readonly { nom: string; lignesActives: number }[],
  liens: readonly LienCandidat[],
  ratioMin = 1.5,
): { enTete: string; lignes: string; ratio: number; lien: LienCandidat }[] {
  const cardinalite = new Map(tables.map((t) => [t.nom, t.lignesActives]));
  const paires: { enTete: string; lignes: string; ratio: number; lien: LienCandidat }[] = [];

  for (const lien of liens) {
    const nbSource = cardinalite.get(lien.tableSource) ?? 0;
    const nbCible = cardinalite.get(lien.tableCible) ?? 0;
    if (nbCible === 0) continue;
    const ratio = nbSource / nbCible;
    if (ratio >= ratioMin) {
      paires.push({ enTete: lien.tableCible, lignes: lien.tableSource, ratio, lien });
    }
  }
  return paires.sort((a, b) => b.ratio - a.ratio);
}
