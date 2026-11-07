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
import { useChoisirSiteImplicite } from '@/hooks/site/useChoisirSiteImplicite';
import { useSession } from '@/hooks/useSession';

interface Props {
  readonly onChoisir: (siteId: string) => void;
}

/**
 * Repli honnête pour `EcranNouvelOrdreReparation` quand `?site=` est absent — même doctrine que
 * `ecrans/pieces/SelecteurSiteRequis.tsx` (colocalisé par module, pas de composant partagé entre
 * domaines) : le site n'est jamais deviné, mais son absence se résout SANS quitter l'écran plutôt
 * qu'en renvoyant à l'accueil. Un réceptionnaire au comptoir, client devant lui, qui doit d'abord
 * ressortir vers l'accueil puis retrouver le client pour choisir un site casserait le geste le
 * plus fréquent de l'atelier (voir la revue UX du 10.08.2026). Ne liste que les sites ACTIFS de la
 * session — un site désactivé ne peut pas recevoir de nouvel OR.
 */
export function SelecteurSiteOrRequis({ onChoisir }: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const { data: session, isPending, isError, error, refetch } = useSession();
  // Mono-site : le site s'impose, aucune question à poser.
  const siteImpose = useChoisirSiteImplicite(onChoisir);

  if (isPending || siteImpose) {
    return <EtatChargement lignes={1} />;
  }

  if (isError) {
    return (
      <EtatErreur
        titre={t('or:nouveau.siteManquant.erreur.titre')}
        description={messageErreur(error, t)}
        onReessayer={() => void refetch()}
      />
    );
  }

  const sites = (session?.sites ?? []).filter((site) => site.actif);

  return (
    <EtatVide
      titre={t('or:nouveau.siteManquant.titre')}
      description={t('or:nouveau.siteManquant.description')}
      action={
        sites.length > 0 ? (
          <Select onValueChange={onChoisir}>
            <SelectTrigger aria-label={t('or:nouveau.siteManquant.label')} className="w-64">
              <SelectValue placeholder={t('or:nouveau.siteManquant.label')} />
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
