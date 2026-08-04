import { AlertTriangle, Clock3, Eye, ShieldAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponseTravailReporte, UrgenceTravail } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatVide } from '@/composants/commun/EtatVide';
import { formaterDate, formaterKilometrage, formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

export interface ProprietesListeTravauxReportes {
  readonly travaux: readonly ReponseTravailReporte[];
  readonly className?: string;
}

// Forme + mot, jamais un token `--statut-*` : l'urgence d'un travail reporté est un attribut
// métier, pas un statut d'OR/ligne (seule famille à qui ce budget couleur est réservé — voir
// composants/identite/BadgeStatutClient.tsx et docs/design-comptoir.md §2). Seul `urgent`
// s'accentue (texte gras), sur le modèle `accentue` de BadgeStatutClient.
const CONFIG_URGENCE: Record<
  UrgenceTravail,
  { readonly icone: LucideIcon; readonly cle: string; readonly accentue: boolean }
> = {
  urgent: { icone: AlertTriangle, cle: 'urgent', accentue: true },
  a_faire: { icone: Clock3, cle: 'aFaire', accentue: false },
  a_surveiller: { icone: Eye, cle: 'aSurveiller', accentue: false },
};

/**
 * RM-73 : chaque ligne affiche la date du constat, le kilométrage D'ALORS et le montant estimé
 * DE L'ÉPOQUE — jamais un montant recalculé au tarif courant, jamais le kilométrage actuel du
 * véhicule. `montantEstimeCentimes` absent (rôle sans droit aux montants, filtrage serveur) ->
 * la ligne ne montre simplement pas de montant, elle n'affiche jamais 0.-.
 */
export function ListeTravauxReportes({ travaux, className }: ProprietesListeTravauxReportes) {
  const { t } = useTranslation('vehicules');

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('travauxReportes.titre')}</CardTitle>
      </CardHeader>
      <CardContent>
        {travaux.length === 0 ? (
          <EtatVide titre={t('travauxReportes.titre')} description={t('vide.travauxReportes')} />
        ) : (
          <ul className="flex flex-col divide-y">
            {travaux.map((travail) => {
              const urgence = CONFIG_URGENCE[travail.urgence];
              const IconeUrgence = urgence.icone;
              return (
                <li key={travail.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 texte-libelle font-medium',
                      urgence.accentue ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <IconeUrgence aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    {t(`travauxReportes.urgences.${urgence.cle}`)}
                  </span>
                  {travail.securite ? (
                    <ShieldAlert aria-hidden className="h-4 w-4 shrink-0 text-foreground" />
                  ) : null}
                  <p className="flex-1 texte-corps font-medium">{travail.designation}</p>
                  <p className="texte-libelle text-muted-foreground">
                    {formaterDate(travail.constateLe)}
                    {travail.kilometrageAlors !== null
                      ? ` · ${formaterKilometrage(travail.kilometrageAlors, 'km')}`
                      : ''}
                  </p>
                  {travail.montantEstimeCentimes != null ? (
                    <p className="texte-donnee-proeminente font-semibold">
                      {formaterMontant(travail.montantEstimeCentimes)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
