import type { ReactNode } from 'react';

interface Props {
  readonly titre: string;
  readonly description: string;
  readonly note?: string;
  readonly action?: ReactNode;
}

/** État vide générique : message + action optionnelle. Un écran sans action pertinente
 *  (ex. EcranAccueil à l'étape 0) omet simplement `action`. */
export function EtatVide({ titre, description, note, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <h2 className="text-lg font-semibold">{titre}</h2>
      <p className="max-w-md text-muted-foreground">{description}</p>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {action}
    </div>
  );
}
