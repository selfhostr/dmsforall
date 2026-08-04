import type { ReponseLigneOr, ReponseOrdreReparation } from '@dfa/shared';

/**
 * Lignes qu'un technicien peut raisonnablement pointer : jamais `refusee`/`annulee` (RM-93 les
 * refuse au démarrage, `409 POINTAGE_LIGNE_NON_POINTABLE`) ni `facturee` (déjà figée). Un filtrage
 * d'ERGONOMIE — le serveur reste l'arbitre final si l'état a changé entre le chargement de l'OR et
 * le clic (l'écran affiche alors l'erreur serveur normalement, via `messageErreur`).
 *
 * SOURCE UNIQUE pour ce critère : avant ce fichier, `DialogueChoixCiblePointage.tsx` définissait
 * son propre `STATUTS_LIGNE_POINTABLE`/`ligneEstPointable` localement, et « Mes OR du jour »
 * (`EcranPointageTechnicien.tsx`) affichait `or.nombreLignes` — le total de TOUTES les lignes de
 * l'OR (compté côté serveur, `count(*) ... statut <> 'annulee'`, sans filtrer par technicien : voir
 * `apps/api/src/atelier/service-or.ts`, méthode `lister`). Un OR dont les 2 lignes ont
 * `technicienId: null` affichait alors « 2 lignes assignées » sur la carte et « Aucune ligne
 * assignée » dans le détail — même OR, deux définitions différentes de « assignée ». Bug constaté
 * en réel sur OR-2026-15. Les deux écrans DOIVENT désormais appeler les mêmes fonctions ci-dessous.
 */
const STATUTS_LIGNE_POINTABLE = new Set([
  'proposee',
  'a_valider',
  'validee',
  'en_cours',
  'realisee',
]);

export function ligneEstPointable(ligne: ReponseLigneOr): boolean {
  return STATUTS_LIGNE_POINTABLE.has(ligne.statut);
}

/** Une ligne est « assignée » à un technicien = `ligne.technicienId` est ÉGAL à l'identifiant du
 *  technicien de la session courante — jamais un autre critère (ni `null`, ni un autre technicien,
 *  ni « l'OR entier lui appartient »). C'est la définition déjà appliquée par
 *  `DialogueChoixCiblePointage` avant ce fichier ; ce module la rend réutilisable et la verrouille
 *  par test, pour que la carte « Mes OR du jour » ne puisse plus en diverger silencieusement. */
function ligneEstAssignee(ligne: ReponseLigneOr, technicienId: string): boolean {
  return ligne.technicienId === technicienId;
}

/**
 * Lignes assignées ET pointables d'un OR, pour un technicien donné — le même sous-ensemble que
 * propose `DialogueChoixCiblePointage` (« Que pointez-vous ? »).
 *
 * LIMITE CONNUE, héritée du serveur : `ReponseOrdreReparation.lignes` est plafonné à 200 entrées
 * (`SEUIL_LIGNES_EMBARQUEES`, voir `service-or.ts`) — si `or.lignesTronquees` vaut `true`, ce
 * compte peut sous-estimer les lignes assignées au-delà des 200 premières. Cas extrême pour un OR
 * de garage, non traité ici (signalé, pas silencieux).
 */
export function lignesAssigneesPointables(
  or: Pick<ReponseOrdreReparation, 'lignes'>,
  technicienId: string,
): readonly ReponseLigneOr[] {
  return or.lignes.filter(
    (ligne) => ligneEstAssignee(ligne, technicienId) && ligneEstPointable(ligne),
  );
}

/** Nombre de lignes assignées et pointables — c'est CE nombre, et seulement celui-là, que « Mes OR
 *  du jour » doit afficher à côté de chaque OR (jamais `or.nombreLignes`, qui compte toutes les
 *  lignes de l'OR sans distinction de technicien). */
export function compterLignesAssigneesPointables(
  or: Pick<ReponseOrdreReparation, 'lignes'>,
  technicienId: string,
): number {
  return lignesAssigneesPointables(or, technicienId).length;
}
