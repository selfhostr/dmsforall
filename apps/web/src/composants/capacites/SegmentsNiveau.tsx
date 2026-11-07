import { Ban, Eye, Pencil, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { NiveauAcces, NiveauModele } from '@dfa/shared';

import { cn } from '@/lib/utils';

import { cleDuModele } from './grille';

const ICONES: Readonly<Record<NiveauAcces, LucideIcon>> = {
  rien: Ban,
  voir: Eye,
  faire: Pencil,
};

interface Props {
  readonly nom: string;
  readonly libelleGroupe: string;
  readonly niveaux: readonly NiveauModele[];
  readonly valeur: NiveauAcces;
  readonly onChange: (niveau: NiveauAcces) => void;
  readonly erreurId?: string;
}

/** Trois segments Rien / Voir / Faire de 44 px (cible tactile tablette), radios natifs : flèches
 *  au clavier, un seul arrêt de tabulation, état visible par fond + icône + mot. */
export function SegmentsNiveau({ nom, libelleGroupe, niveaux, valeur, onChange, erreurId }: Props) {
  const { t } = useTranslation('capacites');
  return (
    <div
      role="radiogroup"
      aria-label={libelleGroupe}
      aria-describedby={erreurId}
      className="inline-flex shrink-0 overflow-hidden rounded-md border"
    >
      {niveaux.map((niveau) => {
        const Icone = ICONES[niveau.id];
        return (
          <label
            key={niveau.id}
            className={cn(
              'flex min-h-11 min-w-[5.5rem] cursor-pointer items-center justify-center gap-1.5 px-3 texte-corps font-medium transition-colors',
              'border-l first:border-l-0',
              'has-[:checked]:bg-primary has-[:checked]:text-primary-foreground',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset',
            )}
          >
            <input
              type="radio"
              name={nom}
              value={niveau.id}
              checked={valeur === niveau.id}
              onChange={() => onChange(niveau.id)}
              className="sr-only"
            />
            <Icone className="h-4 w-4" aria-hidden="true" />
            {t(cleDuModele(niveau.libelleCle))}
          </label>
        );
      })}
    </div>
  );
}
