import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';

import { SignalerProbleme } from '@/composants/signalement/SignalerProbleme';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';
import { chemins } from '@/routes/chemins';

import { BandeauSansNavigation } from './BandeauSansNavigation';
import { BarreLaterale } from './BarreLaterale';
import { BarreOngletsBasse } from './BarreOngletsBasse';
import { LimiteErreurEcran } from './LimiteErreurEcran';
import { entreesVisibles, sujetNavigation } from './navigation-modele';
import { OngletsDomaine } from './OngletsDomaine';
import { useModeScanMobile } from './useModeScanMobile';
import { useRepliBarreLaterale } from './useRepliBarreLaterale';

/**
 * TROIS PALIERS (refonte navigation mobile, 24.08.2026 — voir aussi `BarreOngletsBasse.tsx`) :
 *
 *  - `>= lg` (1024px) — bureau : barre latérale fixe (240/64px repliée).
 *  - `< lg` (tablette et téléphone) — pas de barre latérale fixe ni de bandeau haut (supprimé) :
 *    barre d'onglets basse (`BarreOngletsBasse.tsx`), dont le bouton « Plus » ouvre le tiroir
 *    (`Sheet`, état `ouvert`/`setOuvert` ci-dessous) qui contient la barre latérale — recherche
 *    globale, site, entrées, menu du compte.
 *  - Palier repris de `md` (768px, Tailwind par défaut) : c'est aussi celui du repli des
 *    tableaux en cartes traité en parallèle ailleurs dans ce lot — même seuil partout,
 *    jamais deux paliers différents pour une seule bascule téléphone/tablette.
 *
 * Lot D — DEUX ajouts. (1) `OngletsDomaine` est monté ICI, une fois, entre le bandeau supérieur et
 * le contenu : le second niveau de l'arborescence existe donc pour toute route qui appartient au
 * menu, sans qu'aucun écran n'ait à s'en souvenir (voir la justification complète en tête
 * d'`OngletsDomaine.tsx`). (2) La colonne de navigation disparaît entièrement quand le compte
 * connecté n'a aucune entrée — c'est le cas de `poste_atelier`, la borne murale : un appareil, pas
 * un employé (§2 de l'arbitrage, « aucun menu, aucun en-tête, aucune recherche »). Afficher une
 * colonne vide sur une tablette d'atelier serait pire que de ne pas l'afficher.
 *
 * LOT « CADRE APPLICATIF » (19.08.2026, demande produit) — `EnTete.tsx` est SUPPRIMÉ, remplacé par DEUX
 * bandeaux mutuellement exclusifs ; le bandeau haut `BarreOutilsSuperieure.tsx` a depuis été
 * SUPPRIMÉ (recherche et site descendus dans la barre latérale) — tenant, site, identité et déconnexion ont migré dans
 * `BarreLaterale.tsx`, contexte permanent du cadre plutôt que d'une bande répétée en haut de
 * chaque écran — et `BandeauSansNavigation.tsx` (déconnexion seule) sinon. Ce second cas couvre
 * exactement ce que gardait l'ancienne `EnTete.tsx` « contrairement à la lettre de §2 » : la borne
 * murale (`poste_atelier`) et le mode scan mobile n'ont NI l'un NI l'autre de `BarreLaterale` où
 * loger la déconnexion, un poste partagé qu'on ne peut plus déconnecter au comptoir restant un
 * problème d'exploitation réel. Le plein écran intégral de la borne reste une décision qui
 * appartient à `ecrans/pointage/` (signalé à la session, hors de ce périmètre d'écriture).
 */
