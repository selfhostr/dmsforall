import { Ban, CheckCircle2, Circle, Handshake, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutReprise } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

interface EntreeStatutReprise {
  readonly icone: LucideIcon;
  readonly token: Extract<TokenStatut, 'neutre' | 'info' | 'succes' | 'danger'>;
  readonly forme: FormeBadge;
}

/**
 * Mapping exhaustif et type-safe (même patron que `composants/identite/BadgeStatutOr.tsx`) : une
 * cinquième valeur ajoutée à `STATUTS_REPRISE` (@dfa/shared, gelé — improbable, mais le filet
 * reste correct) fait échouer `tsc` avant d'atteindre un écran.
 *
 * `refusee` en token `danger`/CONTOUR (jamais plein) — §3.5/§8.4 du design : un badge rouge sur
 * une reprise refusée ne doit pas lire comme une erreur du produit, juste comme un fait (le mot
 * « Refusée » suffit à désambiguïser, la couleur seule ne porte jamais le sens).
 */
const CONFIG_STATUT_REPRISE: Readonly<Record<StatutReprise, EntreeStatutReprise>> = {
  estimee: { icone: Circle, token: 'neutre', forme: 'contour' },
  negociee: { icone: Handshake, token: 'info', forme: 'plein' },
  confirmee: { icone: CheckCircle2, token: 'succes', forme: 'plein' },
  refusee: { icone: Ban, token: 'danger', forme: 'contour' },
};

interface Props {
  readonly statut: StatutReprise;
  readonly className?: string;
}

/** Statut affiché d'une reprise (`STATUTS_REPRISE`, `contrats/ventes/enums.ts`) — couleur + forme
 *  + icône + mot, jamais la couleur seule (doctrine daltonisme, `BadgeStatutOr`). */
export function BadgeStatutReprise({ statut, className }: Props) {
  const { t } = useTranslation('ventes');
  const config = CONFIG_STATUT_REPRISE[statut];
  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`ventes:reprise.statuts.${statut}`)}
    </BadgeStatut>
  );
}
