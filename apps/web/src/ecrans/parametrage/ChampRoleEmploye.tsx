import { useTranslation } from 'react-i18next';

import { ROLES_UTILISATEUR, type IdPrereglage } from '@dfa/shared';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cleTraductionRole } from '@/lib/roles';

interface Props {
  readonly idPrefixe: string;
  readonly valeur: IdPrereglage;
  /** Points de départ proposés (préréglages), dans l'ordre d'affichage. */
  readonly prereglages: readonly IdPrereglage[];
  readonly onChange: (prereglage: IdPrereglage) => void;
}

/** Un préréglage qui est aussi un rôle garde le libellé du rôle (« Technicien ») ; les autres
 *  (« Fiduciaire ») prennent le leur dans le namespace `capacites`. */
function libellePrereglage(id: IdPrereglage, t: (cle: string) => string): string {
  return (ROLES_UTILISATEUR as readonly string[]).includes(id)
    ? t(cleTraductionRole(id as (typeof ROLES_UTILISATEUR)[number]))
    : t(`capacites:prereglages.${id}.libelle`);
}

/** Choix du point de départ d'un employé : chaque préréglage est décrit en une phrase. Ce n'est
 *  qu'un point de départ : la grille « Qui peut quoi » juste dessous l'ajuste. */
export function ChampRoleEmploye({ idPrefixe, valeur, prereglages, onChange }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'capacites']);
  const idAide = `${idPrefixe}-role-aide`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${idPrefixe}-role`} requis>
        {t('parametrage:utilisateurs.creation.champRole')}
      </Label>
      <Select value={valeur} onValueChange={(v) => onChange(v as IdPrereglage)}>
        <SelectTrigger id={`${idPrefixe}-role`} aria-required="true" aria-describedby={idAide}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {prereglages.map((id) => (
            <SelectItem key={id} value={id}>
              <span className="flex flex-col">
                <span>{libellePrereglage(id, t)}</span>
                <span className="texte-libelle text-muted-foreground">
                  {t(`capacites:prereglages.${id}.description`)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={idAide} className="texte-libelle text-muted-foreground">
        {t(`capacites:prereglages.${valeur}.description`)}
      </p>
    </div>
  );
}
