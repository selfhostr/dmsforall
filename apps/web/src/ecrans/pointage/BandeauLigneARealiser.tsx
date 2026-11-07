import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  /** Cible qui vient d'être arrêtée (« OR-2026-4 — Vidange »). */
  readonly libelle: string;
  /** `true` une fois la ligne marquée réalisée : le bandeau ne garde que la confirmation. */
  readonly fait: boolean;
  readonly enCours: boolean;
  readonly messageErreur: string | undefined;
  readonly onMarquer: () => void;
  readonly onPlusTard: () => void;
}

/**
 * Juste après « Arrêter » sur une LIGNE : le mécanicien marque cette ligne réalisée en UN geste
 * (`POST .../lignes/{id}/marquer-realisee`). Arrêter le pointage laisse volontairement la ligne
 * `en_cours` (RM-118) — ce bandeau n'y change rien, il ne fait que proposer la transition
 * suivante, que le mécanicien peut refuser (« Pas maintenant »).
 */
export function BandeauLigneARealiser({
  libelle,
  fait,
  enCours,
  messageErreur,
  onMarquer,
  onPlusTard,
}: Props) {
  const { t } = useTranslation('pointage');

  if (fait) {
    return (
      <Alert>
        <CircleCheck aria-hidden="true" className="h-4 w-4" />
        <AlertDescription>{t('technicien.ligneARealiser.ok')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('technicien.ligneARealiser.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="texte-corps text-muted-foreground">{libelle}</p>
        {messageErreur ? (
          <Alert variant="destructive">
            <AlertDescription>{messageErreur}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            className="min-h-[72px] texte-annexe"
            disabled={enCours}
            onClick={onMarquer}
          >
            {t('technicien.ligneARealiser.bouton')}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="min-h-[72px] texte-annexe"
            disabled={enCours}
            onClick={onPlusTard}
          >
            {t('technicien.ligneARealiser.plusTard')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