export function AppShell() {
  const { t } = useTranslation('navigation');
  const [ouvert, setOuvert] = useState(false);
  const { data: session } = useSession();
  const location = useLocation();
  // Restriction mobile au scan seul (chantier scanner de permis de circulation) — voir la doc de
  // tête d'`useModeScanMobile.ts` pour le détail de la détection et de son échappatoire. `actif`
  // masque toute la navigation ci-dessous (même traitement que `poste_atelier`, la borne murale :
  // aucune colonne, aucun onglet) ET redirige toute route hors `/scan` (voir `<main>` plus bas).
  const modeScan = useModeScanMobile(session?.actions);
  const afficheNavigation = entreesVisibles(sujetNavigation(session)).length > 0 && !modeScan.actif;
  // Repli DESKTOP de la barre latérale (demande produit, revue webui du 10.08.2026) — préférence
  // mémorisée (`useRepliBarreLaterale`), lue ici et nulle part ailleurs : seul l'`aside` ci-dessous
  // la reçoit. Le tiroir mobile (`Sheet`) monte `BarreLaterale` SANS le prop `repli`, il reste donc
  // toujours déplié quelle que soit cette préférence — déjà en surimpression, déjà refermable d'un
  // geste, un repli y ferait double emploi.
  const repliBarreLaterale = useRepliBarreLaterale();
  // Barre basse : même garde que la rangée d'onglets ci-dessous (`modeScan.actif` la retire
  // aussi), plus explicite ici parce que `BarreOngletsBasse` a en plus besoin de savoir si le
  // tiroir qu'ouvre son bouton « Plus » est déjà ouvert (`plusOuvert`, pour `aria-expanded`).
  const afficheBarreBasse = afficheNavigation && !modeScan.actif;

  return (
    // Porte la préférence de site (issue #91) pour toute la coquille et l'écran routé — voir
    // `hooks/site/ContexteSiteCourant.tsx`. Montée ICI (au-dessus d'`EnTete`/`BarreLaterale`/
    // `OngletsDomaine` ET de `<Outlet/>`) : les trois composants de navigation la lisent en frères
    // synchronisés, et la route index (`routeur.tsx`) peut s'en servir pour atterrir directement
    // sur le dernier site connu plutôt que sur « aucun site ».
    <FournisseurSiteCourant>
      <SignalerProbleme />
      {/* `pt-zone-sure-haut`/`pl-zone-sure-gauche`/`pr-zone-sure-droite` : depuis que
          `index.html` porte `viewport-fit=cover` (voir `BarreOngletsBasse.tsx`), la page peut
          s'étendre sous l'encoche/le coin arrondi sur TOUS les côtés, pas seulement en bas —
          sans cette marge, un appareil à encoche ferait passer le haut de la barre latérale ou
          de la barre d'outils supérieure dessous. Zéro sur tout appareil qui n'expose pas
          `env(safe-area-inset-*)` (desktop, la plupart des tablettes Android) : jetons déjà
          repliés à `0px`, voir `index.css`. */}
      <div className="min-h-dvh pt-zone-sure-haut pl-zone-sure-gauche pr-zone-sure-droite lg:flex">
        {/* Lien d'évitement — première cible du clavier sur chaque écran. Avec une barre latérale à
            six entrées et une rangée d'onglets, atteindre le contenu au clavier coûtait jusqu'à une
            dizaine de tabulations ; ce lien le fait en une. Invisible tant qu'il n'a pas le focus,
            jamais retiré du DOM (`sr-only` seul le cacherait aussi au focus). */}
        <a
          href="#contenu-principal"
          className="sr-only rounded-md bg-primary px-4 py-2 texte-corps font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          {t('navigation:evitement.contenu')}
        </a>

        {afficheNavigation ? (
          // `lg:sticky lg:top-0 lg:h-dvh` : l'aside a sa propre hauteur de viewport et reste ancré
          // pendant que la colonne de droite défile. `BarreLaterale` reçoit ainsi une hauteur définie
          // (`h-full` s'y résout) et garde son pied (Réglages + version) collé en bas — sans jamais
          // faire défiler ses six entrées, voir BarreLaterale.tsx. `lg:self-start` empêche
          // `align-items: stretch` du flex parent d'étirer l'aside à la hauteur de la colonne droite.
          <aside
            className={cn(
              'hidden shrink-0 self-start border-r lg:sticky lg:top-0 lg:block lg:h-dvh',
              // w-16 = 64 px replié : au-dessus du plancher tactile de 44 px une fois l'inset `p-2`
              // du repli soustrait (voir `BarreLaterale.tsx`) — jamais en dessous de 44 px, même
              // repliée, borne et comptoir compris.
              repliBarreLaterale.replie ? 'w-16' : 'w-60',
            )}
          >
            <BarreLaterale repli={repliBarreLaterale} />
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {afficheNavigation ? (
            // Tiroir de la barre latérale (téléphone/tablette), ouvert par « Plus » de la barre basse.
            <Sheet open={ouvert} onOpenChange={setOuvert}>
              <SheetContent side="left" className="w-60 p-0">
                {/* `SheetContent side="left"` pose déjà `fixed inset-y-0 ... h-full` (voir
                    `components/ui/sheet.tsx`) : le tiroir a donc une hauteur de viewport définie
                    sans rien ajouter ici, et `BarreLaterale` (h-full) s'y ancre exactement comme
                    dans l'aside desktop. */}
                <SheetTitle className="sr-only">{t('navigation:principale.aria')}</SheetTitle>
                <BarreLaterale />
              </SheetContent>
            </Sheet>
          ) : (
            <BandeauSansNavigation />
          )}

          {/* Aucune rangée d'onglets en mode scan mobile (`modeScan.actif`) : la seule destination
              qui reste accessible est `/scan` lui-même, une rangée à un seul onglet actif
              n'offrirait aucun choix réel — même raisonnement que le repli de la barre latérale
              ci-dessus, appliqué à ce second niveau de navigation. */}
          {modeScan.actif ? null : <OngletsDomaine />}

          {/* Limite d'erreur SCOPÉE à l'écran routé (issue #77, axe 1) — un crash de rendu dans
              l'écran affiché ne démonte plus la coquille entière (barre latérale, en-tête,
              onglets) : voir la justification complète dans `LimiteErreurEcran.tsx`. */}
          <main
            id="contenu-principal"
            className={cn(
              'flex-1 p-4 sm:p-6',
              // Dégagement pour la barre basse (56px + zone sûre) — SEULEMENT quand elle est
              // montée (`afficheBarreBasse`) et seulement `< md`, palier où elle est visible
              // (`md:hidden` sur `BarreOngletsBasse`) : au-delà, `md:pb-6` reprend le rembourrage
              // ordinaire. Défaut classique évité ici (voir la doc de tête du composant) : sans
              // ce padding, la barre recouvre la dernière ligne de chaque écran qui défile.
              afficheBarreBasse && 'pb-barre-onglets-degagement lg:pb-6',
            )}
          >
            <LimiteErreurEcran>
              {/* Toute route hors `/scan` redirige vers `/scan` en mode scan mobile — c'est ce qui
                  rend la restriction « stricte » (pas seulement une navigation masquée qu'une URL
                  tapée à la main contournerait) : atelier, facturation, liste de clients restent
                  des routes RÉELLES (utiles au menu desktop, à un lien profond partagé...), mais
                  un téléphone concerné n'y reste jamais affiché. `chemins.scan()` sans site : le
                  scan n'est pas scopé par site (voir sa doc dans `routes/chemins.ts`). */}
              {modeScan.actif && location.pathname !== chemins.scan() ? (
                <Navigate to={chemins.scan()} replace />
              ) : (
                <Outlet />
              )}
            </LimiteErreurEcran>
          </main>
        </div>

        {/* Barre basse — téléphone ET tablette (`lg:hidden`) : le bandeau du haut est supprimé,
            son bouton « Plus » est le seul déclencheur du `Sheet` (tiroir de la barre latérale). Placée hors de la
            colonne de droite (position `fixed`, indifférente à l'endroit du DOM) mais toujours
            sous `FournisseurSiteCourant`, dont elle a besoin pour résoudre le site courant des
            liens qu'elle pose. */}
        {afficheBarreBasse ? (
          <BarreOngletsBasse ouvrirPlus={() => setOuvert(true)} plusOuvert={ouvert} />
        ) : null}
      </div>
    </FournisseurSiteCourant>
  );
}
