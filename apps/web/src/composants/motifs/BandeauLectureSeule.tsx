import { Lock } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  /**
   * Motif déjà traduit par l'écran appelant (ex. `t('or:refus.orFacture')`,
   * `t('erreurs:codes.DROIT_INSUFFISANT')`) — GAP I18N signalé : aucune clé générique
   * `*.lectureSeule` n'existe dans les 13 namespaces enregistrés (recherche exhaustive sur
   * « lecture »). Ce composant suit donc le même contrat que `EtatVide`/`EtatErreur`
   * (composants/commun/) : il rend un texte déjà résolu par l'appelant plutôt que de posséder sa
   * propre clé, en attendant qu'expert-i18n tranche l'emplacement définitif d'un message
   * générique de lecture seule.
   */
  readonly motif: string;
  readonly className?: string;
}

/** Bandeau de lecture seule — un document/écran ne peut pas être modifié dans son état courant
 *  (ex. OR clôturé, droit insuffisant). Neutre (`foreground`/`muted-foreground`) : ce n'est ni un
 *  avertissement ni un refus d'action, seulement une information de contexte permanente. */
export function BandeauLectureSeule({ motif, className }: Props) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border bg-muted p-carte texte-corps text-muted-foreground',
        className,
      )}
    >
      <Lock aria-hidden className="h-5 w-5 shrink-0" />
      <p>{motif}</p>
    </div>
  );
}
