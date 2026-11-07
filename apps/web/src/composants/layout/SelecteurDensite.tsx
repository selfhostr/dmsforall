import { ALargeSmall } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type PreferenceDensite, useDensite } from '@/hooks/useDensite';

const CHOIX: readonly PreferenceDensite[] = ['auto', 'compacte', 'aeree'];

/**
 * Choix de la densité d'affichage (texte et lignes plus grands pour la tablette ou pour des yeux
 * fatigués). Placé dans la barre haute, à côté de la bascule de thème : même nature de réglage
 * (préférence de POSTE, stockée dans le navigateur, aucun appel API). Par défaut « Automatique » :
 * `aérée` sur tablette ou fenêtre étroite, `compacte` à la souris sur grand écran.
 */
export function SelecteurDensite() {
  const { t } = useTranslation('commun');
  const { preference, definirPreference } = useDensite();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('commun:densite.titre')}
          title={t('commun:densite.titre')}
        >
          <ALargeSmall className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('commun:densite.titre')}</DropdownMenuLabel>
        {CHOIX.map((choix) => (
          <DropdownMenuCheckboxItem
            key={choix}
            checked={preference === choix}
            onCheckedChange={() => definirPreference(choix)}
          >
            {t(`commun:densite.${choix}`)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 texte-libelle text-muted-foreground">
          {t('commun:densite.aide')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
