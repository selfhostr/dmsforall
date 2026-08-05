import type { ReponseRegleRelance } from '@dfa/shared';

import type { LigneRegleRelance } from '../db/schema';

/** `Date` → ISO 8601, jamais un `Date` qui traverserait la frontière JSON telle quelle (même
 *  doctrine que le reste du dépôt : la couche HTTP ne rend que des chaînes normalisées). */
function versIso(valeur: Date): string {
  return valeur.toISOString();
}

export function versReponseRegleRelance(ligne: LigneRegleRelance): ReponseRegleRelance {
  return {
    typeRelance: ligne.typeRelance,
    actif: ligne.actif,
    delaisJours: ligne.delaisJours ?? [],
    canaux: ligne.canaux ?? [],
    texteModeleId: ligne.texteModeleId,
    prereglageAppliqueLe: ligne.prereglageAppliqueLe ? versIso(ligne.prereglageAppliqueLe) : null,
    creeLe: versIso(ligne.creeLe),
    modifieLe: versIso(ligne.modifieLe),
  };
}
