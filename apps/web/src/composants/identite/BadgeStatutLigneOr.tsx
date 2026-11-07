import {
  Ban,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  Hourglass,
  ReceiptText,
  ThumbsDown,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutLigneOr } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from './BadgeStatut';

interface EntreeStatutLigne {
  /** Suffixe de la clé `or:lignes.statuts.<cle>`. */
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/** Mapping exhaustif : ajouter un statut de ligne fait échouer `tsc` ici. */
const CONFIG_STATUT_LIGNE: Readonly<Record<StatutLigneOr, EntreeStatutLigne>> = {
  proposee: { cle: 'proposee', icone: CircleDashed, token: 'neutre', forme: 'contour' },
  a_valider: { cle: 'aValider', icone: Hourglass, token: 'attention', forme: 'contour' },
  validee: { cle: 'validee', icone: CircleCheck, token: 'info', forme: 'contour' },
  en_cours: { cle: 'enCours', icone: CirclePlay, token: 'info', forme: 'plein' },
  realisee: { cle: 'realisee', icone: Wrench, token: 'succes', forme: 'plein' },
  facturee: { cle: 'facturee', icone: ReceiptText, token: 'terminal', forme: 'plein' },
  refusee: { cle: 'refusee', icone: ThumbsDown, token: 'danger', forme: 'plein' },
  annulee: { cle: 'annulee', icone: Ban, token: 'danger', forme: 'contour' },
};

interface Props {
  readonly statut: StatutLigneOr;
  readonly className?: string;
}

/** Statut d'une ligne d'OR — famille `BadgeStatut` (forme + icône + mot). */
export function BadgeStatutLigneOr({ statut, className }: Props) {
  const { t } = useTranslation('or');
  const config = CONFIG_STATUT_LIGNE[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`or:lignes.statuts.${config.cle}`)}
    </BadgeStatut>
  );
}
