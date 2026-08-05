import { useTranslation } from 'react-i18next';

import type { ReponseContexteAtelier, ReponseVehicule } from '@dfa/shared';

import { formaterDate, formaterKilometrage } from '@/lib/formats';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { BoutonCopier } from '@/composants/vehicule/BoutonCopier';
import { ChampEmplacementVehicule } from '@/composants/vehicule/ChampEmplacementVehicule';

interface Props {
  readonly vehicule: ReponseVehicule;
  readonly dernierKilometrage: ReponseContexteAtelier['dernierKilometrage'];
}

interface DefinitionChamp {
  readonly libelle: string;
  readonly valeur: string;
  readonly copiable?: boolean;
}

/**
 * En-tête de fiche : identité compacte (`IdentiteVehicule`, taille `xl` — invariant n°1, jamais
 * recomposée localement) + les champs d'identification que le comptoir lit au téléphone (VIN,
 * code type, kilométrage actuel). Le kilométrage vient du contexte-atelier (`dernierKilometrage`),
 * pas de `ReponseVehicule` qui ne le porte pas — voir `packages/shared/…/vehicule.ts`.
 */
export function EnTeteFicheVehicule({ vehicule, dernierKilometrage }: Props) {
  const { t } = useTranslation('vehicules');

  const champs: DefinitionChamp[] = [];
  if (vehicule.vin)
    champs.push({ libelle: t('identite.vin'), valeur: vehicule.vin, copiable: true });
  if (vehicule.codeTypeCh)
    champs.push({ libelle: t('identite.codeType'), valeur: vehicule.codeTypeCh, copiable: true });
  if (vehicule.premiereMiseEnCirculationLe) {
    champs.push({
      libelle: t('identite.mise1reCirc'),
      valeur: formaterDate(vehicule.premiereMiseEnCirculationLe),
    });
  }
  if (dernierKilometrage) {
    champs.push({
      libelle: t('identite.kmActuels'),
      valeur: formaterKilometrage(dernierKilometrage.valeurKm, 'km'),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <IdentiteVehicule vehicule={vehicule} taillePlaque="xl" />
      {champs.length > 0 ? (
        <dl className="densite-dense flex flex-wrap gap-x-6 gap-y-1">
          {champs.map((champ) => (
            <div key={champ.libelle} className="flex items-center gap-1">
              <dt className="texte-libelle text-muted-foreground">{champ.libelle} :</dt>
              <dd className="flex items-center gap-1 texte-corps font-medium">
                {champ.valeur}
                {champ.copiable ? <BoutonCopier valeur={champ.valeur} className="h-8 w-8" /> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ChampEmplacementVehicule
        vehiculeId={vehicule.id}
        emplacement={vehicule.emplacementLibre}
        majLe={vehicule.emplacementMajLe}
      />
    </div>
  );
}
