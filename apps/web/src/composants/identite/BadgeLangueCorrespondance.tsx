import { useTranslation } from 'react-i18next';

import type { Langue } from '@dfa/shared';

import { cn } from '@/lib/utils';

/**
 * Drapeau **et** mot (RM-02) : la langue de correspondance détermine la langue des documents
 * imprimés (P-23), une confusion ici a un effet client direct — le drapeau seul ne suffit jamais.
 * Convention suisse habituelle (indépendante de la nationalité du client) : un drapeau par langue
 * officielle, pas par pays d'origine. Mapping exhaustif : ajouter une valeur à `LANGUES` fait
 * échouer `tsc`.
 */
const DRAPEAU_PAR_LANGUE: Readonly<Record<Langue, string>> = {
  fr: '🇫🇷',
  de: '🇩🇪',
  it: '🇮🇹',
};

interface Props {
  readonly langue: Langue;
  readonly className?: string;
}

export function BadgeLangueCorrespondance({ langue, className }: Props) {
  const { t } = useTranslation('commun');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 texte-libelle font-medium text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden>{DRAPEAU_PAR_LANGUE[langue]}</span>
      {t(`commun:langues.${langue}`)}
    </span>
  );
}
