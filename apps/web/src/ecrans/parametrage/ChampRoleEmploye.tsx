import { useTranslation } from 'react-i18next';

import type { RolePersonne } from '@dfa/shared';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cleTraductionRole } from '@/lib/roles';

/** Clé i18n de la phrase qui décrit ce que fait chaque rôle, en mots de garagiste. Mapping
 *  explicite : `tsc` signale l'oubli d'un rôle si `RolePersonne` évolue. */
const CLES_DESCRIPTION_ROLE: Readonly<Record<RolePersonne, string>> = {
  direction: 'parametrage:utilisateurs.rolesDescription.direction',
  chef_atelier: 'parametrage:utilisateurs.rolesDescription.chef_atelier',
  receptionnaire: 'parametrage:utilisateurs.rolesDescription.receptionnaire',
  technicien: 'parametrage:utilisateurs.rolesDescription.technicien',
  magasinier: 'parametrage:utilisateurs.rolesDescription.magasinier',
  vendeur: 'parametrage:utilisateurs.rolesDescription.vendeur',
  comptable: 'parametrage:utilisateurs.rolesDescription.comptable',
  admin: 'parametrage:utilisateurs.rolesDescription.admin',
};

interface Props {
  readonly idPrefixe: string;
  readonly valeur: RolePersonne;
  readonly roles: readonly RolePersonne[];
  readonly onChange: (role: RolePersonne) => void;
}

/** Sélecteur de rôle d'un employé : chaque rôle est décrit en une phrase, et le texte rappelle
 *  qu'une personne n'a qu'un seul rôle. */
export function ChampRoleEmploye({ idPrefixe, valeur, roles, onChange }: Props) {
  const { t } = useTranslation(['parametrage', 'commun']);
  const idAide = `${idPrefixe}-role-aide`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${idPrefixe}-role`}>
        {t('parametrage:utilisateurs.creation.champRole')} *
      </Label>
      <Select value={valeur} onValueChange={(v) => onChange(v as RolePersonne)}>
        <SelectTrigger id={`${idPrefixe}-role`} aria-describedby={idAide}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r} value={r}>
              <span className="flex flex-col">
                <span>{t(cleTraductionRole(r))}</span>
                <span className="texte-libelle text-muted-foreground">
                  {t(CLES_DESCRIPTION_ROLE[r])}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={idAide} className="texte-libelle text-muted-foreground">
        {t(CLES_DESCRIPTION_ROLE[valeur])} {t('parametrage:utilisateurs.roleUnique')}
      </p>
    </div>
  );
}
