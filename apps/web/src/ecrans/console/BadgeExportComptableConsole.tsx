import { CheckCircle2, Clock, HelpCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { StatutExportComptableConsole } from '@dfa/shared';
import { useTranslation } from 'react-i18next';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import type { FormeBadge, TokenStatut } from '@/composants/identite/BadgeStatut';

interface EntreeExportComptable {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
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
    token: 'neutre',
    forme: 'contour',
  },
  transmis: {
    icone: Clock,
    token: 'info',
    forme: 'contour',
  },
  accepte: {
    icone: CheckCircle2,
    token: 'succes',
    forme: 'contour',
  },
  rejete: {
    icone: XCircle,
    token: 'danger',
    forme: 'plein',
  },
};

const CONFIG_EXPORT_COMPTABLE_INCONNU: EntreeExportComptable = {
  icone: HelpCircle,
  token: 'neutre',
  forme: 'contour',
};

interface Props {
  readonly statut: StatutExportComptableConsole | null;
  readonly className?: string;
}

export function BadgeExportComptableConsole({ statut, className }: Props) {
  const { t } = useTranslation('console');
  const {
    icone: Icone,
    token,
    forme,
  } = statut === null ? CONFIG_EXPORT_COMPTABLE_INCONNU : CONFIG_EXPORT_COMPTABLE[statut];
  const cle = statut ?? 'inconnu';

  return (
    <BadgeStatut icone={Icone} token={token} forme={forme} className={className}>
      {t(`console:plateforme.table.exportCompta.${cle}`)}
    </BadgeStatut>
  );
}
