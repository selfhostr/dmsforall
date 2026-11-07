import { useTranslation } from 'react-i18next';

import { Segments } from '@/composants/commun/Segments';

/**
 * Liste / Plan (issue #142) — bascule ORTHOGONALE à `BasculeVueStock` (vendeur/client, question de
 * CONFIDENTIALITÉ) : celle-ci ne change aucune donnée affichée, seulement sa MISE EN FORME (table
 * plate vs. regroupement par zone). Même patron d'implémentation que `BasculeVueStock`
 * (`@base-ui/react/tabs` directement, pas `components/ui/tabs.tsx` — voir la note de style de ce
 * fichier), état porté par `?affichage=` dans l'URL, jamais un état local : un lien partagé
 * « regarde la zone Devant » doit rouvrir la vue Plan, pas retomber sur la table par défaut.
 *
 * `@base-ui/react/tabs` plutôt que `@radix-ui/react-tabs` (chantier d'unification inter-écrans,
 * 25.08.2026, même motif que `BasculeVueStock`/`EcranListeFactures.tsx`/`components/ui/tabs.tsx`) :
 * Tabs n'est pas un composant à portail/superposition, la frontière Radix/Base UI de CONTRIBUTING.md ne
 * s'y applique pas. WCAG 4.1.2 (`aria-controls` de référence brisée) : ces onglets FILTRENT
 * l'affichage de la même liste, ils n'ouvrent jamais de panneau dédié (aucun `TabsPrimitive.Panel`
 * n'est jamais rendu) — Base UI omet `aria-controls` quand aucun panneau n'est monté (voir
 * `BasculeVueStock.tsx` pour le détail vérifié dans le code source), vérifié ici aussi dans
 * `BasculeAffichageStock.spec.tsx`.
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
