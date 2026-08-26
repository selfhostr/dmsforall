import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import type { NiveauSanteGarage } from '@dfa/shared';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface EntreeStatutGarage {
  readonly icone: LucideIcon;
  /** Classes de fond+texte+bordure — jamais la couleur seule (guide d'accessibilité du dépôt,
   *  daltonisme) : chaque état a aussi sa propre icône (forme), voir `icone`. */
  readonly classes: string;
}

/**
 * Mapping exhaustif et type-safe (même patron que `BadgeStatutOr`/`BadgeStatutClient`,
 * `composants/identite/`) : ajouter une valeur à `NiveauSanteGarage` (`@dfa/shared`) fait échouer
 * `tsc` avant d'atteindre l'écran. Couleur ET forme distinctes pour les trois états — jamais la
 * couleur seule :
 *  - `critique` : plein rouge, `XCircle` — bloque un geste métier chez le garage, là, maintenant.
 *  - `attention` : plein ambre, `AlertTriangle` — à surveiller, pas encore bloquant.
 *  - `ok` : contour neutre, `CheckCircle2` — délibérément discret, ce n'est pas l'état qu'on
 *    scanne en premier (§0 de la conception : on cherche l'anomalie, pas la normalité).
 */
const CONFIG_STATUT_GARAGE: Readonly<Record<NiveauSanteGarage, EntreeStatutGarage>> = {
  critique: {
    icone: XCircle,
    classes: 'border-transparent bg-destructive text-destructive-foreground',
  },
  attention: {
    // Résidu `dark:` du socle — code mort tant qu'aucun mode sombre réel n'existait, devenu
    // vivant depuis la refonte visuelle (voir DESIGN.md). MESURÉ (formule WCAG 2.1) : sombre
    // `bg-amber-500`/`text-amber-950` = 6.98:1, passe large le seuil AA texte (4.5:1) — aucun
    // correctif nécessaire ici, contrairement au même résidu de `BandeauContexteConsole.tsx`
    // (celui-là échouait à 3.07:1, corrigé).
    icone: AlertTriangle,
    classes: 'border-transparent bg-amber-600 text-white dark:bg-amber-500 dark:text-amber-950',
  },
  ok: {
    icone: CheckCircle2,
    classes: 'border-input text-foreground',
  },
};

interface Props {
  readonly statut: NiveauSanteGarage;
  readonly className?: string;
}

export function BadgeStatutGarage({ statut, className }: Props) {
  const { t } = useTranslation('console');
  const { icone: Icone, classes } = CONFIG_STATUT_GARAGE[statut];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 texte-petit font-medium',
        classes,
        className,
      )}
    >
      <Icone className="h-3.5 w-3.5" aria-hidden="true" />
      {t(`console:plateforme.statut.${statut}`)}
    </span>
  );
}
