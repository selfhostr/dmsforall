import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { FiltresDocumentsVente } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type TriFactures = FiltresDocumentsVente['tri'];

/** Clé i18n de chaque tri (`facturation:liste.tri.options.*`) — `:` interdit dans une clé. */
const CLE_TRI: Record<TriFactures, string> = {
  'dateDocument:desc': 'dateDesc',
  'dateDocument:asc': 'dateAsc',
  'numeroSequence:desc': 'numeroDesc',
  'numeroSequence:asc': 'numeroAsc',
  'soldeCentimes:desc': 'soldeDesc',
  'relanceLe:asc': 'relanceAsc',
};

interface Props {
  readonly valeur: TriFactures;
  readonly options: readonly TriFactures[];
  readonly onChange: (tri: TriFactures) => void;
}

/** Tri de la liste : un bouton icône (cible 44 px) qui ouvre un menu Radix. Libellé accessible et
 *  infobulle identiques ; le tri actif est coché. */
export function MenuTriFactures({ valeur, options, onChange }: Props) {
  const { t } = useTranslation('facturation');
  const libelle = t('facturation:liste.tri.label');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={libelle} title={libelle}>
          <ArrowUpDown aria-hidden className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((tri) => (
          <DropdownMenuCheckboxItem
            key={tri}
            checked={tri === valeur}
            onSelect={() => onChange(tri)}
          >
            {t(`facturation:liste.tri.options.${CLE_TRI[tri]}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
