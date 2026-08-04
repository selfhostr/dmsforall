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

/** Repli honnête quand aucun site n'est résolu depuis `?site=` ni déductible (plusieurs sites
 *  actifs) — même doctrine que `ecrans/pieces/SelecteurSiteRequis.tsx` : un choix INLINE plutôt
 *  qu'un renvoi à l'accueil, le pointage se fait en boucle toute la journée. Ne liste que les
 *  sites ACTIFS de la session.
 *
 * CORRECTIF (race au premier chargement, même cause que `SelecteurSiteRequis`) : `useSession()`
 * n'est pas garanti résolu au montage de CE composant précis (seule la toute première requête de
 * session de l'arbre est bloquée par `RouteProtegee`) — sans le branchement explicite ci-dessous,
 * `isPending` retombait sur `session?.sites ?? []`, donc un menu VIDE indiscernable d'un tenant
 * sans site actif, plutôt qu'un état de chargement. */
export function SelecteurSitePointage({ onChoisir }: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session, isPending, isError, error, refetch } = useSession();

  if (isPending) {
    return <EtatChargement lignes={1} />;
  }

  if (isError) {
    return (
      <EtatErreur
        titre={t('pointage:siteRequis.erreur.titre')}
        description={messageErreur(error, t)}
        onReessayer={() => void refetch()}
      />
    );
  }

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
