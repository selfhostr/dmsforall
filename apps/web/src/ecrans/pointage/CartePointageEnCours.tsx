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
  /**
   * Correctif #117 : révèle le même sélecteur de cible (« Mes OR », « Toutes les OR ouvertes »,
   * activités indirectes) que l'écran propose déjà quand AUCUN pointage n'est en cours — mais SANS
   * exiger d'arrêter d'abord. Choisir une nouvelle cible ici déclenche un SEUL appel `POST
   * /pointages` : le serveur referme lui-même l'ancien pointage en cascade (RM-89/90,
   * `calculerClotureChevauchement`), la durée déjà écoulée n'est jamais perdue — voir
   * `demarrerEtMemoriser`/`demarrerEtSuivre` dans l'écran appelant, qui capture et affiche
   * l'avertissement `POINTAGE_CLOTURE_AUTOMATIQUE` renvoyé par cette clôture automatique
   * (prop `avertissement` ci-dessous). `undefined` -> pas de bouton (rôle sans droit de pointer,
   * voir `peutDemarrerPointage` côté appelant — même garde que les tuiles « Mes OR »/activités). */
  readonly onChanger: (() => void) | undefined;
  readonly enTraitement: boolean;
  readonly messageErreur: string | undefined;
  /** Avertissement NON bloquant à afficher au-dessus du message d'erreur (variante `avertissement`
   *  de `Alert`, jamais `destructive` : le geste a réussi, ce n'est qu'une information — typiquement
   *  `POINTAGE_CLOTURE_AUTOMATIQUE` après un « Changer » qui referme un pointage précédent encore
   *  ouvert). `undefined` -> rien à signaler. */
  readonly avertissement: string | undefined;
}

/**
 * Le cœur de l'écran de pointage du technicien : le chrono qui défile (`useChronoPointage`,
 * rafraîchi chaque seconde) et les gestes possibles pendant un pointage `en_cours` — arrêter,
 * pause/reprise (RM-116 : JAMAIS un troisième état, seulement arrêter + redémarrer, orchestré par
 * l'écran appelant), et depuis le correctif #117 « Changer » (nouvelle cible SANS arrêter d'abord,
 * voir `onChanger` ci-dessus) — cette carte ne fait qu'exposer les boutons, jamais la mécanique.
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
  onChanger,
  enTraitement,
  messageErreur,
  avertissement,
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

        {avertissement ? (
          <Alert variant="avertissement">
            <AlertDescription>{avertissement}</AlertDescription>
          </Alert>
        ) : null}

        {messageErreur ? (
          <Alert variant="destructive">
            <AlertDescription>{messageErreur}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          {onChanger ? (
            <Button
              size="lg"
              variant="outline"
              className="h-16 text-lg"
              disabled={enTraitement}
              onClick={onChanger}
            >
              {t('pointage:technicien.boutons.changer')}
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
