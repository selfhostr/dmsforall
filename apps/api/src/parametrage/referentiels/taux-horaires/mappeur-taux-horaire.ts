import type { ReponseTauxHoraire } from '@dfa/shared';
import type { schema } from '../../../db';

/** `date` PostgreSQL rendue en `string` (`aaaa-mm-jj`) par le driver `pg` — pas de conversion à faire. */
export function versDtoTauxHoraire(ligne: schema.LigneTauxHoraire): ReponseTauxHoraire {
  return {
    id: ligne.id,
    code: ligne.code,
    libelle: ligne.libelle,
    montantCentimes: ligne.montantCentimes,
    valideDuLe: ligne.valideDu,
    valideAuLe: ligne.valideAu,
  };
}
