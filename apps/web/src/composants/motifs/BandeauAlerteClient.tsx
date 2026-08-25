import { Ban, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface NoteAlerte {
  readonly id: string;
  readonly texte: string;
}

interface Props {
  /** `client.statut === 'bloque'` (RM-08, impayés). */
  readonly bloque?: boolean;
  /** Notes de nature `alerte` (RM-13/RM-36) — `ReponseClientNote[]` filtrées côté appelant, qui
   *  connaît déjà la fiche complète (ce bandeau ne fait pas d'appel réseau). */
  readonly alertes?: readonly NoteAlerte[];
  readonly className?: string;
}

/**
 * Bandeau d'alerte client — patron « encart d'alertes » (docs/design-comptoir.md §6), sticky en
 * tête de fiche. Un seul encart par nature d'alerte, jamais une pile de bannières redondantes.
 * Couleur : `--statut-danger` pour un client bloqué (empêche une action), `--statut-attention`
 * pour une alerte informative — la SEULE exception documentée à la réserve du budget couleur aux
 * statuts d'OR/de ligne (§6 du document comptoir).
 */
export function BandeauAlerteClient({ bloque = false, alertes = [], className }: Props) {
  const { t } = useTranslation('clients');

  if (!bloque && alertes.length === 0) {
    return null;
  }

  return (
    <div className={cn('sticky top-0 z-10 flex flex-col gap-groupe bg-background', className)}>
      {bloque ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-statut-danger bg-statut-danger-fond p-carte"
        >
          <Ban aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-danger" />
          <p className="flex-1 texte-corps font-medium text-foreground">
            {t('clients:alertes.bloque')}
          </p>
        </div>
      ) : null}
      {alertes.map((alerte) => (
        <div
          key={alerte.id}
          role="alert"
          className="flex items-start gap-3 rounded-md border border-statut-attention bg-statut-attention-fond p-carte"
        >
          <TriangleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-attention" />
          <div className="flex-1 texte-corps">
            <p className="texte-libelle">{t('clients:alertes.alerte')}</p>
            <p className="font-medium text-foreground">{alerte.texte}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
