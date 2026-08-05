import { AlertTriangle, Calendar, CalendarClock, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { calculerJoursRestants, determinerNiveauUrgence, type NiveauUrgence } from './urgence';

interface Props {
  /** `LigneSuiviVente.prochaineEcheanceLe` — `null` si aucune échéance n'est calculable/visible
   *  (jamais une approximation, voir l'en-tête du contrat). */
  readonly prochaineEcheanceLe: string | null;
  /** Injectable pour les tests (« aujourd'hui » figé) — `new Date()` par défaut. */
  readonly aujourdHui?: Date;
  readonly className?: string;
}

const ICONES: Record<NiveauUrgence, typeof AlertTriangle> = {
  echue: AlertTriangle,
  imminente: Clock,
  proche: CalendarClock,
  lointaine: Calendar,
};

const CLASSES_TOKEN: Record<NiveauUrgence, string> = {
  echue: 'border-transparent bg-statut-danger text-white',
  imminente: 'border-transparent bg-statut-attention text-white',
  proche: 'border-statut-info bg-background text-statut-info',
  lointaine: 'border-statut-neutre bg-background text-statut-neutre',
};

/**
 * Ce qui compte pour un vendeur, c'est ce qui arrive BIENTÔT (brief §"exigences d'écran") — cette
 * pastille traduit `prochaineEcheanceLe` en urgence visible d'un coup d'œil, jamais la seule
 * couleur (forme + icône + mot, même doctrine que `BadgeStatutDossierVente`).
 *
 * `null` -> aucune échéance connue (financement non confirmé sans échéance calculable, ou
 * financement masqué par rôle ET aucune garantie datée) : un texte neutre, JAMAIS une pastille
 * d'urgence — inventer une urgence sur une donnée absente serait pire que ne rien afficher.
 */
export function BadgeEcheanceSuivi({ prochaineEcheanceLe, aujourdHui, className }: Props) {
  const { t } = useTranslation('ventes');

  if (!prochaineEcheanceLe) {
    return (
      <span className={cn('texte-libelle text-muted-foreground', className)}>
        {t('ventes:suivi.urgence.aucune')}
      </span>
    );
  }

  const reference = aujourdHui ?? new Date();
  const joursRestants = calculerJoursRestants(prochaineEcheanceLe, reference);
  const niveau = determinerNiveauUrgence(joursRestants);
  const Icone = ICONES[niveau];

  let libelle: string;
  if (joursRestants < 0) {
    libelle = t('ventes:suivi.urgence.echue', { n: Math.abs(joursRestants) });
  } else if (joursRestants === 0) {
    libelle = t('ventes:suivi.urgence.aujourdHui');
  } else if (joursRestants === 1) {
    libelle = t('ventes:suivi.urgence.demain');
  } else {
    libelle = t('ventes:suivi.urgence.dansNJours', { n: joursRestants });
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        CLASSES_TOKEN[niveau],
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {libelle}
    </span>
  );
}
