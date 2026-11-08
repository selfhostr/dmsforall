// Interrupteur. coss (https://github.com/cosscom/coss) n'offre pas de `switch` sous
// `apps/ui/registry/default/ui/` (seul répertoire MIT) à la date de rédaction : le seul exemplaire
// du dépôt vit dans `packages/ui/`, AGPL-3.0, jamais copié. Écrit à la main sur la primitive
// Base UI (`@base-ui/react/switch`, MIT), comme `meter.tsx` : composant « feuille », ni portail ni
// piège de focus. Jetons du projet uniquement ; la cible tactile (`--cible-tactile`, 44 px) est
// portée par la zone cliquable, pas par la piste visible.
'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

type SwitchProps = Omit<SwitchPrimitive.Root.Props, 'className'> & { readonly className?: string };

export function Switch({ className, ...props }: SwitchProps): ReactElement {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      nativeButton
      render={<button type="button" />}
      className={cn(
        'group relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-input bg-muted p-0.5 outline-none transition-colors',
        'zone-cible anneau-focus',
        'data-[checked]:border-primary data-[checked]:bg-primary',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-foreground transition-transform',
          'data-[checked]:translate-x-5 data-[checked]:bg-primary-foreground',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
