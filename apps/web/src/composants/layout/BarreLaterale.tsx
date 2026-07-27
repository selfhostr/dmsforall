import { Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

interface Props {
  readonly className?: string;
}

/** Un seul lien à l'étape 0 (Accueil) — aucun élément grisé « à venir » : mieux vaut une
 *  navigation courte et honnête qu'une liste de promesses non tenues. */
export function BarreLaterale({ className }: Props) {
  const { t } = useTranslation('navigation');

  return (
    <nav aria-label={t('navigation:principale.aria')} className={cn('flex flex-col gap-1 p-3', className)}>
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
            isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
          )
        }
      >
        <Home className="h-4 w-4" aria-hidden="true" />
        {t('navigation:liens.accueil')}
      </NavLink>
    </nav>
  );
}
