import { Building2, Car, Copy, Home, Landmark, Receipt, Search, Tag, Users, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, useSearchParams } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';
import { ROLES_MENU_FINANCIER, ROLES_MENU_PARAMETRAGE_ATELIER } from '@/routes/droits-routes';
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
 * barre. Cette règle vaut pour les liens SANS restriction de rôle ci-dessous ; les liens du groupe
 * « Paramétrage » consultent la session pour une tout autre raison (savoir QUOI afficher, pas
 * calculer un `?site=`) — voir le paragraphe suivant.
 *
 * Le lien « Facturation » (`/factures`) ne passe volontairement pas par `chemins.*` (qui
 * n'expose pas de constructeur pour la facturation, et appartient à un autre périmètre) : comme
 * le lien « Accueil » ci-dessous, c'est une chaîne brute. `EcranListeFactures` ne consomme de
 * toute façon pas `siteId` aujourd'hui (voir son propre commentaire), donc il n'y a rien de
 * `?site=` à préserver ici.
 *
 * « Référentiels » (tarifs et prestations) est un lien SANS restriction de rôle, au même titre que
 * « Doublons clients » ci-dessus — arbitrage du coordinateur (lot 2) : c'est un outil de comptoir
 * (« combien coûte ce service ? »), et le réceptionniste est le rôle qui le consulte le plus. Le
 * masquer à qui n'est pas en gouvernance atelier casserait cet usage sans ajouter de protection
 * réelle (`parametrage.referentiel.lire` est ouvert à tous côté API — voir `droits-routes.ts`).
 *
 * Groupe « Paramétrage » (lot 2) : DEUX entrées seulement, « Paramétrage atelier »/« Sites »
 * (`ROLES_MENU_PARAMETRAGE_ATELIER`, chef d'atelier/direction/admin) et « Coordonnées bancaires »
 * (`ROLES_MENU_FINANCIER`, direction/comptable SEULEMENT — RF-115, `admin` en est exclu). Masquer
 * ici est un confort d'ERGONOMIE, PAS un mécanisme de protection (voir `droits-routes.ts` pour la
 * distinction complète) : aucune des routes correspondantes ne pose de restriction équivalente
 * dans `routeur.tsx` — la lecture y est ouverte à tout rôle authentifié côté API, seule l'écriture
 * reste gouvernée (grisée dans chaque écran ET refusée par le serveur). Un utilisateur qui
 * connaîtrait l'URL malgré un lien masqué ici atteint donc l'écran normalement, en lecture — ce
 * n'est pas un contournement, c'est le comportement voulu.
 */
export function BarreLaterale({ className }: Props) {
  const { t } = useTranslation('navigation');
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const peutGererParametrageAtelier = role !== undefined && ROLES_MENU_PARAMETRAGE_ATELIER.includes(role);
  const peutGererCreancier = role !== undefined && ROLES_MENU_FINANCIER.includes(role);
  const afficheGroupeParametrage = peutGererParametrageAtelier || peutGererCreancier;

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
      <NavLink to={chemins.clients.doublons()} className={classeLien}>
        <Copy className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.doublonsClients')}
      </NavLink>
      <NavLink to={chemins.vehicules.liste(site)} className={classeLien}>
        <Car className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.vehicules')}
      </NavLink>
      <NavLink to="/factures" className={classeLien}>
        <Receipt className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.factures')}
      </NavLink>
      <NavLink to={chemins.parametrage.referentiels()} className={classeLien}>
        <Tag className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.parametrageReferentiels')}
      </NavLink>

      {afficheGroupeParametrage ? (
        <>
          <p className="mt-3 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('navigation:groupes.parametrage')}
          </p>
          {peutGererParametrageAtelier ? (
            <NavLink to={chemins.parametrage.atelier()} className={classeLien}>
              <Wrench className="h-4 w-4" aria-hidden="true" />
              {t('navigation:liens.parametrageAtelier')}
            </NavLink>
          ) : null}
          {peutGererParametrageAtelier ? (
            <NavLink to={chemins.parametrage.sites(site)} className={classeLien}>
              <Building2 className="h-4 w-4" aria-hidden="true" />
              {t('navigation:liens.parametrageSites')}
            </NavLink>
          ) : null}
          {peutGererCreancier ? (
            <NavLink to={chemins.parametrage.facturation()} className={classeLien}>
              <Landmark className="h-4 w-4" aria-hidden="true" />
              {t('navigation:liens.parametrageFacturation')}
            </NavLink>
          ) : null}
        </>
      ) : null}
    </nav>
  );
}
