import { Car, Home, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';
import { cn } from '@/lib/utils';

interface Props {
  readonly className?: string;
}

const CLASSE_LIEN =
  'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors';

function classeLien({ isActive }: { readonly isActive: boolean }): string {
  return cn(CLASSE_LIEN, isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted');
}

/**
 * Le lot 1 (Atelier + Clients) ajoute la recherche, les clients et les véhicules à côté de
 * l'unique lien « Accueil » de l'étape 0 — toujours aucun élément grisé « à venir » : chaque lien
 * ci-dessous pointe vers un écran réellement atteignable.
 *
 * `chemins.*` conserve le site courant (`?site=`) plutôt que de le perdre à la navigation
 * (voir routes/chemins.ts) — d'où la lecture de la session ici pour connaître le site actif.
 *
 * NOTE I18N : `navigation:liens.recherche` n'existe pas encore dans les fichiers de traduction
 * (seuls `accueil`, `clients` et `vehicules` y sont, ajoutés en vague 0/récemment) — signalé
 * plutôt qu'inventé, voir le rapport de l'agent qui a écrit ce fichier.
 */
export function BarreLaterale({ className }: Props) {
  const { t } = useTranslation('navigation');
  const { data: session } = useSession();
  const site = session?.sites.find((candidat) => candidat.actif)?.id ?? session?.sites[0]?.id;

  return (
    <nav aria-label={t('navigation:principale.aria')} className={cn('flex flex-col gap-1 p-3', className)}>
      <NavLink to="/" end className={classeLien}>
        <Home className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.accueil')}
      </NavLink>
      <NavLink to={chemins.recherche.globale(site)} className={classeLien}>
        <Search className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.recherche')}
      </NavLink>
      <NavLink to={chemins.clients.liste(site)} className={classeLien}>
        <Users className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.clients')}
      </NavLink>
      <NavLink to={chemins.vehicules.liste(site)} className={classeLien}>
        <Car className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.vehicules')}
      </NavLink>
    </nav>
  );
}
