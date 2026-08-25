import { Ban, Circle, CircleOff, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutClient } from '@dfa/shared';

import { BadgeAttribut } from './BadgeAttribut';

interface EntreeStatutClient {
  readonly icone: LucideIcon;
  /** `true` -> texte accentué (`text-foreground` + gras) pour le seul statut qui empêche une
   *  action (`bloque`). Jamais un token `--statut-*` : ce n'est pas un statut d'OR/ligne (§5.1 du
   *  document atelier, §2 de docs/design-comptoir.md — le budget couleur leur est réservé). */
  readonly accentue: boolean;
}

/** Mapping exhaustif et type-safe (sur le modèle de `lib/roles.ts`) : ajouter un statut à
 *  `STATUTS_CLIENT` fait échouer `tsc` ici avant de pouvoir atteindre un écran. */
const CONFIG_STATUT_CLIENT: Readonly<Record<StatutClient, EntreeStatutClient>> = {
  actif: { icone: Circle, accentue: false },
  inactif: { icone: CircleOff, accentue: false },
  bloque: { icone: Ban, accentue: true },
};

interface Props {
  readonly statut: StatutClient;
  readonly className?: string;
}

/** Statut client — forme + mot, jamais de couleur de la palette statut (réservée au statut
 *  d'OR/de ligne). `bloque` (impayés, RM-08) se distingue par le poids du texte et l'icône `Ban`,
 *  pas par une teinte. Compose `BadgeAttribut`, base partagée de la famille des badges
 *  d'attribut métier (voir son en-tête) — seul le mapping `StatutClient -> {icone, accentue}`
 *  reste local à ce fichier. */
export function BadgeStatutClient({ statut, className }: Props) {
  const { t } = useTranslation('clients');
  const config = CONFIG_STATUT_CLIENT[statut];
  const Icone = config.icone;

  return (
    <BadgeAttribut
      icone={<Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      accentue={config.accentue}
      className={className}
    >
      {t(`clients:liste.statuts.${statut}`)}
    </BadgeAttribut>
  );
}
