import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
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
 *
 * CORRECTIF (race au premier chargement) : `useSession()` n'est PAS garanti résolu avant le
 * montage de ce composant (`RouteProtegee` ne bloque que sur la toute première requête de session
 * de l'arbre ; un remontage local — StrictMode, retour de veille, `refetchOnWindowFocus` en plein
 * remontage — peut retrouver `isPending`). Lire `session?.sites ?? []` sans brancher sur
 * `isPending` produisait un sélecteur silencieusement VIDE (`EtatVide` sans action, aucune option)
 * plutôt qu'un état de chargement : indiscernable en apparence d'un tenant sans site actif. Les
 * trois branches ci-dessous (chargement / erreur / prêt) sont désormais explicites, comme l'exige
 * la doctrine du dépôt (`CONTRIBUTING.md` : « chaque écran gère explicitement chargement / vide /
 * erreur »).
 */
export function SelecteurSiteRequis({ onChoisir }: Props) {
  const { t } = useTranslation(['pieces', 'commun']);
  const { data: session, isPending, isError, error, refetch } = useSession();

  if (isPending) {
    return <EtatChargement lignes={1} />;
  }

  if (isError) {
    return (
      <EtatErreur
        titre={t('pieces:siteRequis.erreur.titre')}
        description={messageErreur(error, t)}
        onReessayer={() => void refetch()}
      />
    );
  }

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
