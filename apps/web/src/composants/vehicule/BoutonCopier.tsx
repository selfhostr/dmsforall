import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface ProprietesBoutonCopier {
  readonly valeur: string;
  readonly className?: string;
}

const DELAI_CONFIRMATION_MS = 1500;

/** Icône de copie pour une donnée lue au comptoir/téléphone (code radio, VIN, code type…) —
 *  docs/design-comptoir.md : « le comptoir lit un code radio au téléphone ». Cible tactile 44px,
 *  confirmation visuelle brève sans dépendre de la couleur seule (icône qui change de forme). */
export function BoutonCopier({ valeur, className }: ProprietesBoutonCopier) {
  const { t } = useTranslation('commun');
  const [copie, setCopie] = useState(false);
  // Le timer de retour à l'icône par défaut doit être nettoyé au démontage (navigation pendant la
  // fenêtre de confirmation) : sans ça, `setCopie` s'exécute sur un composant démonté.
  const minuteurRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (minuteurRef.current !== null) {
        window.clearTimeout(minuteurRef.current);
      }
    },
    [],
  );

  async function copier(evenement: MouseEvent<HTMLButtonElement>) {
    evenement.stopPropagation();
    try {
      await navigator.clipboard.writeText(valeur);
    } catch {
      // Contexte non sécurisé (HTTP) ou permission refusée : la copie échoue sans confirmation
      // visuelle, mais sans rejet de promesse non capturé ni exception qui casserait l'écran.
      return;
    }
    setCopie(true);
    if (minuteurRef.current !== null) {
      window.clearTimeout(minuteurRef.current);
    }
    minuteurRef.current = window.setTimeout(() => {
      setCopie(false);
      minuteurRef.current = null;
    }, DELAI_CONFIRMATION_MS);
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
      {copie ? (
        <Check aria-hidden className="h-4 w-4 text-statut-succes" />
      ) : (
        <Copy aria-hidden className="h-4 w-4" />
      )}
    </button>
  );
}
