import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { formaterQuantiteMillieme } from '../pieces/utils';
import type { EtatDisponibilitePiece } from './disponibilite-piece';

export interface ProprietesBadgeDisponibilitePiece {
  readonly etat: EtatDisponibilitePiece;
  readonly className?: string;
}

/**
 * Rendu des QUATRE issues de disponibilité d'un article du magasin (`disponibilite-piece.ts`,
 * dérivé de `StatutSuiviStockArticle`) — un composant DÉDIÉ plutôt qu'un `if` de plus à l'appelant :
 * « est-ce qu'on a la pièce ? » est LA question du comptoir (constat terrain), elle mérite un
 * rendu qui ne se ressemble jamais d'un état à l'autre (texte ET couleur distincts), jamais trois
 * variantes d'un même texte gris.
 *
 * Purement synchrone : la donnée (`statutSuivi`/`quantiteDisponibleMillieme`) arrive déjà résolue
 * avec le résultat de recherche ou de disponibilité qui l'a produite — ce composant ne fait
 * lui-même aucune requête, donc pas d'état chargement/erreur ici (voir l'appelant pour ceux-là).
 */
export function BadgeDisponibilitePiece({ etat, className }: ProprietesBadgeDisponibilitePiece) {
  const { t } = useTranslation('or');

  if (etat.type === 'nonSuiviNullePart') {
    return (
      <p className={cn('texte-libelle text-statut-attention', className)} role="status">
        {t('lignes.selecteurArticle.disponibilite.nonSuiviNullePart')}
      </p>
    );
  }

  if (etat.type === 'nonSuiviSurCeSite') {
    return (
      <p className={cn('texte-libelle text-statut-attention', className)} role="status">
        {t('lignes.selecteurArticle.disponibilite.nonSuiviSurCeSite')}
      </p>
    );
  }

  if (etat.type === 'aucune') {
    return (
      <p className={cn('texte-libelle text-destructive', className)} role="status">
        {t('lignes.selecteurArticle.disponibilite.aucune')}
      </p>
    );
  }

  return (
    <p className={cn('texte-libelle text-statut-succes', className)} role="status">
      {t('lignes.selecteurArticle.disponibilite.disponible', {
        n: formaterQuantiteMillieme(etat.quantiteMillieme),
      })}
    </p>
  );
}
