import { Check, Copy } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface ProprietesBoutonCopier {
  readonly valeur: string;
  readonly className?: string;
}

/** Icône de copie pour une donnée lue au comptoir/téléphone (code radio, VIN, code type…) —
 *  docs/design-comptoir.md : « le comptoir lit un code radio au téléphone ». Cible tactile 44px,
 *  confirmation visuelle brève sans dépendre de la couleur seule (icône qui change de forme). */
export function BoutonCopier({ valeur, className }: ProprietesBoutonCopier) {
  const { t } = useTranslation('commun');
  const [copie, setCopie] = useState(false);

  async function copier(evenement: MouseEvent<HTMLButtonElement>) {
    evenement.stopPropagation();
    await navigator.clipboard.writeText(valeur);
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={(evenement) => {
        void copier(evenement);
      }}
      aria-label={t('actions.copier')}
      title={t('actions.copier')}
      className={cn(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {copie ? <Check aria-hidden className="h-4 w-4 text-statut-succes" /> : <Copy aria-hidden className="h-4 w-4" />}
    </button>
  );
}
