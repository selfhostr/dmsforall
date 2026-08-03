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

/**
 * Repli honnête pour tout écran pièces scopé par site (recherche comptoir, réapprovisionnement) —
 * même doctrine que `EcranNouvelOrdreReparation` (« `site` n'est jamais deviné, son absence
 * bloque l'écran avec un message explicite ») MAIS avec un choix inline plutôt qu'un renvoi vers
 * l'accueil : ces écrans sont consultés en boucle par le magasinier, le forcer à ressortir puis
 * revenir juste pour choisir un site casserait le geste le plus fréquent du comptoir. Ne liste que
 * les sites ACTIFS de la session — un site désactivé n'a pas de stock consultable.
 */
export function SelecteurSiteRequis({ onChoisir }: Props) {
  const { t } = useTranslation(['pieces', 'commun']);
  const { data: session } = useSession();
  const sites = (session?.sites ?? []).filter((site) => site.actif);

  return (
    <EtatVide
      titre={t('pieces:siteRequis.titre')}
      description={t('pieces:siteRequis.description')}
      action={
        sites.length > 0 ? (
          <Select onValueChange={onChoisir}>
            <SelectTrigger aria-label={t('pieces:siteRequis.label')} className="w-64">
              <SelectValue placeholder={t('pieces:siteRequis.label')} />
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
