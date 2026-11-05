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
  /** Site COURANT, résolu par l'appelant (`BarreOutilsSuperieure.tsx` — URL puis préférence
   *  mémorisée, voir `hooks/site/ContexteSiteCourant.tsx`) — jamais recalculé ici. */
  readonly siteIdActif: string | undefined;
  /** Libellé déjà résolu par l'appelant (`BarreOutilsSuperieure.tsx`, `resoudreLibelleSite` : nom
   *  du site, « Tous les sites » si `siteIdActif` est `undefined`, « Aucun site choisi » si défini
   *  mais inconnu de la session), affiché tel quel. */
  readonly libelle: string;
  /**
   * Rendu compact ICÔNE SEULE — TOUJOURS actif depuis le lot « bandeau haut » (26.08.2026) :
   * `BarreOutilsSuperieure.tsx` est le seul appelant restant (le sélecteur y a été déménagé
   * depuis `BarreLaterale.tsx`, dont la colonne repliable motivait à l'origine ce mode compact),
   * et son bandeau de 48 px de haut n'a la place que pour cette forme. `undefined`/`false` reste
   * le défaut du composant (rendu texte plein) pour ne pas casser un futur appelant qui aurait
   * besoin de l'autre variante, mais aucun appelant actuel ne l'utilise. Pastille carrée 44×44 px
   * (plancher tactile) portant l'ICÔNE + le CODE COURT du site (`site.code`, ex. « MTG ») plutôt
   * que rien : le bandeau ne peut pas afficher un nom de site en toutes lettres, mais le code
   * tient et reste un repère réel (« je suis sur MTG »). Le nom complet reste porté par
   * `aria-label`/`title`, jamais raccourci pour un lecteur d'écran ou une infobulle — et surtout
   * jamais RÉSERVÉ au survol (défaut mesuré de l'ancien emplacement replié, voir
   * `BarreOutilsSuperieure.tsx`).
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
 * Changeur de site GLOBAL du chrome (demande produit, revue webui du 10.08.2026 ; déménagé de l'ancien
 * `EnTete.tsx` vers `BarreLaterale.tsx` le 19.08.2026, puis vers `BarreOutilsSuperieure.tsx` le
 * 26.08.2026 — voir la doc de tête de ce dernier pour la justification mesurée du déménagement).
 * Ce composant reste le SEUL sélecteur de site du chrome applicatif, il n'en existe aucun autre à
 * fusionner (`SelecteurSiteTableauBord`/`SelecteurSitePointage` sont des filtres LOCAUX à leur
 * écran, pas des composants de coquille).
 *
 * Le site actif est reçu de l'appelant, lu DEPUIS L'URL (`?site=`) — jamais depuis la session,
 * même mécanisme que `BarreLaterale.tsx`/`BarreOutilsSuperieure.tsx` (`routes/chemins.ts`). Ne
 * liste que les sites ACTIFS, et seulement ceux DIFFÉRENTS du site courant (« changer de site »,
 * pas se reconfirmer sur le même). Un seul site actif (ou moins) -> aucun sélecteur : un menu à
 * une seule option est du bruit, l'ancien texte simple reste affiché.
 */
export function SelecteurSiteEntete({ sites, siteIdActif, libelle, compact = false }: Props) {
  const { t } = useTranslation('navigation');
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { definirPreferenceSite } = useSiteCourant();

  const sitesActifs = sites.filter((site) => site.actif);
  // Lot « bandeau haut » (26.08.2026) — DÉFAUT MESURÉ CORRIGÉ ICI : avant ce lot, `nonChoisi`
  // valait `siteIdActif === undefined` et recevait la même mise en avant visuelle que l'unique
  // libellé « Aucun site choisi », alors que ce composant affiche désormais (`libelle`, résolu par
  // l'appelant — `BarreOutilsSuperieure.tsx`, `resoudreLibelleSite`) « Tous les sites » pour cet
  // état : la couleur et le mot se contredisaient. `siteIdActif === undefined` n'est PAS une
  // anomalie — c'est le MÊME état légitime que celui du filtre local du tableau de bord
  // (`SelecteurSiteTableauBord.tsx`, « Tous les sites » comme option explicite), pas une absence à
  // signaler avec insistance. Seul un identifiant PRÉSENT mais qui ne correspond à AUCUN site
  // connu de la session (lien obsolète, site renommé/supprimé) reste une VRAIE anomalie — c'est CE
  // cas-là, seul, qui garde la mise en avant (couleur normale du contenu plutôt que la couleur
  // atténuée habituelle du chrome), pour rester visible sans avoir à le chercher.
  const siteConnu = sites.find((candidat) => candidat.id === siteIdActif);
  const siteInconnu = siteIdActif !== undefined && siteConnu === undefined;
  // Code court (« MTG ») pour le rendu compact — voir la doc de `compact` ci-dessus. `undefined`
  // si `siteIdActif` ne correspond à aucun site connu (« tous » ou référence inconnue, mêmes deux
  // cas ci-dessus) : l'em-dash de repli plus bas couvre les deux identiquement, seul le
  // `aria-label`/`title` (porté par `libelle`) les distingue en toutes lettres.
  const codeCourt = siteConnu?.code;

  if (sitesActifs.length < 2) {
    if (compact) {
      return (
        <p
          className={cn(
            'flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-md',
            siteInconnu ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={libelle}
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span
            aria-hidden="true"
            className="max-w-full truncate texte-petit font-semibold leading-none"
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
          'flex items-center gap-1 truncate texte-corps',
          siteInconnu ? 'font-medium text-foreground' : 'text-muted-foreground',
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
              siteInconnu ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span
              aria-hidden="true"
              className="max-w-full truncate texte-petit font-semibold leading-none"
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
            "anneau-focus relative flex max-w-full items-center gap-1 truncate texte-corps transition-colors after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:text-foreground",
            siteInconnu ? 'font-medium text-foreground' : 'text-muted-foreground',
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
