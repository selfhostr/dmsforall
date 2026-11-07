import type { TFunction } from 'i18next';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { SessionCourante } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { SheetTrigger } from '@/components/ui/sheet';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useSession } from '@/hooks/useSession';

import { BasculeTheme } from './BasculeTheme';
import { RechercheGlobale } from './RechercheGlobale';
import { SelecteurSiteEntete } from './SelecteurSiteEntete';

/**
 * BANDEAU SUPÉRIEUR — Lot « cadre applicatif » (19.08.2026, demande produit), remplace `EnTete.tsx`.
 * Lot « bandeau haut » (26.08.2026, demande produit) : le sélecteur de SITE et la bascule de THÈME le
 * rejoignent, tous deux déménagés depuis `BarreLaterale.tsx`. Le pied compte (identité + Réglages +
 * déconnexion) NE bouge PAS — @laupernoe l'a tranché explicitement, il reste en bas de `BarreLaterale`.
 *
 * POURQUOI CE BANDEAU ET PAS LA BARRE LATÉRALE, mesuré et indépendant de l'historique du code :
 * ce contrôle change le contexte de TOUTE la page (site actif = ce que verra tout écran suivant),
 * pas seulement une portion. En tête de barre latérale, avant ce lot, il souffrait de deux défauts
 * structurels : (1) il DISPARAISSAIT dès que la colonne se repliait sur desktop (`w-16`, icônes
 * seules — un état où `SelecteurSiteEntete` compact restait certes lisible, mais uniquement dans
 * CETTE colonne, absente du tiroir mobile fermé et de la barre basse téléphone) ; (2) son nom
 * complet n'était accessible qu'AU SURVOL (`title=`) sur le palier que ce dépôt qualifie lui-même
 * de « postes de comptoir tactiles » (voir `BarreLaterale.tsx`, cible 44 px) — un survol sur un
 * écran tactile n'existe pas, ce qui rendait le nom complet du site simplement inatteignable pour
 * une tablette repliée. `BarreOutilsSuperieure` est le SEUL bandeau réellement permanent à tous les
 * paliers (desktop, tablette tiroir fermé, téléphone barre basse) — le seul endroit qui ne
 * disparaît jamais et n'exige jamais de survol. Trois logiciels comparables (Shopmonkey, Odoo,
 * Lightspeed Retail) logent ce contrôle en bandeau permanent plutôt que dans une colonne repliable ;
 * Lightspeed Retail l'y a même AJOUTÉ après un retour utilisateur documenté.
 *
 * Rendu en forme COMPACTE (`compact` sur `SelecteurSiteEntete` — icône + code court, 44×44 px)
 * dans les DEUX modes, jamais la variante texte+chevron : ce bandeau porte déjà recherche + site +
 * thème (+ hamburger sur tablette), la largeur y est le facteur limitant (voir le point d'attention
 * téléphone étroit ci-dessous), et le nom complet reste porté par `aria-label`/`title` — jamais
 * réservé au survol, contrairement à l'ancien emplacement (défaut n°1 ci-dessus, corrigé par
 * construction en changeant d'emplacement, pas seulement de forme).
 *
 * DEUX DÉFAUTS MESURÉS DU SÉLECTEUR, CORRIGÉS DANS CE LOT (hors de ce fichier, mais rendus visibles
 * ICI puisque c'est ce composant qui affiche leur résultat) :
 *  1. Désynchronisation — choisir « Tous les sites » sur le tableau de bord (`SelecteurSiteTableauBord`)
 *     n'appelait jamais `definirPreferenceSite`, pas plus qu'un choix de site précis : la préférence
 *     mémorisée restait périmée, et un clic de menu ramenait ensuite sur l'ancien site sans signal.
 *     Corrigé dans `EcranTableauBord.tsx` : un choix de site PRÉCIS synchronise désormais la
 *     préférence globale (comme le fait déjà `SelecteurSiteEntete` lui-même) ; « Tous les sites »
 *     reste volontairement NON persisté (doctrine inchangée de `ContexteSiteCourant.tsx` : un
 *     survol furtif sur l'agrégat ne doit pas écraser le dernier site réel de travail, dont
 *     dépendent des écrans qui EXIGENT un site — pièces, ventes). Avec la préférence tenue à jour,
 *     ce bandeau reflète alors le bon site au moment du clic, ce qui EST le signal manquant.
 *  2. Collision de libellé — « Aucun site choisi » (`BarreLaterale`, avant déménagement) et
 *     « Tous les sites » (`SelecteurSiteTableauBord`) s'affichaient SIMULTANÉMENT pour le même état
 *     `undefined` (aucun `?site=`, aucune préférence). Corrigé ICI par `resoudreLibelleSite` :
 *     `site === undefined` n'est plus une anomalie déguisée en « aucun » — c'est le même état
 *     légitime que le filtre du tableau de bord, donc le MÊME mot, « Tous les sites ». Seul un
 *     identifiant PRÉSENT mais qui ne correspond à AUCUN site connu (lien obsolète, site
 *     renommé/supprimé) reste réellement une absence, et garde « Aucun site choisi ». Ce sont deux
 *     états distincts à la source (`SelecteurSiteEntete.tsx` porte la même distinction pour son
 *     rendu visuel : seul le second cas reste mis en avant, le premier redevient un état ordinaire).
 *
 * Ce que l'ancienne `EnTete.tsx` portait — nom du tenant, identité, bouton « Se déconnecter » — est
 * resté dans `BarreLaterale.tsx` (contexte permanent, appartient au cadre). Seuls SITE et THÈME en
 * repartent : ce sont les deux réglages que @laupernoe veut atteignables SANS ouvrir le tiroir sur
 * tablette, exactement le même besoin que la recherche (Lot A).
 *
 *  - La barre latérale desktop est un `aside` PERSISTANT (`AppShell.tsx`, `lg:sticky lg:top-0`) :
 *    un contrôle qui y vivrait resterait aussi vite atteignable qu'ici. Mais le tiroir mobile
 *    (`Sheet`) est FERMÉ par défaut — y enfouir la recherche aurait forcé un garagiste sur
 *    téléphone/tablette à ouvrir le menu avant de chercher une plaque ou un client, alors que la
 *    doc de `RechercheGlobale.tsx` est explicite (Lot A) : « jamais supposer un clavier — postes
 *    tactiles ». Un bandeau FIN, permanent, indépendant de l'état ouvert/fermé du tiroir, est le
 *    seul choix qui ne dégrade la recherche (ni le site, ni le thème) sur AUCUN appareil.
 *  - 48 px de haut (`h-12`) : un bouton de 44 px (plancher tactile) et 2 px de respiration de
 *    chaque côté — inchangé par cet ajout, tous les contrôles du bandeau tiennent dans cette
 *    hauteur (icônes 44×44, recherche `h-11`).
 *  - La ligne « bouton hamburger seul » du tiroir mobile, qui vivait EMPILÉE au-dessus de
 *    l'ancienne `EnTete` (`AppShell.tsx`, avant le lot du 19.08.2026), est FUSIONNÉE ici plutôt que
 *    dupliquée à côté. Le bouton reste `lg:hidden` (le tiroir n'existe pas au-delà de ce seuil,
 *    `BarreLaterale` reste visible en `aside`) — et `hidden md:flex` depuis le lot barre basse
 *    (24.08.2026, `AppShell.tsx`) : sous `md` (téléphone), le bouton « Plus » de
 *    `BarreOngletsBasse.tsx` ouvre déjà le même tiroir, un second déclencheur ici ferait doublon.
 *
 * `SheetTrigger` (pas un `onClick` manuel) : ce composant est monté comme enfant direct d'un
 * `<Sheet>` par `AppShell.tsx` — Radix relie le déclencheur au tiroir par le contexte, sans props à
 * faire transiter ici, et pose lui-même `aria-expanded`/`aria-haspopup` sur le bouton.
 *
 * POINT D'ATTENTION SIGNALÉ, PAS TRANCHÉ : téléphone très étroit (<360 px), palier `<md`. Le
 * bandeau y porte hamburger MASQUÉ + recherche (icône seule, `hidden sm:inline` sur son texte) +
 * site compact (44 px) + thème (44 px) — budget mesuré : 2×`px-2` (16 px) + 2×`gap-2` (16 px) +
 * site (44 px) + thème (44 px) = 120 px de chrome fixe, le reste (recherche) rétrécit sans
 * plancher inférieur à son icône. Tient sur les gabarits usuels (360 px et plus) ; non vérifié
 * visuellement sous 360 px (aucun rendu réel possible dans cet environnement) — à confirmer sur un
 * appareil physique avant de considérer ce point clos.
 *
 * ABSENT pour `poste_atelier`/mode scan mobile (`AppShell.tsx`, `afficheNavigation` faux) — voir
 * `BandeauSansNavigation.tsx` à la place, qui ne porte ni recherche ni site ni thème (§2 : « aucun
 * menu, aucun en-tête, aucune recherche » pour la borne murale ; restriction stricte au scan pour
 * le mode mobile).
 *
 * SÉLECTEUR DE LANGUE — absent d'ici comme du reste du chrome. Hors périmètre de ce lot, laissé EN
 * SUSPENS sur demande produit explicite (ne pas trancher de son propre chef).
 */

