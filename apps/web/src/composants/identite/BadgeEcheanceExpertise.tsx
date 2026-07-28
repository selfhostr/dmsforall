import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { formaterDate } from '@/lib/formats';

interface Props {
  /** `ReponseVehiculeExpertise.prochaineEcheanceLe` / `ReponseContexteAtelier.expertise.prochaineLe`.
   *  `null` -> aucune échéance connue, le composant ne rend rien (RM-28/RM-29). */
  readonly prochaineLe: string | null;
  /** `ReponseContexteAtelier.expertise.echue` — calculé serveur, jamais recalculé côté client. */
  readonly echue: boolean;
  readonly className?: string;
}

/** Nombre de mois pleins entre aujourd'hui et une date d'échéance (arrondi à l'entier supérieur).
 *  Affichage uniquement — la décision « échue » vient toujours du serveur (`echue`), jamais
 *  recalculée ici : ne sert qu'à composer le mot relatif de `vehicules:expertise.eche`. */
function moisRestants(dateEcheanceIso: string, maintenant: Date): number {
  const echeance = new Date(dateEcheanceIso);
  const joursRestants = (echeance.getTime() - maintenant.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(joursRestants / 30));
}

/**
 * Échéance d'expertise (MFK) — forme + mot, jamais de couleur de la palette statut (§5.4).
 * Invariant n°5 (docs/plan-etape-1-frontend.md §11) : le relatif (« échoit dans 2 mois »)
 * n'apparaît jamais seul, toujours accompagné de la date absolue (`formaterDate`).
 */
export function BadgeEcheanceExpertise({ prochaineLe, echue, className }: Props) {
  const { t } = useTranslation('vehicules');

  if (!prochaineLe) {
    return null;
  }

  const mot = echue
    ? t('vehicules:expertise.echue')
    : t('vehicules:expertise.eche', { mois: moisRestants(prochaineLe, new Date()) });

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 texte-libelle font-medium',
        echue ? 'font-semibold text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {mot} · {formaterDate(prochaineLe)}
    </span>
  );
}
