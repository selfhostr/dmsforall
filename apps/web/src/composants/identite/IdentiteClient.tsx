import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ClientResumeListe } from '@dfa/shared';

import { cn } from '@/lib/utils';

import { BadgeAttribut } from './BadgeAttribut';
import { BadgeStatutClient } from './BadgeStatutClient';

interface Props {
  readonly client: ClientResumeListe;
  /**
   * `ClientResume` ne porte pas l'information « a une note d'alerte » (RM-13/RM-36, elle vit sur
   * les notes de la fiche complète) — à passer explicitement par l'appelant qui la connaît déjà
   * (fiche client, contexte-atelier). `false`/omis : aucun badge d'alerte.
   */
  readonly alerte?: boolean;
  readonly className?: string;
  /**
   * Lot B (`docs/plan-refonte-navigation.md`) — rend le bloc identité cliquable (ex. en-tête d'OR
   * ou de dossier de vente, vers la fiche client). Omis : bloc statique STRICTEMENT INCHANGÉ,
   * comportement par défaut préservé pour tous les appelants existants (listes, sélecteurs) qui ne
   * doivent surtout pas devenir cliquables par accident. Quand fourni, le bloc se rend en vrai
   * `<button type="button">` — jamais un `<div onClick>` (guide d'accessibilité web du dépôt) —
   * avec `focus-visible` et une zone de clic élargie par le padding négatif ci-dessous.
   */
  readonly onClick?: () => void;
}

/**
 * Identité client — **une seule variante pour tout le produit** (invariant n°2,
 * docs/plan-etape-1-frontend.md §11) : nom affiché (calculé serveur, `nomAffiche`) + n° client,
 * badges alerte/bloqué intégrés. Le statut `actif` ne produit aucun badge (densité : un badge ne
 * s'affiche que s'il aide la décision) ; `inactif`/`bloque` s'affichent toujours.
 */
export function IdentiteClient({ client, alerte = false, className, onClick }: Props) {
  const { t } = useTranslation('clients');

  const contenu = (
    <>
      <span className="truncate texte-corps font-medium text-foreground">{client.nomAffiche}</span>
      <span className="texte-libelle">{client.numeroClient}</span>
      {client.statut !== 'actif' ? <BadgeStatutClient statut={client.statut} /> : null}
      {/* Simplification (audit refonte visuelle, `composants/identite/`) : reproduisait à la main
       *  exactement les classes que `BadgeAttribut` factorise déjà (border-input/bg-background/
       *  texte-libelle, voir son en-tête) — septième doublon que sa propre note de tête n'avait
       *  pas recensé. `accentue` (gras + `text-foreground`) reproduit fidèlement le
       *  `font-semibold text-foreground` déjà posé ici, rendu inchangé. */}
      {alerte ? (
        <BadgeAttribut
          icone={<TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />}
          accentue
        >
          {t('clients:alertes.alerte')}
        </BadgeAttribut>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          '-mx-1.5 -my-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-left transition-colors hover:text-primary anneau-focus',
          className,
        )}
      >
        {contenu}
      </button>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      {contenu}
    </div>
  );
}
