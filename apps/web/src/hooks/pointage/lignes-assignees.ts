import type { ReponseLigneOr, ReponseOrdreReparation, StatutLigneOr } from '@dfa/shared';

/**
 * Lignes qu'un technicien peut raisonnablement pointer : un filtrage d'ERGONOMIE — le serveur
 * reste l'arbitre final si l'état a changé entre le chargement de l'OR et le clic (l'écran
 * affiche alors l'erreur serveur normalement, via `messageErreur`).
 *
 * ATTENTION — DÉCALAGE CONNU AVEC LE SERVEUR (RM-93) : cette constante accepte `'proposee'`,
 * `'a_valider'` et `'realisee'` en plus des statuts que le serveur accepte réellement
 * (`'validee'`/`'en_cours'`). Le serveur rejettera un pointage sur ces trois statuts avec `409
 * POINTAGE_LIGNE_NON_POINTABLE`. Pour obtenir la liste des statuts RÉELLEMENT pointables selon
 * la règle serveur (RM-93), voir `STATUTS_LIGNE_REELLEMENT_POINTABLES_RM93` et
 * `ligneEstReellementPointableRM93()` ci-dessous. `DialogueChoixCiblePointage.tsx` applique un
 * correctif local qui filtre davantage sur ces deux statuts uniquement.
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

/**
 * RM-93 (règle serveur, voir `apps/api/src/pointage/regles-pointage.ts::estLignePointable`) :
 * UNIQUEMENT ces deux statuts sont acceptés au démarrage d'un pointage — tout autre statut
 * entraîne un rejet `409 POINTAGE_LIGNE_NON_POINTABLE`. Cette constante CORRIGE le décalage
 * documenté ci-dessus sur `STATUTS_LIGNE_POINTABLE`.
 */
const STATUTS_LIGNE_REELLEMENT_POINTABLES_RM93: ReadonlySet<StatutLigneOr> = new Set([
  'validee',
  'en_cours',
]);

export function ligneEstPointable(ligne: ReponseLigneOr): boolean {
  return STATUTS_LIGNE_POINTABLE.has(ligne.statut);
}

/**
 * Vraie règle du serveur (RM-93, `apps/api/src/pointage/regles-pointage.ts::estLignePointable`) —
 * à privilégier pour tout code nouveau. Le hook `lignesPointables()` reste plus permissif pour
 * compatibilité avec l'affichage existant ; cette fonction expose la vérité serveur.
 */
export function ligneEstReellementPointableRM93(ligne: ReponseLigneOr): boolean {
  return STATUTS_LIGNE_REELLEMENT_POINTABLES_RM93.has(ligne.statut);
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
 * Lignes assignées ET pointables d'un OR, pour un technicien donné — sert désormais UNIQUEMENT le
 * repère organisationnel de « Mes OR du jour » (compteur de carte, voir `compterLignesAssigneesPointables`
 * ci-dessous), PLUS `DialogueChoixCiblePointage` avant l'choix produit du 14.08.2026 ci-dessous.
 *
 * ARBITRAGE @laupernoe (14.08.2026, NE PAS ROUVRIR) : un technicien peut pointer une ligne sans y être
 * assigné (la base l'autorise déjà — RM-121, plusieurs pointages simultanés sur une même ligne ; le
 * serveur, `ServicePointage.demarrer`, ne vérifie JAMAIS l'assignation). Cas réel : l'apprenti qui
 * prête main-forte au compagnon ne doit pas faire un aller-retour au bureau pour se faire assigner.
 * `DialogueChoixCiblePointage` (« Que pointez-vous ? ») utilise donc `lignesPointables` ci-dessous
 * (TOUTES les lignes pointables de l'OR, sans filtre d'assignation) — jamais cette fonction-ci.
 * `lignesAssigneesPointables` reste exacte et utile ailleurs : l'assignation redevient un simple
 * REPÈRE D'ORGANISATION (qui d'habitude s'occupe de quoi), pas un droit de pointer — « Mes OR du
 * jour » continue donc de compter et lister CE repère, inchangé par cet arbitrage.
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

/**
 * TOUTES les lignes pointables d'un OR, SANS filtre d'assignation — ce que
 * `DialogueChoixCiblePointage` (« Que pointez-vous ? ») propose désormais au technicien, suite à
 * l'choix produit du 14.08.2026 documenté ci-dessus sur `lignesAssigneesPointables`. Même critère de
 * statut que le reste de ce fichier (`ligneEstPointable` — jamais `refusee`/`annulee`/`facturee`),
 * SEULE différence : aucune comparaison à `technicienId`. L'assignation existante de chaque ligne
 * reste lisible par l'appelant via `ligne.technicienId` (à afficher comme une INFORMATION — « assignée
 * à un autre technicien » — jamais comme un blocage : voir `DialogueChoixCiblePointage`).
 */
export function lignesPointables(
  or: Pick<ReponseOrdreReparation, 'lignes'>,
): readonly ReponseLigneOr[] {
  return or.lignes.filter(ligneEstPointable);
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
