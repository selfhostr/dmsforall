import { Ban, Calendar, CheckCircle2, UserX, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutRdv } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

interface EntreeStatutRendezVous {
  /** Suffixe de la clé `planning:statuts.<cle>` — vocabulaire d'écran (« Arrivé »), DISTINCT du nom
   *  de l'enum serveur (`honore`, `@dfa/shared`) : la conception impose le mot « Le véhicule est
   *  arrivé »/« Arrivé », jamais le terme technique « honoré » à l'écran (même patron d'indirection
   *  que `BadgeStatutOr.CONFIG_STATUT_OR`, `cle` distinct de la clé d'objet). */
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/** Mapping exhaustif, sur le modèle de `CONFIG_STATUT_OR` (`BadgeStatutOr.tsx`) — QUATRE statuts
 *  réels (`StatutRdv`, `@dfa/shared`) : `confirme`/`honore`/`absent`/`annule`. Pas de `reporte` — le
 *  serveur ne l'implémente pas (RV-16, un déplacement de date reste `confirme`). */
const CONFIG_STATUT_RENDEZ_VOUS: Readonly<Record<StatutRdv, EntreeStatutRendezVous>> = {
  confirme: { cle: 'confirme', icone: Calendar, token: 'neutre', forme: 'contour' },
  honore: { cle: 'arrive', icone: CheckCircle2, token: 'succes', forme: 'plein' },
  // `UserX`, jamais `Ban` : « client absent » désigne une personne, pas une action refusée — lève
  // toute ambiguïté avec `annule` ci-dessous, qui porte le même token `danger`.
  absent: { cle: 'absent', icone: UserX, token: 'danger', forme: 'plein' },
  // `Ban` (cercle barré) — même iconographie que `BadgeStatutOr.annule` : le mot « supprimer »
  // n'existe pas dans ce produit, l'icône non plus.
  annule: { cle: 'annule', icone: Ban, token: 'danger', forme: 'contour' },
};

interface Props {
  readonly statut: StatutRdv;
  readonly className?: string;
}

/** Statut affiché d'un rendez-vous — famille `BadgeStatut`, même patron que `BadgeStatutOr`. */
export function BadgeStatutRendezVous({ statut, className }: Props) {
  const { t } = useTranslation('planning');
  const config = CONFIG_STATUT_RENDEZ_VOUS[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`planning:statuts.${config.cle}`)}
    </BadgeStatut>
  );
}
