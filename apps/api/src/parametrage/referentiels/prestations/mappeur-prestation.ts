import type { ReponsePrestation } from '@dfa/shared';
import type { schema } from '../../../db';

/**
 * `designation` doit porter les 3 langues (`Readonly<Record<Langue,string>>`), mais `designation_de`
 * et `designation_it` sont NULLABLES en base (seule `designation_fr` est obligatoire — source,
 * §1.3). Repli sur le FR plutôt qu'une chaîne vide : un onglet DE affichant le libellé français
 * reste lisible et actionnable pour le garagiste, une chaîne vide ne l'est pas.
 */
export function versDtoPrestation(prestation: schema.LignePrestation, prixCentimesActuel: number | null): ReponsePrestation {
  return {
    id: prestation.id,
    code: prestation.code,
    designation: {
      fr: prestation.designationFr,
      de: prestation.designationDe ?? prestation.designationFr,
      it: prestation.designationIt ?? prestation.designationFr,
    },
    typeLigne: prestation.typeLigne,
    tempsBaremeCentiemes: prestation.tempsBaremeCentiemes,
    tauxHoraireCode: prestation.tauxHoraireCode,
    tauxTvaPourmille: prestation.tauxTvaPourmille,
    prixCentimes: prixCentimesActuel,
    actif: prestation.actif,
  };
}
