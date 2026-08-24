import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BadgeAttribut } from './BadgeAttribut';

interface Props {
  /** `ReponseVehicule.identificationIncomplete` / `VehiculeResume.identificationIncomplete`
   *  (RM-16). `false` -> le composant ne rend rien : ce badge ne signale qu'un écart, jamais un
   *  état normal. */
  readonly identificationIncomplete: boolean;
  readonly className?: string;
}

/**
 * Signale un VIN absent ou incomplet (RM-16, avertissement serveur
 * `VEHICULE_IDENTIFICATION_INCOMPLETE`). Forme + mot, jamais de token `--statut-*` (§5.4 du
 * document atelier : ce n'est ni un statut d'OR ni un statut de ligne).
 *
 * GAP I18N signalé : aucune clé courte n'existe pour ce badge (ex. `vehicules:identite.*`) ; ce
 * composant réutilise la phrase longue `erreurs:avertissements.VEHICULE_IDENTIFICATION_INCOMPLETE`,
 * seule traduction existante rattachée à ce concept métier. À remplacer par une clé dédiée courte
 * si la densité d'un écran (table dense) l'exige — voir signalement à expert-i18n.
 */
export function BadgeIdentificationIncomplete({ identificationIncomplete, className }: Props) {
  const { t } = useTranslation('vehicules');

  if (!identificationIncomplete) {
    return null;
  }

  return (
    <BadgeAttribut
      icone={<HelpCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      className={className}
    >
      {t('vehicules:badges.identificationIncomplete')}
    </BadgeAttribut>
  );
}
