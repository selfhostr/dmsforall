import { Menu } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

import { BarreLaterale } from './BarreLaterale';
import { EnTete } from './EnTete';
import { entreesVisibles } from './navigation-modele';
import { OngletsDomaine } from './OngletsDomaine';
import { useRepliBarreLaterale } from './useRepliBarreLaterale';

/**
 * >=1024px : barre latérale fixe 240px. En dessous : Sheet (tiroir) déclenché par un bouton
 * hamburger dans la bande supérieure mobile.
 *
 * Lot D — DEUX ajouts. (1) `OngletsDomaine` est monté ICI, une fois, entre l'en-tête et le
 * contenu : le second niveau de l'arborescence existe donc pour toute route qui appartient au
 * menu, sans qu'aucun écran n'ait à s'en souvenir (voir la justification complète en tête
 * d'`OngletsDomaine.tsx`). (2) La colonne de navigation disparaît entièrement quand le compte
 * connecté n'a aucune entrée — c'est le cas de `poste_atelier`, la borne murale : un appareil, pas
 * un employé (§2 de l'arbitrage, « aucun menu, aucun en-tête, aucune recherche »). Afficher une
 * colonne vide sur une tablette d'atelier serait pire que de ne pas l'afficher.
 *
 * L'en-tête reste en place pour la borne, contrairement à la lettre de §2 : il porte le bouton
 * « Se déconnecter », et une borne partagée qu'on ne peut plus déconnecter au comptoir est un
 * problème d'exploitation réel. Le plein écran intégral de la borne est une décision qui appartient
 * à `ecrans/pointage/` (signalé à la session, hors du périmètre d'écriture du Lot D).
 */
export function AppShell() {
  const { t } = useTranslation('navigation');
  const [ouvert, setOuvert] = useState(false);
  const { data: session } = useSession();
  const afficheNavigation = entreesVisibles(session?.utilisateur.role).length > 0;
  // Repli DESKTOP de la barre latérale (demande @laupernoe, revue webui du 10.08.2026) — préférence
  // mémorisée (`useRepliBarreLaterale`), lue ici et nulle part ailleurs : seul l'`aside` ci-dessous
  // la reçoit. Le tiroir mobile (`Sheet`) monte `BarreLaterale` SANS le prop `repli`, il reste donc
  // toujours déplié quelle que soit cette préférence — déjà en surimpression, déjà refermable d'un
  // geste, un repli y ferait double emploi.
  const repliBarreLaterale = useRepliBarreLaterale();

  return (
    <div className="min-h-dvh lg:flex">
      {/* Lien d'évitement — première cible du clavier sur chaque écran. Avec une barre latérale à
          six entrées et une rangée d'onglets, atteindre le contenu au clavier coûtait jusqu'à une
          dizaine de tabulations ; ce lien le fait en une. Invisible tant qu'il n'a pas le focus,
          jamais retiré du DOM (`sr-only` seul le cacherait aussi au focus). */}
      <a
        href="#contenu-principal"
        className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
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
          <div className="flex items-center border-b lg:hidden">
            <Sheet open={ouvert} onOpenChange={setOuvert}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="m-2"
                  aria-label={t('navigation:menu.ouvrir')}
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-60 p-0">
                {/* `SheetContent side="left"` pose déjà `fixed inset-y-0 ... h-full` (voir
                    `components/ui/sheet.tsx`) : le tiroir a donc une hauteur de viewport définie
                    sans rien ajouter ici, et `BarreLaterale` (h-full) s'y ancre exactement comme
                    dans l'aside desktop. */}
                <SheetTitle className="sr-only">{t('navigation:principale.aria')}</SheetTitle>
                <BarreLaterale className="pt-4" />
              </SheetContent>
            </Sheet>
          </div>
        ) : null}

        <EnTete />

        <OngletsDomaine />

        <main id="contenu-principal" className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
