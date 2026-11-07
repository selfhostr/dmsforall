import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, Languages, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { type PreferenceDensite, useDensite } from '@/hooks/useDensite';
import { useLangue } from '@/hooks/useLangue';
import { cn } from '@/lib/utils';

type ChoixTheme = 'light' | 'dark' | 'system';

const SUIVANT: Readonly<Record<ChoixTheme, ChoixTheme>> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};
const ICONES = { light: Sun, dark: Moon, system: Monitor } as const;
const CLE_THEME = { light: 'clair', dark: 'sombre', system: 'systeme' } as const;
const CLE_PASSER = { light: 'passerClair', dark: 'passerSombre', system: 'passerSysteme' } as const;

const CELLULE =
  'min-h-9 flex-1 justify-center gap-1 rounded-md px-1 py-1 text-muted-foreground hover:text-foreground';

interface Props {
  /** Chemin de Réglages, `undefined` si le rôle n'y a pas accès (le bouton n'est alors pas rendu). */
  readonly cheminReglages: string | undefined;
}

/**
 * Une seule ligne de quatre petits contrôles, au-dessus de « Se déconnecter » : langue (sous-menu
 * compact), taille de l'interface (A / A), thème (un bouton qui montre le thème actuel et passe au
 * suivant) et Réglages. Chaque contrôle est un élément de menu Radix (clavier et focus gérés par
 * le menu) ; langue, taille et thème gardent le menu ouvert pour que le changement se voie tout de
 * suite. Monochrome : l'état actif se lit par le fond, le poids et le filet, jamais par la couleur.
 */
export function RangeeReglagesCompte({ cheminReglages }: Props) {
  const { t } = useTranslation(['navigation', 'commun']);
  const { langue, languesDisponibles, changerLangue } = useLangue();
  const { theme, setTheme } = useTheme();
  const { preference, definirPreference } = useDensite();

  const themeActuel: ChoixTheme = theme === 'light' || theme === 'dark' ? theme : 'system';
  const themeSuivant = SUIVANT[themeActuel];
  const IconeTheme = ICONES[themeActuel];
  const libelleTheme = `${t('navigation:theme.titre')} : ${t(`navigation:theme.${CLE_THEME[themeActuel]}`)} — ${t(`navigation:theme.${CLE_PASSER[themeSuivant]}`)}`;
  const libelleLangue = `${t('commun:langue.libelle')} : ${t(`commun:langues.${langue}`)}`;

  function tailleChoisie(cible: Exclude<PreferenceDensite, 'auto'>) {
    definirPreference(preference === cible ? 'auto' : cible);
  }

  return (
    <div
      role="group"
      aria-label={t('navigation:rangee.aria')}
      className="flex items-center gap-1 px-1 py-1"
    >
      <MenuPrimitive.Sub>
        <MenuPrimitive.SubTrigger asChild>
          <DropdownMenuItem
            aria-label={libelleLangue}
            title={libelleLangue}
            className={cn(CELLULE, 'texte-libelle font-semibold uppercase')}
          >
            <Languages className="h-4 w-4" aria-hidden="true" />
            {langue}
          </DropdownMenuItem>
        </MenuPrimitive.SubTrigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.SubContent
            sideOffset={4}
            className="z-50 min-w-[8rem] rounded-md border border-border bg-popover p-1 texte-corps text-popover-foreground shadow-md"
          >
            {languesDisponibles.map((code) => (
              <DropdownMenuItem
                key={code}
                lang={code}
                aria-current={langue === code ? 'true' : undefined}
                onSelect={() => changerLangue(code)}
              >
                <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                  {langue === code ? <Check className="h-4 w-4" /> : null}
                </span>
                {t(`commun:langues.${code}`)}
              </DropdownMenuItem>
            ))}
          </MenuPrimitive.SubContent>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Sub>

      <div role="group" aria-label={t('commun:densite.titre')} className="flex flex-1 gap-1">
        {(
          [
            { valeur: 'compacte', classe: 'text-sm' },
            { valeur: 'aeree', classe: 'text-xl' },
          ] as const
        ).map(({ valeur, classe }) => {
          const actif = preference === valeur;
          const libelle = `${t('commun:densite.titre')} : ${t(`commun:densite.${valeur}`)}${actif ? ` — ${t('commun:densite.revenirAuto')}` : ''}`;
          return (
            <DropdownMenuItem
              key={valeur}
              role="menuitemradio"
              aria-checked={actif}
              aria-label={libelle}
              title={libelle}
              onSelect={(evenement) => {
                evenement.preventDefault();
                tailleChoisie(valeur);
              }}
              className={cn(
                CELLULE,
                'min-w-0 border-b-2 border-transparent font-semibold leading-none',
                classe,
                actif && 'border-foreground bg-muted text-foreground',
              )}
            >
              <span aria-hidden="true">A</span>
            </DropdownMenuItem>
          );
        })}
      </div>

      <DropdownMenuItem
        aria-label={libelleTheme}
        title={libelleTheme}
        onSelect={(evenement) => {
          evenement.preventDefault();
          setTheme(themeSuivant);
        }}
        className={CELLULE}
      >
        <IconeTheme className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuItem>

      {cheminReglages !== undefined ? (
        <DropdownMenuItem asChild className={CELLULE}>
          <Link
            to={cheminReglages}
            aria-label={t('navigation:entrees.reglages')}
            title={t('navigation:entrees.reglages')}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
          </Link>
        </DropdownMenuItem>
      ) : null}
    </div>
  );
}
