import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  readonly message: string;
  readonly className?: string;
}

/** Encart neutre-informatif pour un trop-perçu (§5.3) — variante NON alarmante du patron d'encart
 *  d'alertes (`design-comptoir.md` §6), sur `--muted`, jamais sur un token de statut : un
 *  trop-perçu n'est pas une anomalie, c'est une avance client à affecter plus tard. */
export function EncartAvanceClient({ message, className }: Props) {
  return (
    <div className={cn('flex items-start gap-3 rounded-md border bg-muted px-4 py-3 texte-corps text-foreground', className)}>
      <Info aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <p>{message}</p>
    </div>
  );
}
