import { useTranslation } from 'react-i18next';

import type { ReponsePointage } from '@dfa/shared';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useChronoPointage } from '@/hooks/pointage/temps-pointage';
import { formaterHeure } from '@/lib/formats';

interface Props {
  readonly pointage: ReponsePointage;
  /** Calculé par l'écran appelant — voir `EcranPointageTechnicien` pour la résolution (cible
   *  choisie à l'instant du démarrage si connue, repli générique sinon : `ReponsePointage` ne
   *  porte que des identifiants, jamais un numéro d'OR ni une désignation de ligne). */
  readonly libelleCible: string;
  readonly onArreter: () => void;
  /** `undefined` -> pas de bouton pause (déjà sur une activité indirecte). */
  readonly onPause: (() => void) | undefined;
  /** `undefined` -> pas de bouton reprise (pas en pause, ou aucune cible précédente mémorisée). */
  readonly onReprendre: (() => void) | undefined;
  readonly enTraitement: boolean;
  readonly messageErreur: string | undefined;
}

/**
 * Le cœur de l'écran de pointage du technicien : le chrono qui défile (`useChronoPointage`,
 * rafraîchi chaque seconde) et les trois seuls gestes possibles pendant un pointage `en_cours`
 * (RM-116 : pause/reprise ne sont JAMAIS un troisième état, seulement arrêter + redémarrer,
 * orchestré par l'écran appelant — cette carte ne fait qu'exposer les boutons).
 *
 * Cibles tactiles généreuses (`h-16`+, texte large) — écran d'atelier, mains parfois gantées,
 * lu vite entre deux gestes.
 */
export function CartePointageEnCours({
  pointage,
  libelleCible,
  onArreter,
  onPause,
  onReprendre,
  enTraitement,
  messageErreur,
}: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const chrono = useChronoPointage(pointage.debutLe);

  return (
    <Card className="border-2 border-primary/40">
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('pointage:technicien.pointageEnCours.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 py-4">
          <span className="tabular-nums text-6xl font-bold tracking-tight" aria-live="off">
            {chrono.libelle}
          </span>
          <span className="texte-corps text-muted-foreground">{libelleCible}</span>
          <span className="texte-libelle text-muted-foreground">
            {t('pointage:technicien.pointageEnCours.depuis', {
              heure: formaterHeure(pointage.debutLe),
            })}
          </span>
        </div>

        {messageErreur ? (
          <Alert variant="destructive">
            <AlertDescription>{messageErreur}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {onReprendre ? (
            <Button
              size="lg"
              className="h-16 text-lg"
              disabled={enTraitement}
              onClick={onReprendre}
            >
              {t('pointage:technicien.boutons.reprendre')}
            </Button>
          ) : null}
          {onPause ? (
            <Button
              size="lg"
              variant="secondary"
              className="h-16 text-lg"
              disabled={enTraitement}
              onClick={onPause}
            >
              {t('pointage:technicien.boutons.pause')}
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="destructive"
            className="h-16 text-lg"
            disabled={enTraitement}
            onClick={onArreter}
          >
            {t('pointage:technicien.boutons.arreter')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
