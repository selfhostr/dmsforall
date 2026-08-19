import { ChevronDown, MapPin } from 'lucide-react';
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
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { cn } from '@/lib/utils';

interface Props {
  readonly sites: SessionCourante['sites'];
  /** Site COURANT, résolu par l'appelant (`BarreLaterale.tsx` — URL puis préférence mémorisée, voir
   *  `hooks/site/ContexteSiteCourant.tsx`) — jamais recalculé ici. */
  readonly siteIdActif: string | undefined;
  /** Libellé déjà résolu par l'appelant (nom du site ou « Aucun site choisi »), affiché tel quel. */
  readonly libelle: string;
  /**
   * Rendu compact ICÔNE SEULE — barre latérale desktop REPLIÉE (Lot « cadre applicatif »,
   * 19.08.2026 : le sélecteur de site descend de l'en-tête vers la barre latérale, voir
   * `BarreLaterale.tsx`). `undefined`/`false` (défaut) = rendu texte plein, identique à avant ce
   * lot. `true` = pastille carrée 44×44 px (plancher tactile, même gabarit qu'une entrée de menu
   * repliée) portant l'ICÔNE + le CODE COURT du site (`site.code`, ex. « MTG ») plutôt que rien :
   * une colonne à 64 px ne peut pas afficher un nom de site en toutes lettres, mais le code tient
   * et reste un repère réel (« je suis sur MTG ») là où l'ancien mot-symbole affiché replié
   * n'apportait aucune information utile au garagiste — voir la justification complète en tête de
   * `BarreLaterale.tsx`. Le nom complet reste porté par `aria-label`/`title`, jamais raccourci pour
   * un lecteur d'écran ou une infobulle.
   */
  readonly compact?: boolean;
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
export function SelecteurSiteEntete({ sites, siteIdActif, libelle, compact = false }: Props) {
  const { t } = useTranslation('navigation');
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { definirPreferenceSite } = useSiteCourant();

  const sitesActifs = sites.filter((site) => site.actif);
  // Aucun site RÉSOLU (ni l'URL ni la préférence mémorisée, `BarreLaterale.tsx`) : c'est l'état
  // « absence » que la doctrine du dépôt interdit de rendre comme « Tous les sites » (issue #91).
  // Distingué visuellement — icône + texte de la couleur normale du contenu plutôt que la couleur
  // atténuée habituelle du chrome — pour que ce petit repère reste VISIBLE sans avoir à le
  // chercher, plutôt que de se fondre dans le reste de la barre latérale.
  const nonChoisi = siteIdActif === undefined;
  // Code court (« MTG ») pour le rendu compact — voir la doc de `compact` ci-dessus. `undefined`
  // si `siteIdActif` ne correspond à aucun site connu (même absence que `nonChoisi`).
  const codeCourt = sites.find((site) => site.id === siteIdActif)?.code;

  if (sitesActifs.length < 2) {
    if (compact) {
      return (
        <p
          className={cn(
            'flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-md',
            nonChoisi ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={libelle}
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span
            aria-hidden="true"
            className="max-w-full truncate text-xs font-semibold leading-none"
          >
            {codeCourt ?? '—'}
          </span>
          <span className="sr-only">{libelle}</span>
        </p>
      );
    }
    return (
      <p
        className={cn(
          'flex items-center gap-1 truncate text-sm',
          nonChoisi ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
        title={libelle}
      >
        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{libelle}</span>
      </p>
    );
  }

  const autresSites = sitesActifs.filter((site) => site.id !== siteIdActif);

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={libelle}
            aria-label={libelle}
            className={cn(
              'anneau-focus flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-md transition-colors hover:bg-muted',
              nonChoisi ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span
              aria-hidden="true"
              className="max-w-full truncate text-xs font-semibold leading-none"
            >
              {codeCourt ?? '—'}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t('navigation:entete.changerSite')}</DropdownMenuLabel>
          {autresSites.map((site) => (
            <DropdownMenuItem key={site.id} asChild>
              <Link
                to={construireHrefSite(pathname, searchParams, site.id)}
                onClick={() => definirPreferenceSite(site.id)}
              >
                {site.nom}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* `relative` + pseudo-élément `after` : même technique que `Button` `size="sm"`
            (`components/ui/button.tsx`) pour tenir la cible tactile de 44 px sans imposer une
            ligne de 44 px de haut dans un bloc dense — la zone étendue est invisible et hors du
            flux, elle ne peut pas décaler le nom du tenant au-dessus. */}
        <button
          type="button"
          title={libelle}
          className={cn(
            "anneau-focus relative flex max-w-full items-center gap-1 truncate text-sm transition-colors after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:text-foreground",
            nonChoisi ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{libelle}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('navigation:entete.changerSite')}</DropdownMenuLabel>
        {autresSites.map((site) => (
          <DropdownMenuItem key={site.id} asChild>
            {/* `onClick` en plus du `Link` (jamais à sa place) : mémorise le choix comme
                PRÉFÉRENCE (`hooks/site/ContexteSiteCourant.tsx`, issue #91) sans changer la
                navigation elle-même — Ctrl/Clic continue d'ouvrir un nouvel onglet normalement. */}
            <Link
              to={construireHrefSite(pathname, searchParams, site.id)}
              onClick={() => definirPreferenceSite(site.id)}
            >
              {site.nom}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
