import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { useImprimerOr } from '@/hooks/atelier/useImprimerOr';

interface Props {
  readonly orId: string;
}

/**
 * Imprimer la feuille d'atelier (`GET /ordres-reparation/{orId}/pdf`) — geste de CONSULTATION,
 * même droit que la lecture de l'OR (`atelier.or.lire`, arbitrage figé pour ce lot). Contrairement
 * aux transitions de `PanneauActionsOr`, ce bouton ne dépend JAMAIS de `or.actionsDisponibles` ni
 * d'un droit supplémentaire : si l'utilisateur voit la fiche, il peut imprimer, quel que soit le
 * statut de l'OR — d'où un composant séparé, rendu à côté de `PanneauActionsOr` sans emprunter sa
 * logique de disponibilité.
 *
 * `enChargement` (prop native de `Button`, jamais un indicateur maison) garde le libellé visible
 * STABLE pendant l'impression — un texte qui change de longueur sous le doigt sur une tablette
 * d'atelier est le défaut que cette prop existe pour éviter (voir son commentaire dans
 * `components/ui/button.tsx`). L'état « impression en cours » est annoncé aux lecteurs d'écran
 * via une région `role="status"` invisible plutôt que par un changement de libellé — même patron
 * que `PaveNumerique.tsx`/`ComboboxAccessible.tsx`.
 */
export function BoutonImprimerOr({ orId }: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const impression = useImprimerOr(orId);

  // `window.open()` DOIT rester ici, synchrone dans le gestionnaire `onClick` — jamais déplacé
  // dans `mutationFn` du hook (voir son commentaire d'en-tête) : c'est la seule position qui
  // préserve le rattachement au geste utilisateur pour tous les navigateurs, Safari compris.
  function declencherImpression() {
    impression.mutate(window.open());
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        enChargement={impression.isPending}
        icone={<Printer aria-hidden className="h-4 w-4" />}
        onClick={declencherImpression}
      >
        {t('or:actions.imprimer')}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {impression.isPending ? t('or:impression.enCours') : ''}
      </span>
      {impression.isError ? (
        <p role="alert" className="texte-libelle text-destructive">
          {t('or:impression.erreur', { message: messageErreur(impression.error, t) })}
        </p>
      ) : null}
    </div>
  );
}
