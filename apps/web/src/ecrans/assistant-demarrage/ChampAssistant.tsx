import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly libelle: string;
  readonly aide?: ReactNode;
  readonly erreur?: string | undefined;
  readonly classeRacine?: string;
}

/** Libellé + champ + aide + erreur reliés par `aria-describedby` (l'erreur est annoncée). */
export function ChampAssistant({
  libelle,
  aide,
  erreur,
  classeRacine,
  className,
  ...reste
}: Props) {
  const id = useId();
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;
  const decrit = [aide ? idAide : null, erreur ? idErreur : null].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-1.5', classeRacine)}>
      <Label htmlFor={id}>{libelle}</Label>
      <Input
        id={id}
        className={className}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={decrit || undefined}
        {...reste}
      />
      {aide ? (
        <p id={idAide} className="texte-libelle text-muted-foreground">
          {aide}
        </p>
      ) : null}
      {erreur ? (
        <p id={idErreur} className="texte-libelle text-destructive" role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
