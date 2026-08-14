import type { ActiviteIndirecte, ReponsePointage } from '@dfa/shared';

import { bornesJourneeLocale, dateJourLocale } from './temps-pointage';
import { useListePointages, type ResultatListePointages } from './useListePointages';

/**
 * Descripteur minimal d'une cible de pointage — mêmes trois formes que `CibleMemorisee`
 * (`EcranPointageTechnicien.tsx`), mais sans libellé ni site : ce module ne fait QUE comparer des
 * identifiants pour cumuler des durées, jamais de l'affichage (voir `libelles.ts` pour ça).
 */
export type CibleCumulJour =
  | {
      readonly nature: 'productif_ligne';
      readonly ordreReparationId: string;
      readonly ligneOrId: string;
    }
  | { readonly nature: 'productif_or'; readonly ordreReparationId: string }
  | { readonly nature: 'indirect'; readonly activiteIndirecte: ActiviteIndirecte };

/**
 * `ReponsePointage` -> `CibleCumulJour`, pour le cumul « Aujourd'hui sur cette cible » du segment
 * COURAMMENT pointé (`CartePointageEnCours`, point 6 — les trois natures sont possibles ici, à la
 * différence d'une cible MÉMORISÉE de reprise qui n'est jamais `indirect`, voir
 * `EcranPointageTechnicien.tsx#cibleCumulDepuisMemoire`). Partagé par `EcranPointageTechnicien` ET
 * `EcranBornePointage` — même carte `CartePointageEnCours`, même calcul. `undefined` dans les cas
 * frontière où l'identifiant attendu par la nature manque (ne DEVRAIT pas arriver, `ReponsePointage`
 * le garantit par nature — repli défensif plutôt qu'une hypothèse non vérifiée à l'exécution).
 */
export function cibleCumulDepuisPointage(pointage: {
  readonly nature: 'productif_ligne' | 'productif_or' | 'indirect';
  readonly ordreReparationId: string | null;
  readonly ligneOrId: string | null;
  readonly activiteIndirecte: ActiviteIndirecte | null;
}): CibleCumulJour | undefined {
  if (pointage.nature === 'productif_ligne' && pointage.ordreReparationId && pointage.ligneOrId) {
    return {
      nature: 'productif_ligne',
      ordreReparationId: pointage.ordreReparationId,
      ligneOrId: pointage.ligneOrId,
    };
  }
  if (pointage.nature === 'productif_or' && pointage.ordreReparationId) {
    return { nature: 'productif_or', ordreReparationId: pointage.ordreReparationId };
  }
  if (pointage.nature === 'indirect' && pointage.activiteIndirecte) {
    return { nature: 'indirect', activiteIndirecte: pointage.activiteIndirecte };
  }
  return undefined;
}

function pointageCorrespondACible(pointage: ReponsePointage, cible: CibleCumulJour): boolean {
  if (cible.nature === 'productif_ligne') {
    return pointage.nature === 'productif_ligne' && pointage.ligneOrId === cible.ligneOrId;
  }
  if (cible.nature === 'productif_or') {
    return (
      pointage.nature === 'productif_or' && pointage.ordreReparationId === cible.ordreReparationId
    );
  }
  return pointage.nature === 'indirect' && pointage.activiteIndirecte === cible.activiteIndirecte;
}

/**
 * Somme des durées BRUTES (secondes) déjà pointées AUJOURD'HUI sur `cible`, tous segments confondus
 * (RM-116 : une pause puis une reprise sur la même ligne sont deux segments distincts, jamais
 * fusionnés en base — « Deux nombres, jamais un seul », `CartePointageEnCours`/`BandeauReprisePointage`).
 *
 * Un pointage encore `en_cours` compte pour `0` (`dureeBruteSecondes` vaut alors `null` : sa durée
 * n'est pas encore figée, même doctrine que `agregats-pointage.ts#dureeComptabilisable`) — le
 * chrono live de la carte affiche déjà CE segment séparément ; l'additionner ici le compterait deux
 * fois. Absence de segment antérieur -> `0` -> l'appelant n'affiche alors QUE le chrono, jamais un
 * cumul à zéro qui polluerait la première visite du jour sur cette cible.
 */
export function calculerCumulSecondesCible(
  pointages: readonly ReponsePointage[],
  cible: CibleCumulJour,
): number {
  return pointages
    .filter((pointage) => pointageCorrespondACible(pointage, cible))
    .reduce((total, pointage) => total + (pointage.dureeBruteSecondes ?? 0), 0);
}

/**
 * Tous les pointages du technicien courant pour AUJOURD'HUI (calendrier local, `temps-pointage.ts`)
 * — source COMMUNE à deux affichages distincts qui ne doivent jamais déclencher deux requêtes
 * réseau séparées : le cumul « Aujourd'hui sur cette cible » de `CartePointageEnCours` (cible du
 * segment courant) et celui du bandeau de reprise (cible MÉMORISÉE, potentiellement différente du
 * segment courant pendant une activité indirecte) — voir `calculerCumulSecondesCible` ci-dessus,
 * appelé deux fois sur le même résultat avec deux `cible` différentes.
 *
 * Purement ADDITIF : cette requête ne porte aucun état qui conditionne un geste de pointage — un
 * chargement en cours ou une erreur ne bloque donc JAMAIS l'écran, le cumul se contente de ne pas
 * s'afficher tant qu'elle n'a pas abouti (repli « chrono seul »), jamais un état d'erreur dédié pour
 * un total secondaire (à la différence de `pointageOuvert`/`mesOrdres`, dont l'échec EST bloquant).
 */
export function useCumulsPointagesJour(technicienId: string | undefined): ResultatListePointages {
  const bornes = bornesJourneeLocale(dateJourLocale());
  return useListePointages(
    { technicienId, debutDu: bornes.debutDu, debutAu: bornes.debutAu, tri: 'debutLe:desc' },
    { enabled: Boolean(technicienId) },
  );
}
