import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useLangue } from '@/hooks/useLangue';

/** Choix de la langue d'interface À L'INTÉRIEUR du menu du compte (en-tête / pied de barre
 *  latérale). Rendu directement dans un `DropdownMenuContent` : trois `DropdownMenuItem` (Radix,
 *  clavier et focus gérés par le menu) — aucune superposition ajoutée. Le choix passe par
 *  `useLangue().changerLangue`, qui persiste en localStorage (`dfa.langue`) et met à jour
 *  `<html lang>` ; le libellé de chaque langue reste dans sa propre langue (« Deutsch »). */
export function SelecteurLangueMenu() {
  const { t } = useTranslation('commun');
  const { langue, languesDisponibles, changerLangue } = useLangue();

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="font-normal text-muted-foreground">
        {t('commun:langue.libelle')}
      </DropdownMenuLabel>
      {languesDisponibles.map((code) => (
        <DropdownMenuItem
          key={code}
          onSelect={() => changerLangue(code)}
          aria-current={langue === code ? 'true' : undefined}
          lang={code}
        >
          <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
            {langue === code ? <Check className="h-4 w-4" /> : null}
          </span>
          {t(`commun:langues.${code}`)}
        </DropdownMenuItem>
      ))}
    </>
  );
}
