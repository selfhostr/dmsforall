import { Car, Home, Receipt, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, useSearchParams } from 'react-router';

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
 * (voir routes/chemins.ts). Le site actif est lu **depuis l'URL courante**, exactement comme
 * `EcranListeVehicules` (même mécanisme, pas un second) : deux onglets sur deux sites différents
 * ne doivent pas se contredire, et un utilisateur qui a navigué vers un site différent de celui
 * par défaut de sa session ne doit pas y être silencieusement ramené en cliquant un lien de cette
 * barre. La session n'est **jamais** consultée ici — si `?site=` est absent de l'URL, il reste
 * absent des liens : ce n'est pas une valeur manquante à combler, c'est l'affichage « tous
 * sites », un choix explicite de l'utilisateur qu'on ne remplace pas par un défaut inventé.
 *
 * Le lien « Facturation » (`/factures`) ne passe volontairement pas par `chemins.*` (qui
 * n'expose pas de constructeur pour la facturation, et appartient à un autre périmètre) : comme
 * le lien « Accueil » ci-dessous, c'est une chaîne brute. `EcranListeFactures` ne consomme de
 * toute façon pas `siteId` aujourd'hui (voir son propre commentaire), donc il n'y a rien de
 * `?site=` à préserver ici.
 */
export function BarreLaterale({ className }: Props) {
  const { t } = useTranslation('navigation');
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

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
      <NavLink to="/factures" className={classeLien}>
        <Receipt className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.factures')}
      </NavLink>
    </nav>
  );
}