/**
 * Résout le libellé affiché pour le site actif — SEULE fonction qui décide du texte, partagée par
 * `SelecteurSiteEntete` (qui reçoit ce libellé déjà résolu, ne le recalcule jamais) et testable
 * isolément. Distingue à la source (règle du dépôt : absence de donnée ≠ valeur) :
 *  - `site === undefined` : aucun `?site=` dans l'URL ET aucune préférence mémorisée — état
 *    légitime, le MÊME que celui du filtre local du tableau de bord (`SelecteurSiteTableauBord`,
 *    « Tous les sites » comme option explicite). Traité comme le même mot ICI.
 *  - `site` défini mais ne correspondant à AUCUN site de la session (lien obsolète, site
 *    renommé/supprimé) : la seule vraie absence, gardée sous « Aucun site choisi ».
 *  - `site` défini et connu : son nom.
 */
export function resoudreLibelleSite(
  sites: SessionCourante['sites'] | undefined,
  site: string | undefined,
  t: TFunction,
): string {
  if (!sites) return '';
  if (site === undefined) return t('navigation:entete.tousLesSites');
  return (
    sites.find((candidat) => candidat.id === site)?.nom ?? t('navigation:entete.siteNonChoisi')
  );
}

export function BarreOutilsSuperieure() {
  const { t } = useTranslation('navigation');
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();
  const { preferenceSiteId } = useSiteCourant();
  // Même résolution que `BarreLaterale.tsx`/`BarreOngletsBasse.tsx`/tout autre lecteur de site du
  // produit (`routes/chemins.ts`) : l'URL fait foi, la préférence mémorisée ne comble que son
  // absence — jamais l'inverse.
  const site = searchParams.get('site') ?? preferenceSiteId;
  const libelleSite = resoudreLibelleSite(session?.sites, site, t);
  // Un seul site : rien à choisir ni à afficher dans le bandeau (garage neuf, mono-site).
  const { estMonoSite } = useSiteImplicite();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2">
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden shrink-0 md:flex lg:hidden"
          aria-label={t('navigation:menu.ouvrir')}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <div className="flex min-w-0 flex-1 justify-center">
        <RechercheGlobale />
      </div>
      {session && !estMonoSite ? (
        <SelecteurSiteEntete
          sites={session.sites}
          siteIdActif={site}
          libelle={libelleSite}
          compact
        />
      ) : null}
      <BasculeTheme />
    </header>
  );
}
