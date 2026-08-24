import { PencilLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formaterHeure } from '@/lib/formats';
import { cn } from '@/lib/utils';

interface Props {
  /** Horodatage ISO de la dernière sauvegarde locale reprise (file hors ligne / brouillon
   *  restauré). Formaté en `HH:MM` via `formaterHeure` (jamais un format ad hoc). */
  readonly repriseLe: string;
  readonly className?: string;
}

/** Bandeau de brouillon repris — signale qu'une saisie interrompue (ex. panne réseau, tablette
 *  fermée) a été restaurée depuis le stockage local. Réutilise `reception:brouillon`, seule clé
 *  existante rattachée à ce concept (aucun namespace dédié « brouillon » générique). */
export function BandeauBrouillon({ repriseLe, className }: Props) {
  const { t } = useTranslation('reception');

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border border-statut-attention bg-statut-attention-fond p-carte texte-corps text-foreground',
        className,
      )}
    >
      <PencilLine aria-hidden className="h-5 w-5 shrink-0 text-statut-attention" />
      <p>{t('reception:brouillon', { heure: formaterHeure(repriseLe) })}</p>
    </div>
  );
}
