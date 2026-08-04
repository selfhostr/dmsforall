import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useSession } from '@/hooks/useSession';

interface Props {
  readonly onChoisir: (siteId: string) => void;
}

/** Repli honnête quand aucun site n'est résolu depuis `?site=` ni déductible (plusieurs sites
 *  actifs) — même doctrine que `ecrans/pieces/SelecteurSiteRequis.tsx` : un choix INLINE plutôt
 *  qu'un renvoi à l'accueil, le pointage se fait en boucle toute la journée. Ne liste que les
 *  sites ACTIFS de la session. */
export function SelecteurSitePointage({ onChoisir }: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session } = useSession();
  const sites = (session?.sites ?? []).filter((site) => site.actif);

  return (
    <EtatVide
      titre={t('pointage:siteRequis.titre')}
      description={t('pointage:siteRequis.description')}
      action={
        sites.length > 0 ? (
          <Select onValueChange={onChoisir}>
            <SelectTrigger aria-label={t('pointage:siteRequis.label')} className="w-64">
              <SelectValue placeholder={t('pointage:siteRequis.label')} />
            </SelectTrigger>
            <SelectContent>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : undefined
      }
    />
  );
}
