import type { StatutOrdreReparation } from '@dfa/shared';

/**
 * Le cœur du chantier RDV (brief orchestrateur) : `ordre_reparation.restitution_promise_le`
 * existe en base depuis le lot 1 mais aucun service ne l'écrit jamais — donc aucun retard n'est
 * calculable, et deux tableaux de bord (chef d'atelier, réceptionniste) finissent par lire deux
 * réalités différentes du même OR (l'un déduit une sortie du jour par une autre voie, l'autre lit
 * un champ resté vide).
 *
 * Ce fichier pose l'UNIQUE calcul de « en retard » — appelé une seule fois, dans
 * `ServiceOr.assemblerDocument` (`service-or.ts`), jamais recalculé ni réinterprété par un
 * consommateur. Deux écrans qui liraient chacun leur propre notion de retard sont exactement le
 * bug que ce fichier ferme.
 *
 * États TERMINAUX volontairement exclus (`restitue`, `cloture`, `annule`) : une fois le véhicule
 * effectivement restitué (ou l'OR clos/annulé), comparer « maintenant » à la promesse n'a plus de
 * sens opérationnel — le retard éventuel appartient à l'histoire (mesurable via
 * `restitutionInitialeLe` vs `restitueLe`, RM-56), pas à un indicateur « à traiter aujourd'hui ».
 *
 * RÈGLE NON NÉGOCIABLE (rappelée explicitement dans le brief) : **une date promise absente n'est
 * JAMAIS un retard.** `restitutionPromiseLe === null` rend systématiquement `false`, quel que soit
 * le statut — « on ne sait pas » et « en retard » ne partagent jamais le même rendu.
 */

const STATUTS_OU_LE_RETARD_NE_SE_MESURE_PLUS: ReadonlySet<StatutOrdreReparation> = new Set([
  'restitue',
  'cloture',
  'annule',
]);

export interface OrdrePourCalculRetard {
  readonly statut: StatutOrdreReparation;
  readonly restitutionPromiseLe: Date | null;
}

export function estRestitutionEnRetard(or: OrdrePourCalculRetard, maintenant: Date): boolean {
  if (or.restitutionPromiseLe === null) return false;
  if (STATUTS_OU_LE_RETARD_NE_SE_MESURE_PLUS.has(or.statut)) return false;
  return maintenant.getTime() > or.restitutionPromiseLe.getTime();
}
