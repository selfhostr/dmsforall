import { CheckCircle2, Clock, HelpCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { StatutExportComptableConsole } from '@dfa/shared';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface EntreeExportComptable {
  readonly icone: LucideIcon;
  readonly classes: string;
}

/** Même doctrine que `BadgeStatutGarage` : couleur ET forme, mapping exhaustif type-safe sur les
 *  quatre statuts RÉELS du contrat (`genere`, `transmis`, `accepte`, `rejete` —
 *  `public.statut_export_comptable`, `@dfa/shared`). `garage.dernierExportComptableStatut` est en
 *  plus `| null` : `null` signifie « aucun export n'a JAMAIS eu lieu pour ce garage », rendu à part
 *  (jamais fondu dans une des quatre valeurs réelles) — voir la règle du dépôt « une absence de
 *  donnée n'est pas une valeur » (CONTRIBUTING.md, § pièges vérifiés). */
const CONFIG_EXPORT_COMPTABLE: Readonly<
  Record<StatutExportComptableConsole, EntreeExportComptable>
> = {
  genere: {
    icone: Clock,
    classes: 'border-input text-muted-foreground',
  },
  transmis: {
    icone: Clock,
    classes: 'border-input text-foreground',
  },
  accepte: {
    icone: CheckCircle2,
    classes: 'border-input text-foreground',
  },
  rejete: {
    icone: XCircle,
    classes: 'border-transparent bg-destructive text-destructive-foreground',
  },
};

const CONFIG_EXPORT_COMPTABLE_INCONNU: EntreeExportComptable = {
  icone: HelpCircle,
  classes: 'border-input text-muted-foreground',
};

interface Props {
  readonly statut: StatutExportComptableConsole | null;
  readonly className?: string;
}

export function BadgeExportComptableConsole({ statut, className }: Props) {
  const { t } = useTranslation('console');
  const { icone: Icone, classes } =
    statut === null ? CONFIG_EXPORT_COMPTABLE_INCONNU : CONFIG_EXPORT_COMPTABLE[statut];
  const cle = statut ?? 'inconnu';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        classes,
        className,
      )}
    >
      <Icone className="h-3.5 w-3.5" aria-hidden="true" />
      {t(`console:plateforme.table.exportCompta.${cle}`)}
    </span>
  );
}
