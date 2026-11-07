import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import {
  ChampAutocompletionVehicule,
  type OptionAutocompletionVehicule,
} from '@/composants/vehicules/ChampAutocompletionVehicule';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useMarquesVehicule } from '@/hooks/vehicules/useMarquesVehicule';
import { useModelesVehicule } from '@/hooks/vehicules/useModelesVehicule';

interface Props {
  readonly idPrefixe: string;
  readonly marque: string;
  readonly modele: string;
  readonly onMarqueChange: (valeur: string) => void;
  readonly onModeleChange: (valeur: string) => void;
  readonly disabled?: boolean;
  readonly erreurMarque?: string;
  readonly erreurModele?: string;
}

/**
 * Marque + modèle avec suggestions du référentiel suisse. Saisie libre toujours possible (le
 * référentiel suggère, il n'impose pas) ; changer de marque en choisissant une suggestion vide le
 * modèle, une simple correction de frappe ne l'efface jamais.
 */
export function ChampsMarqueModele({
  idPrefixe,
  marque,
  modele,
  onMarqueChange,
  onModeleChange,
  disabled,
  erreurMarque,
  erreurModele,
}: Props) {
  const { t } = useTranslation(['vehicules']);
  const [marqueTemporisee] = useValeurDebouncee(marque);
  const [modeleTemporise] = useValeurDebouncee(modele);
  const actif = marqueTemporisee.trim() !== '';
  const marques = useMarquesVehicule(marqueTemporisee, { enabled: actif });
  const modeles = useModelesVehicule(marqueTemporisee, modeleTemporise, { enabled: actif });
  const derniereMarqueConfirmee = useRef('');

  const optionsMarques: readonly OptionAutocompletionVehicule[] = (marques.data?.marques ?? []).map(
    (m) => ({
      valeur: m.nom,
      complement: t('vehicules:identite.autocompletion.nombreModeles', { count: m.nombreModeles }),
    }),
  );
  const optionsModeles: readonly OptionAutocompletionVehicule[] = (modeles.data?.modeles ?? []).map(
    (m) => ({ valeur: m.nom, complement: m.codeTypeCh }),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefixe}-marque`} requis>
          {t('vehicules:identite.marque')}
        </Label>
        <ChampAutocompletionVehicule
          id={`${idPrefixe}-marque`}
          libelle={t('vehicules:identite.marque')}
          valeur={marque}
          onValeurChange={onMarqueChange}
          options={optionsMarques}
          enChargement={marques.isFetching}
          erreur={marques.isError ? t('vehicules:identite.autocompletion.erreurRecherche') : null}
          placeholder={t('vehicules:identite.autocompletion.placeholderMarque')}
          disabled={disabled}
          ariaInvalid={erreurMarque ? true : undefined}
          onSelectionOption={(option) => {
            if (option.valeur !== derniereMarqueConfirmee.current) onModeleChange('');
            derniereMarqueConfirmee.current = option.valeur;
          }}
        />
        {erreurMarque ? <p className="texte-corps text-destructive">{erreurMarque}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefixe}-modele`} requis>
          {t('vehicules:identite.modele')}
        </Label>
        <ChampAutocompletionVehicule
          id={`${idPrefixe}-modele`}
          libelle={t('vehicules:identite.modele')}
          valeur={modele}
          onValeurChange={onModeleChange}
          options={optionsModeles}
          enChargement={modeles.isFetching}
          erreur={modeles.isError ? t('vehicules:identite.autocompletion.erreurRecherche') : null}
          placeholder={t('vehicules:identite.autocompletion.placeholderModele')}
          disabled={disabled}
          ariaInvalid={erreurModele ? true : undefined}
        />
        {erreurModele ? <p className="texte-corps text-destructive">{erreurModele}</p> : null}
      </div>
    </div>
  );
}
