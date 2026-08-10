import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Bloc d'attente d'une donnée serveur. À poser partout où une requête peut être en cours
 * (règle CONTRIBUTING.md : chaque écran gère explicitement chargement / vide / erreur).
 *
 * `aria-hidden` par défaut, et c'est délibéré : un squelette est une forme, pas un message.
 * C'est le conteneur qui attend la donnée qui doit porter l'annonce (`aria-busy` sur la zone,
 * ou une région `role="status"` du type « chargement des ordres de réparation »). Sans cela un
 * lecteur d'écran n'annonce rien pendant l'attente, ou énumère des blocs vides.
 *
 * La pulsation est RALENTIE et non supprimée sous `prefers-reduced-motion` (voir index.css) :
 * un squelette figé ne se distingue plus d'une zone définitivement vide.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
