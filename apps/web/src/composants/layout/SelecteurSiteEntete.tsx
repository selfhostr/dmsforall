import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';

import type { SessionCourante } from '@dfa/shared';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  readonly sites: SessionCourante['sites'];
  /** Site COURANT, lu par l'appelant (`EnTete.tsx`) depuis `?site=` — jamais recalculé ici. */
  readonly siteIdActif: string | undefined;
  /** Libellé déjà résolu par l'appelant (nom du site ou « Tous les sites »), affiché tel quel. */
  readonly libelle: string;
}

/** Conserve le chemin et les autres paramètres de requête courants, ne remplace que `?site=` —
 *  même construction que `changerSite` dans `EcranTableauBord.tsx`, en `Link` plutôt qu'en
 *  `onClick`/`navigate` : Ctrl/Clic ouvre le site choisi dans un nouvel onglet, comme le reste de
 *  la navigation posée par `BarreLaterale.tsx`/`OngletsDomaine.tsx`. */
function construireHrefSite(
  pathname: string,
  searchParams: URLSearchParams,
  siteId: string,
): string {
  const parametres = new URLSearchParams(searchParams);
  parametres.set('site', siteId);
  const chaine = parametres.toString();
  return chaine === '' ? pathname : `${pathname}?${chaine}`;
}

/**
 * Changeur de site de l'en-tête (demande @laupernoe, revue webui du 10.08.2026). Jusqu'ici `EnTete.tsx`
 * n'affichait qu'un texte : ce composant en fait le SEUL sélecteur de site de l'en-tête, il n'en
 * existait aucun autre à fusionner (`SelecteurSiteTableauBord`/`SelecteurSitePointage` sont des
 * filtres LOCAUX à leur écran, pas des composants de coquille).
 *
 * Le site actif est reçu de l'appelant, lu DEPUIS L'URL (`?site=`) — jamais depuis la session,
 * même mécanisme que `BarreLaterale.tsx`/`EnTete.tsx` (`routes/chemins.ts`). Ne liste que les
 * sites ACTIFS, et seulement ceux DIFFÉRENTS du site courant (« changer de site », pas se
 * reconfirmer sur le même). Un seul site actif (ou moins) -> aucun sélecteur : un menu à une
 * seule option est du bruit, l'ancien texte simple reste affiché.
 */
export function SelecteurSiteEntete({ sites, siteIdActif, libelle }: Props) {
  const { t } = useTranslation('navigation');
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  const sitesActifs = sites.filter((site) => site.actif);

  if (sitesActifs.length < 2) {
    return (
      <p className="truncate text-sm text-muted-foreground" title={libelle}>
        {libelle}
      </p>
    );
  }

  const autresSites = sitesActifs.filter((site) => site.id !== siteIdActif);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* `relative` + pseudo-élément `after` : même technique que `Button` `size="sm"`
            (`components/ui/button.tsx`) pour tenir la cible tactile de 44 px sans imposer une
            ligne de 44 px de haut dans un en-tête à deux lignes (`h-16` fixe) — la zone étendue est
            invisible et hors du flux, elle ne peut pas décaler le nom du tenant au-dessus. */}
        <button
          type="button"
          title={libelle}
          className="anneau-focus relative flex max-w-full items-center gap-1 truncate text-sm text-muted-foreground transition-colors after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:text-foreground"
        >
          <span className="truncate">{libelle}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('navigation:entete.changerSite')}</DropdownMenuLabel>
        {autresSites.map((site) => (
          <DropdownMenuItem key={site.id} asChild>
            <Link to={construireHrefSite(pathname, searchParams, site.id)}>{site.nom}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
