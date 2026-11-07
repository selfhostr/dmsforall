import { useTranslation } from 'react-i18next';

import { type PreferenceDensite, useDensite } from '@/hooks/useDensite';

import { ControleSegmenteMenu, type OptionSegment } from './ControleSegmenteMenu';

const CLASSES: Readonly<Record<PreferenceDensite, string>> = {
  auto: 'text-sm',
  compacte: 'text-xs',
  aeree: 'text-base',
};
const VALEURS: readonly PreferenceDensite[] = ['auto', 'compacte', 'aeree'];

/**
 * Taille de l'interface (densité d'affichage) dans le menu du compte — contrôle segmenté, voir
 * `ControleSegmenteMenu`. Préférence de POSTE (navigateur, aucun appel API), `hooks/useDensite.ts`.
 */
export function SelecteurTailleMenu() {
  const { t } = useTranslation('commun');
  const { preference, definirPreference } = useDensite();
  const options: readonly OptionSegment<PreferenceDensite>[] = VALEURS.map((valeur) => ({
    valeur,
    libelleCourt: t(`commun:densite.court.${valeur}`),
    libelleComplet: t(`commun:densite.${valeur}`),
    classeTexte: CLASSES[valeur],
  }));

  return (
    <ControleSegmenteMenu
      idLibelle="libelle-taille-interface"
      libelle={t('commun:densite.titre')}
      options={options}
      valeur={preference}
      onChange={definirPreference}
    />
  );
}
