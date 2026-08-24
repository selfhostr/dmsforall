import * as TabsPrimitive from '@radix-ui/react-tabs';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Liste / Plan (issue #142) — bascule ORTHOGONALE à `BasculeVueStock` (vendeur/client, question de
 * CONFIDENTIALITÉ) : celle-ci ne change aucune donnée affichée, seulement sa MISE EN FORME (table
 * plate vs. regroupement par zone). Même patron d'implémentation que `BasculeVueStock` (Radix
 * `Tabs` directement, pas `components/ui/tabs.tsx` — voir la note de style de ce fichier), état
 * porté par `?affichage=` dans l'URL, jamais un état local : un lien partagé « regarde la zone
 * Devant » doit rouvrir la vue Plan, pas retomber sur la table par défaut.
 */
export type AffichageStock = 'liste' | 'plan';

export function lireAffichageStock(searchParams: URLSearchParams): AffichageStock {
  return searchParams.get('affichage') === 'plan' ? 'plan' : 'liste';
}

interface Props {
  readonly affichage: AffichageStock;
  readonly onChangeAffichage: (affichage: AffichageStock) => void;
}

export function BasculeAffichageStock({ affichage, onChangeAffichage }: Props) {
  const { t } = useTranslation('ventes');

  return (
    <TabsPrimitive.Root
      value={affichage}
      onValueChange={(valeur) => onChangeAffichage(valeur as AffichageStock)}
    >
      <TabsPrimitive.List
        aria-label={t('ventes:stock.liste.plan.groupeLabelBascule')}
        className="inline-flex items-stretch gap-1 rounded-md border bg-muted/40 p-1"
      >
        {(['liste', 'plan'] as const).map((valeur) => (
          <TabsPrimitive.Trigger
            key={valeur}
            value={valeur}
            className={cn(
              'flex h-9 items-center whitespace-nowrap rounded-sm px-3 texte-corps font-medium transition-colors',
              'anneau-focus',
              'text-muted-foreground hover:text-foreground',
              'data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-sm',
            )}
          >
            {t(`ventes:stock.liste.plan.affichage.${valeur}`)}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
