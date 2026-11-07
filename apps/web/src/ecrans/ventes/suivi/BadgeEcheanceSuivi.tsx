import { AlertTriangle, Calendar, CalendarClock, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

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

const FORME_TOKEN: Record<NiveauUrgence, { token: TokenStatut; forme: FormeBadge }> = {
  echue: { token: 'danger', forme: 'plein' },
  imminente: { token: 'attention', forme: 'plein' },
  proche: { token: 'info', forme: 'contour' },
  lointaine: { token: 'neutre', forme: 'contour' },
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
    <BadgeStatut icone={Icone} {...FORME_TOKEN[niveau]} className={className}>
      {libelle}
    </BadgeStatut>
  );
}
