import type { ReponsePointage } from '@dfa/shared';

/**
 * Agrégations CLIENT, pures — aucune requête réseau ici. `GET /pointages/indicateurs` (RM-99,
 * `contrats/pointage/indicateurs.ts`) N'EST PAS implémenté côté serveur à ce jour (aucun contrôleur
 * ne l'expose — vérifié dans `apps/api/src/pointage/*.controller.ts`), donc les vues jour/semaine
 * et équipe de ce module calculent leurs cumuls à partir de la collection `GET /pointages` déjà
 * disponible, plutôt que d'attendre l'indicateur serveur. À REMPLACER par l'indicateur serveur
 * quand il existera (formules RM-99 précises, arrondi P-19 appliqué une seule fois côté serveur) —
 * ce fichier ne fait qu'une somme brute en SECONDES, jamais un arrondi métier.
 */

export interface CumulTechnicienPeriode {
  readonly technicienId: string;
  /** `ReponsePointage.technicienNomAffiche` du premier pointage rencontré pour ce technicien dans
   *  le lot (défaut 1 : avant ce champ, l'écran repliait sur un UUID tronqué faute de nom —
   *  toujours renseigné côté serveur, donc jamais de repli à faire ici). */
  readonly technicienNomAffiche: string;
  /** Somme des pointages `productif_ligne` + `productif_or`, en secondes BRUTES (RM-97 : jamais
   *  arrondi ici — l'arrondi P-19 est une compétence serveur, absente du jeu de données dont ce
   *  fichier dispose). */
  readonly productifSecondes: number;
  /** Somme des pointages `indirect` (RM-122 : présent et payé, pas un trou de présence). */
  readonly indirectSecondes: number;
  /** `productifSecondes + indirectSecondes`. */
  readonly presenceSecondes: number;
  /** `true` si au moins un pointage de ce technicien, dans le lot fourni, est encore `en_cours`
   *  (sa durée ne compte alors pour RIEN dans les sommes ci-dessus — voir `dureeBruteSecondes`). */
  readonly enCours: boolean;
  /** Nombre de pointages du lot portant une anomalie non traitée (`anomalie !== null &&
   *  anomalie.traiteeLe === null`). */
  readonly nombreAnomalies: number;
}

/** Durée d'UN pointage à faire compter dans un cumul — `dureeBruteSecondes` tant qu'il est connu
 *  (pointage `termine`/`valide`/`verrouille`), `0` pour un pointage encore `en_cours` (sa durée
 *  n'est pas encore figée ; l'inclure ferait dériver le cumul à chaque rafraîchissement de la page
 *  tant que le technicien n'a pas arrêté). */
function dureeComptabilisable(pointage: ReponsePointage): number {
  return pointage.dureeBruteSecondes ?? 0;
}

function estProductif(pointage: ReponsePointage): boolean {
  return pointage.nature === 'productif_ligne' || pointage.nature === 'productif_or';
}

function porteAnomalieNonTraitee(pointage: ReponsePointage): boolean {
  return pointage.anomalie !== null && pointage.anomalie.traiteeLe === null;
}

/** Regroupe une collection de pointages (déjà filtrée par période/site par l'appelant, via
 *  `GET /pointages?debutDu=&debutAu=`) par technicien. Tri de sortie : le plus présent d'abord
 *  (`presenceSecondes` décroissant) — lecture naturelle pour un chef d'atelier qui balaie sa
 *  journée du haut vers le bas. */
export function calculerCumulsParTechnicien(
  pointages: readonly ReponsePointage[],
): readonly CumulTechnicienPeriode[] {
  const parTechnicien = new Map<
    string,
    {
      nomAffiche: string;
      productif: number;
      indirect: number;
      enCours: boolean;
      anomalies: number;
    }
  >();

  for (const pointage of pointages) {
    const entree = parTechnicien.get(pointage.technicienId) ?? {
      nomAffiche: pointage.technicienNomAffiche,
      productif: 0,
      indirect: 0,
      enCours: false,
      anomalies: 0,
    };
    const secondes = dureeComptabilisable(pointage);
    if (estProductif(pointage)) {
      entree.productif += secondes;
    } else {
      entree.indirect += secondes;
    }
    if (pointage.statut === 'en_cours') entree.enCours = true;
    if (porteAnomalieNonTraitee(pointage)) entree.anomalies += 1;
    parTechnicien.set(pointage.technicienId, entree);
  }

  return Array.from(parTechnicien.entries())
    .map(([technicienId, valeurs]) => ({
      technicienId,
      technicienNomAffiche: valeurs.nomAffiche,
      productifSecondes: valeurs.productif,
      indirectSecondes: valeurs.indirect,
      presenceSecondes: valeurs.productif + valeurs.indirect,
      enCours: valeurs.enCours,
      nombreAnomalies: valeurs.anomalies,
    }))
    .sort((a, b) => b.presenceSecondes - a.presenceSecondes);
}

/** Cumul total (tous techniciens confondus) d'un lot de pointages — ligne « Total » d'un tableau
 *  jour/semaine. */
export function calculerCumulTotal(
  pointages: readonly ReponsePointage[],
): Omit<CumulTechnicienPeriode, 'technicienId' | 'technicienNomAffiche'> {
  const cumuls = calculerCumulsParTechnicien(pointages);
  let productifSecondes = 0;
  let indirectSecondes = 0;
  let presenceSecondes = 0;
  let enCours = false;
  let nombreAnomalies = 0;

  for (const cumul of cumuls) {
    productifSecondes += cumul.productifSecondes;
    indirectSecondes += cumul.indirectSecondes;
    presenceSecondes += cumul.presenceSecondes;
    enCours = enCours || cumul.enCours;
    nombreAnomalies += cumul.nombreAnomalies;
  }

  return { productifSecondes, indirectSecondes, presenceSecondes, enCours, nombreAnomalies };
}
