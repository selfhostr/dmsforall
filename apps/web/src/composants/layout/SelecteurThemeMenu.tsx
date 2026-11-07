import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

import { ControleSegmenteMenu, type OptionSegment } from './ControleSegmenteMenu';

type ChoixTheme = 'light' | 'dark' | 'system';

/**
 * Thème clair / sombre / système dans le menu du compte (`next-themes`, `<ThemeProvider>` dans
 * `App.tsx`, persistance `localStorage`). Remplace l'ancienne bascule à deux états du bandeau
 * haut : « système » est le point de départ réel (`defaultTheme="system"`), il doit pouvoir être
 * retrouvé. `theme` indéfini (avant montage) vaut « système ».
 */
export function SelecteurThemeMenu() {
  const { t } = useTranslation('navigation');
  const { theme, setTheme } = useTheme();
  const options: readonly OptionSegment<ChoixTheme>[] = [
    {
      valeur: 'light',
      libelleCourt: t('navigation:theme.clair'),
      libelleComplet: t('navigation:theme.passerClair'),
      icone: Sun,
    },
    {
      valeur: 'dark',
      libelleCourt: t('navigation:theme.sombre'),
      libelleComplet: t('navigation:theme.passerSombre'),
      icone: Moon,
    },
    {
      valeur: 'system',
      libelleCourt: t('navigation:theme.systeme'),
      libelleComplet: t('navigation:theme.passerSysteme'),
      icone: Monitor,
    },
  ];
  const actuel: ChoixTheme = theme === 'light' || theme === 'dark' ? theme : 'system';

  return (
    <ControleSegmenteMenu
      idLibelle="libelle-theme-interface"
      libelle={t('navigation:theme.titre')}
      options={options}
      valeur={actuel}
      onChange={setTheme}
    />
  );
}
