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
// UN SEUL composant d'onglets/segments pour tout le produit (lot « densité et cibles ») :
//   - `variante="soulignee"` (défaut) : onglets de fiche, trait de marque sous l'onglet actif ;
//   - `variante="segments"` : sélecteur segmenté (bascule liste/plan, horizon, filtre d'onglet) —
//     contour de CONTRÔLE, donc bordure autorisée par DESIGN.md.
// Les deux ont la même cible : `--cible-tactile` (44 px, index.css), jamais `h-9`. Les liens de
// navigation (`OngletsDomaine`, qui ne sont pas des `tablist` mais des `<nav>` de liens) reprennent
// les MÊMES classes via `classesOnglet` / `classesSegment`, qui répondent à `aria-current="page"`
// comme à `data-active` : une seule source de style, deux sémantiques ARIA correctes.
//
// `h-11` (44 px) conservé sur `TabsTrigger` : plancher de cible tactile, porté par CHAQUE
// composant qui en a besoin (voir la même remarque dans `classes-champ.ts`), jamais perdu dans un
// changement de bibliothèque.
'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { type ComponentProps, type ReactElement, createContext, useContext } from 'react';

import { cn } from '@/lib/utils';

export type VarianteOnglets = 'soulignee' | 'segments';

const ContexteVariante = createContext<VarianteOnglets>('soulignee');

/** Onglet souligné. S'applique à un `Tab` Base UI (`data-active`) comme à un lien (`aria-current`). */
export const classesOnglet = cn(
  'inline-flex h-[var(--cible-tactile,2.75rem)] min-w-11 items-center justify-center whitespace-nowrap border-b-2 border-transparent px-3 texte-corps font-medium text-muted-foreground transition-colors',
  'hover:border-border hover:text-foreground',
  'anneau-focus',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
  // L'onglet actif combine texte plein et graisse ; l'indicateur de `TabsList` ajoute le trait
  // qui glisse. Deux signaux indépendants de la couleur seule.
  'data-active:font-semibold data-active:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-foreground',
);

/** Segment d'un sélecteur segmenté. Même double réponse `data-active` / `aria-current`. */
export const classesSegment = cn(
  'inline-flex h-[var(--cible-tactile,2.75rem)] min-w-11 items-center justify-center whitespace-nowrap rounded-sm px-3 texte-corps font-medium text-muted-foreground transition-colors',
  'hover:text-foreground',
  'anneau-focus',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
  'data-active:bg-background data-active:font-semibold data-active:text-foreground data-active:shadow-sm',
  'aria-[current=page]:bg-background aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-sm',
);

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  children,
  variante = 'soulignee',
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variante?: VarianteOnglets }): ReactElement {
  if (variante === 'segments') {
    return (
      <ContexteVariante.Provider value="segments">
        <TabsPrimitive.List
          className={cn(
            'inline-flex items-stretch gap-1 rounded-md border bg-muted/40 p-0.5',
            className,
          )}
          data-slot="tabs-list"
          {...props}
        >
          {children}
        </TabsPrimitive.List>
      </ContexteVariante.Provider>
    );
  }
  return (
    <ContexteVariante.Provider value="soulignee">
      <TabsPrimitive.List
        className={cn(
          'relative z-0 inline-flex h-[var(--cible-tactile,2.75rem)] items-center gap-1 border-b',
          className,
        )}
        data-slot="tabs-list"
        {...props}
      >
        {children}
        {/* Glisse sous l'onglet actif (position/largeur calculées par Base UI, exposées en
            variables CSS) — la couleur de marque ne porte jamais seule l'information « c'est ici
            que vous êtes » : le texte de l'onglet actif reste aussi plus gras et plus foncé. */}
        <TabsPrimitive.Indicator
          className="absolute bottom-0 left-0 z-10 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) bg-primary transition-[width,translate] duration-[var(--duree-normale)] ease-[var(--courbe-standard)]"
          data-slot="tabs-indicator"
        />
      </TabsPrimitive.List>
    </ContexteVariante.Provider>
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Tab>): ReactElement {
  const variante = useContext(ContexteVariante);
  return (
    <TabsPrimitive.Tab
      className={cn(variante === 'segments' ? classesSegment : classesOnglet, className)}
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
