import { useTranslation } from 'react-i18next';

import { AideContextuelle } from '@/composants/AideContextuelle';
import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTravauxReportesVehicule } from '@/ecrans/vehicules/useTravauxReportesVehicule';
import { useReprendreTravailDansOr } from '@/hooks/vehicules/useReprendreTravailDansOr';

interface Props {
  readonly orId: string;
  readonly vehiculeId: string;
}

/**
 * À l'ouverture d'un OR : les travaux que ce véhicule attendait (reportés lors d'une visite
 * précédente), repris en un clic sur cet OR. Invisible quand il n'y en a pas — rien à décider, rien
 * à afficher. Un échec de chargement ne bloque pas l'OR : message discret avec nouvel essai.
 */
export function PanneauTravauxReportesOr({ orId, vehiculeId }: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs']);
  const requete = useTravauxReportesVehicule(vehiculeId);
  const reprise = useReprendreTravailDansOr(vehiculeId);

  if (requete.isError) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 pt-6">
          <p role="alert" className="texte-corps text-destructive">
            {messageErreur(requete.error, t)}
          </p>
          <Button type="button" variant="outline" onClick={() => void requete.refetch()}>
            {t('commun:actions.reessayer')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const ouverts = (requete.data ?? []).filter((travail) => travail.statut === 'ouvert');
  if (requete.isPending || ouverts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="texte-titre-section">{t('or:travauxReportes.titre')}</CardTitle>
          <AideContextuelle
            sujet={t('or:travauxReportes.titre')}
            texte={t('aide:or.travauxReportes')}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="texte-corps text-muted-foreground">
          {t('or:travauxReportes.description', { count: ouverts.length })}
        </p>
        <ul className="flex flex-col divide-y">
          {ouverts.map((travail) => (
            <li key={travail.id} className="flex items-center justify-between gap-3 py-2">
              <span className="texte-corps font-medium text-foreground">{travail.designation}</span>
              <Button
                type="button"
                variant="outline"
                disabled={reprise.isPending}
                onClick={() => reprise.mutate({ travail, orId })}
              >
                {t('or:travauxReportes.reprendre')}
                <span className="sr-only"> — {travail.designation}</span>
              </Button>
            </li>
          ))}
        </ul>
        {reprise.isError ? (
          <p role="alert" className="texte-libelle text-destructive">
            {messageErreur(reprise.error, t)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
