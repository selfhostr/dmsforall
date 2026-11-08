import { ChevronRight, Languages, Monitor, Moon, Sun, Type, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { estPreferenceDensite, useDensite } from '@/hooks/useDensite';
import { useLangueProfil } from '@/hooks/useLangueProfil';

type ChoixTheme = 'light' | 'dark' | 'system';
const CLE_THEME = { light: 'clair', dark: 'sombre', system: 'systeme' } as const;
const ICONES_THEME: Readonly<Record<ChoixTheme, LucideIcon>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

function SousMenu({
  Icone,
  libelle,
  valeur,
  children,
}: {
  readonly Icone: LucideIcon;
  readonly libelle: string;
  readonly valeur: string;
  readonly children: React.ReactNode;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger aria-label={`${libelle} : ${valeur}`}>
        <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{libelle}</span>
        <span className="ml-auto truncate text-muted-foreground">{valeur}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Trois préférences du compte, chacune sur une ligne « libellé — valeur actuelle » qui ouvre un
 * sous-menu de choix (un seul sous-menu ouvert à la fois, clavier géré par Radix). Le choix se lit
 * sur la ligne même, sans ouvrir.
 */
export function PreferencesMenuCompte() {
  const { t } = useTranslation(['navigation', 'commun']);
  const { langue, languesDisponibles, changerLangue } = useLangueProfil();
  const { theme, setTheme } = useTheme();
  const { preference, definirPreference } = useDensite();

  const themeActuel: ChoixTheme = theme === 'light' || theme === 'dark' ? theme : 'system';

  return (
    <>
      <SousMenu
        Icone={Languages}
        libelle={t('commun:langue.libelle')}
        valeur={t(`commun:langues.${langue}`)}
      >
        <DropdownMenuRadioGroup
          value={langue}
          onValueChange={(code) => {
            const choisie = languesDisponibles.find((l) => l === code);
            if (choisie !== undefined) changerLangue(choisie);
          }}
        >
          {languesDisponibles.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {t(`commun:langues.${code}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </SousMenu>

      <SousMenu
        Icone={Type}
        libelle={t('navigation:taille.titre')}
        valeur={t(`navigation:taille.${preference}`)}
      >
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(valeur) => {
            if (estPreferenceDensite(valeur)) definirPreference(valeur);
          }}
        >
          {(['auto', 'compacte', 'aeree'] as const).map((valeur) => (
            <DropdownMenuRadioItem key={valeur} value={valeur}>
              {t(`navigation:taille.${valeur}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </SousMenu>

      <SousMenu
        Icone={ICONES_THEME[themeActuel]}
        libelle={t('navigation:theme.titre')}
        valeur={t(`navigation:theme.${CLE_THEME[themeActuel]}`)}
      >
        <DropdownMenuRadioGroup
          value={themeActuel}
          onValueChange={(valeur) => {
            if (valeur === 'light' || valeur === 'dark' || valeur === 'system') setTheme(valeur);
          }}
        >
          {(['light', 'dark', 'system'] as const).map((valeur) => (
            <DropdownMenuRadioItem key={valeur} value={valeur}>
              {t(`navigation:theme.${CLE_THEME[valeur]}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </SousMenu>
    </>
  );
}
