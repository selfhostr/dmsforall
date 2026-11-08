import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SiteChoix {
  readonly id: string;
  readonly nom: string;
  readonly codeCourt: string;
}

interface Props {
  readonly idPrefixe: string;
  /** Sites cochés pour la personne : le site principal est l'un d'eux. */
  readonly sites: readonly SiteChoix[];
  readonly valeur: string | undefined;
  readonly onChange: (siteId: string) => void;
}

/** Site principal d'un collaborateur (défaut de ses filtres de site). Masqué s'il n'a qu'un site. */
export function ChampSitePrincipal({ idPrefixe, sites, valeur, onChange }: Props) {
  const { t } = useTranslation('parametrage');
  if (sites.length < 2) return null;
  const effectif = sites.some((s) => s.id === valeur) ? valeur : sites[0]?.id;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${idPrefixe}-site-principal`}>
        {t('parametrage:utilisateurs.sitePrincipal.label')}
      </Label>
      <Select value={effectif} onValueChange={onChange}>
        <SelectTrigger id={`${idPrefixe}-site-principal`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.nom} ({site.codeCourt})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="texte-libelle text-muted-foreground">
        {t('parametrage:utilisateurs.sitePrincipal.aide')}
      </p>
    </div>
  );
}
