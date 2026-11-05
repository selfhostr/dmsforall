// Adapté de coss (https://github.com/cosscom/coss, apps/ui/registry/default/ui/tabs.tsx, licence
// MIT — voir apps/ui/LICENSING.md du dépôt source : seuls apps/origin/ et apps/ui/ y sont MIT, le
// reste du dépôt coss est AGPL-3.0, ne JAMAIS copier depuis un autre répertoire). Primitive Base UI
// (`@base-ui/react/tabs`, MIT, déjà une dépendance du projet via `meter.tsx`) au lieu de Radix —
// composant « feuille » au sens de la frontière posée dans CONTRIBUTING.md : ni portail, ni piège de
// focus. Seul écart repris de coss : l'indicateur (`TabsIndicator`) qui glisse sous l'onglet actif
// au lieu d'un changement de couleur instantané — le reste (variante « pill », tailles multiples,
// classes fixes) n'a pas été repris, sans valeur pour ce produit à un seul style d'onglets.
//
// API publique inchangée (`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `value`/`onValueChange`/
// `defaultValue`/`className`) : les 14 usages du produit n'appellent que ces props, aucun ne
// dépend d'une particularité Radix (`asChild`, `activationMode`…) — vérifié par grep avant la
// reprise.
//
// `h-11` (44 px) conservé sur `TabsTrigger` : plancher de cible tactile, porté par CHAQUE
// composant qui en a besoin (voir la même remarque dans `classes-champ.ts`), jamais perdu dans un
// changement de bibliothèque.
'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import type { ComponentProps, ReactElement } from 'react';

import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>): ReactElement {
  return (
    <TabsPrimitive.List
      className={cn('relative z-0 inline-flex h-11 items-center gap-1 border-b', className)}
      data-slot="tabs-list"
      {...props}
    >
      {children}
      {/* Glisse sous l'onglet actif (position/largeur calculées par Base UI, exposées en
          variables CSS) — la couleur de marque ne porte jamais seule l'information « c'est ici
          que vous êtes » : le texte de l'onglet actif reste aussi plus gras et plus foncé
          (`TabsTrigger` ci-dessous). */}
      <TabsPrimitive.Indicator
        className="absolute bottom-0 left-0 z-10 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) bg-primary transition-[width,translate] duration-[var(--duree-normale)] ease-[var(--courbe-standard)]"
        data-slot="tabs-indicator"
      />
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Tab>): ReactElement {
  return (
    <TabsPrimitive.Tab
      className={cn(
        'inline-flex h-11 items-center justify-center whitespace-nowrap border-b-2 border-transparent px-3 texte-corps font-medium text-muted-foreground transition-colors',
        'hover:border-border hover:text-foreground',
        'anneau-focus',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        // L'onglet actif combine texte plein et graisse ; l'indicateur ci-dessus ajoute le trait
        // qui glisse. Deux signaux indépendants de la couleur seule.
        'data-active:font-semibold data-active:text-foreground',
        className,
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Panel>): ReactElement {
  return (
    <TabsPrimitive.Panel
      className={cn('anneau-focus', className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}
