import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

/** « Personnalisé » : forme (pastille) + icône + mot — jamais la couleur seule (DESIGN.md). */
export function BadgePersonnalise() {
  const { t } = useTranslation('capacites');
  return (
    <Badge variant="outline">
      <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
      {t('editeur.personnalise')}
    </Badge>
  );
}
