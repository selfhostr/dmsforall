import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { SheetTrigger } from '@/components/ui/sheet';

import { RechercheGlobale } from './RechercheGlobale';

/**
 * BANDEAU SUPÉRIEUR — Lot « cadre applicatif » (19.08.2026, demande @laupernoe), remplace `EnTete.tsx`.
 *
 * Ce que l'ancienne `EnTete.tsx` portait — nom du tenant, sélecteur de site, identité, bouton
 * « Se déconnecter » — DESCEND dans `BarreLaterale.tsx` (contexte permanent, appartient au cadre,
 * pas à une bande qui se répète en haut de chaque écran, voir sa doc de tête §1-2). Il ne restait
 * donc qu'une seule chose à porter ici : la RECHERCHE. C'est le troisième point du brief de ce lot
 * (« si l'en-tête ne contient plus que la recherche, envisage de le supprimer complètement ») —
 * mesuré, pas supprimé, PLACÉ ICI :
 *
 *  - La barre latérale desktop est un `aside` PERSISTANT (`AppShell.tsx`, `lg:sticky lg:top-0`) :
 *    un contrôle qui y vivrait resterait aussi vite atteignable qu'ici. Mais le tiroir mobile
 *    (`Sheet`) est FERMÉ par défaut — y enfouir la recherche aurait forcé un garagiste sur
 *    téléphone/tablette à ouvrir le menu avant de chercher une plaque ou un client, alors que la
 *    doc de `RechercheGlobale.tsx` est explicite (Lot A) : « jamais supposer un clavier — postes
 *    tactiles ». Un bandeau FIN, permanent, indépendant de l'état ouvert/fermé du tiroir, est le
 *    seul choix qui ne dégrade la recherche sur AUCUN appareil.
 *  - 48 px de haut (`h-12`), pas 64 (`h-16` de l'ancienne `EnTete`) : plus rien d'autre n'y vit,
 *    la hauteur suit le seul contenu réel — un bouton de 44 px (plancher tactile) et 2 px de
 *    respiration de chaque côté.
 *  - La ligne « bouton hamburger seul » du tiroir mobile, qui vivait EMPILÉE au-dessus de
 *    l'ancienne `EnTete` (`AppShell.tsx`, avant ce lot), est FUSIONNÉE ici plutôt que dupliquée à
 *    côté : sur téléphone, un garagiste gagne donc une rangée ENTIÈRE en plus des 16 px gagnés sur
 *    la hauteur du bandeau lui-même. Le bouton reste `lg:hidden` (le tiroir n'existe pas au-delà
 *    de ce seuil, `BarreLaterale` reste visible en `aside`).
 *
 * `SheetTrigger` (pas un `onClick` manuel) : ce composant est monté comme enfant direct d'un
 * `<Sheet>` par `AppShell.tsx` — Radix relie le déclencheur au tiroir par le contexte, sans props à
 * faire transiter ici, et pose lui-même `aria-expanded`/`aria-haspopup` sur le bouton.
 *
 * ABSENT pour `poste_atelier`/mode scan mobile (`AppShell.tsx`, `afficheNavigation` faux) — voir
 * `BandeauSansNavigation.tsx` à la place, qui ne porte aucune recherche (§2 : « aucun menu, aucun
 * en-tête, aucune recherche » pour la borne murale ; restriction stricte au scan pour le mode
 * mobile — un champ de recherche y contredirait l'un comme l'autre).
 */
export function BarreOutilsSuperieure() {
  const { t } = useTranslation('navigation');

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2">
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          aria-label={t('navigation:menu.ouvrir')}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <div className="flex min-w-0 flex-1 justify-center">
        <RechercheGlobale />
      </div>
    </header>
  );
}
