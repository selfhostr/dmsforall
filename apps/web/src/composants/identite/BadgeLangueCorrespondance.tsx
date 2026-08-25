import { useTranslation } from 'react-i18next';

import type { Langue } from '@dfa/shared';

import { BadgeAttribut } from './BadgeAttribut';

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
    <BadgeAttribut
      icone={<span aria-hidden>{DRAPEAU_PAR_LANGUE[langue]}</span>}
      className={className}
    >
      {t(`commun:langues.${langue}`)}
    </BadgeAttribut>
  );
}
