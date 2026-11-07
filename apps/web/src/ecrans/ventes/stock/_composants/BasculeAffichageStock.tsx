import { useTranslation } from 'react-i18next';

import { Segments } from '@/composants/commun/Segments';

/**
 * Liste / Plan (issue #142) : change seulement la MISE EN FORME (table plate vs. regroupement par
 * zone), jamais les données. État porté par `?affichage=` dans l'URL : un lien partagé « regarde la
 * zone Devant » rouvre la vue Plan. `@base-ui/react/tabs` via `Segments` : Tabs n'est pas un
 * composant à portail, la frontière Radix/Base UI de CONTRIBUTING.md ne s'y applique pas. Aucun
 * panneau n'est monté, donc Base UI omet `aria-controls` (WCAG 4.1.2).
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
    <Segments
      valeur={affichage}
      onChange={onChangeAffichage}
      ariaLabel={t('ventes:stock.liste.plan.groupeLabelBascule')}
      options={(['liste', 'plan'] as const).map((valeur) => ({
        valeur,
        libelle: t(`ventes:stock.liste.plan.affichage.${valeur}`),
      }))}
    />
  );
}
