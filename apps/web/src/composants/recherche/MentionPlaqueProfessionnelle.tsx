import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

/** Plaque professionnelle (U) — exemptée de la contrainte d'unicité, doit se signaler pour ne
 *  pas laisser croire à une collision de plaque normale. */
export function MentionPlaqueProfessionnelle() {
  const { t } = useTranslation('recherche');

  return (
    <Badge variant="outline" className="gap-1">
      <Building2 aria-hidden className="h-3 w-3" />
      {t('details.plaqueProfessionnelle')}
    </Badge>
  );
}
