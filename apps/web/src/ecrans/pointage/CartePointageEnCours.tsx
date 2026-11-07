import { Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponsePointage, VehiculeResume } from '@dfa/shared';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhotosLigne } from '@/composants/photos/PhotosLigne';
import { formaterDureeLisible, useChronoPointage } from '@/hooks/pointage/temps-pointage';
import { formaterHeure } from '@/lib/formats';
import { cn } from '@/lib/utils';

import { VehiculeGrand } from './VehiculeGrand';

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
  /**
   * « Deux nombres, jamais un seul » : cumul déjà pointé AUJOURD'HUI sur cette MÊME cible, hors
   * segment en cours (voir `hooks/pointage/cumul-cible-jour.ts#calculerCumulSecondesCible` côté
   * appelant — RM-116, une pause puis une reprise sur la même ligne sont deux segments distincts).
   * `0`/`undefined` -> rien affiché (première visite du jour sur cette cible, un cumul nul ne se
   * distingue pas visuellement de son absence, donc jamais rendu).
   */
  readonly cumulAujourdhuiSecondes: number | undefined;
  /** BORNE : lecture à 1,5 m — état (« En cours »), numéro d'OR/cible et désignation du véhicule
   *  à 24 px (`text-2xl`), plaque au palier `xl`. Omis -> rendu inchangé (écran personnel). */
  readonly grand?: boolean;
  /** Véhicule de l'OR pointé, affiché en grand sur la borne (`grand`). `undefined` tant que le
   *  document OR n'est pas chargé, ou pour une activité indirecte (aucun véhicule). */
  readonly vehicule?: VehiculeResume;
}

/**
 * Le cœur de l'écran de pointage du technicien : le chrono qui défile (`useChronoPointage`,
 * rafraîchi chaque seconde) et les gestes possibles pendant un pointage `en_cours` — arrêter,
 * pause/reprise (RM-116 : JAMAIS un troisième état, seulement arrêter + redémarrer, orchestré par
 * l'écran appelant), et depuis le correctif #117 « Changer » (nouvelle cible SANS arrêter d'abord,
 * voir `onChanger` ci-dessus) — cette carte ne fait qu'exposer les boutons, jamais la mécanique.
 *
 * Cibles tactiles à 72 px MINIMUM (`min-h-[72px]`, texte large) — norme du projet pour cet écran :
 * atelier, mains parfois gantées, lu vite entre deux gestes, hardcodée ICI plutôt que dérivée de
 * `--densite-cible-tactile` (cette carte est partagée par `EcranPointageTechnicien`, qui ne porte
 * PAS la classe `.densite-tres-aeree`, et `EcranBornePointage`, qui la porte déjà — le pointage
 * exige ce plancher dans LES DEUX cas, indépendamment de la densité ambiante de l'écran appelant).
 *
 * Arrêter n'est PLUS `variant="destructive"` (rouge) : arrêter un pointage n'est ni dangereux ni
 * irréversible (une correction reste possible via l'encadrement) — c'est au contraire le geste le
 * plus répété de la journée. Contour neutre ici, le rouge restant réservé au réellement risqué.
 * Corollaire : « Pause » (comme « Reprendre ») est l'action PRIMAIRE pleine (`variant` par défaut).
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
  cumulAujourdhuiSecondes,
  grand = false,
  vehicule,
}: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const chrono = useChronoPointage(pointage.debutLe);

  return (
    // Bordure conservée (DESIGN.md « bordure structurelle uniquement ») : ce n'est pas un simple
    // groupe de contenu mais l'indicateur visuel d'un état LIVE (un pointage tourne, le chrono
    // défile) — le seul bloc de l'écran dont le comportement diffère réellement des autres cartes
    // statiques (Mes OR, Activités). Le contour de marque distingue ce statut « en cours » d'un
    // coup d'œil, en plus du chrono lui-même.
    <Card className="border-2 border-primary/40">
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('pointage:technicien.pointageEnCours.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 py-4">
          {/* Taille brute retirée (`text-5xl` était fixe, 48px partout) : `.texte-chiffre-geant`
              suit le palier "chiffre à distance" de DESIGN.md — 40px sur EcranPointageTechnicien
              (aucune classe .densite-*, repli aéré), 48px sur EcranBornePointage
              (.densite-tres-aeree, lecture à distance sur un mur d'atelier). */}
          <span className="texte-chiffre-geant tabular-nums" aria-live="off">
            {chrono.libelle}
          </span>
          {grand ? (
            <span className="inline-flex items-center gap-2 text-2xl font-semibold text-primary">
              <Timer aria-hidden="true" className="h-6 w-6" />
              {t('pointage:technicien.pointageEnCours.etat')}
            </span>
          ) : null}
          <span
            className={cn(
              grand ? 'text-center text-2xl font-semibold' : 'texte-corps text-muted-foreground',
            )}
          >
            {libelleCible}
          </span>
          {grand && vehicule ? <VehiculeGrand vehicule={vehicule} /> : null}
          <span
            className={cn(
              grand ? 'text-2xl text-muted-foreground' : 'texte-libelle text-muted-foreground',
            )}
          >
            {t('pointage:technicien.pointageEnCours.depuis', {
              heure: formaterHeure(pointage.debutLe),
            })}
          </span>
          {cumulAujourdhuiSecondes ? (
            <span className="texte-libelle text-muted-foreground">
              {t('pointage:technicien.pointageEnCours.cumulAujourdhui', {
                duree: formaterDureeLisible(cumulAujourdhuiSecondes),
              })}
            </span>
          ) : null}
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

        {pointage.ordreReparationId && pointage.ligneOrId ? (
          // Le technicien photographie le défaut sur la ligne qu'il est en train de traiter. Le
          // bouton ne s'affiche que si son rôle peut ajouter une photo : la borne (compte de
          // service) n'en a pas le droit et ne le voit donc jamais.
          <PhotosLigne
            orId={pointage.ordreReparationId}
            ligneId={pointage.ligneOrId}
            grand
            libelleBouton={t('pointage:technicien.boutons.photo')}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {onReprendre ? (
            <Button
              size="lg"
              className="min-h-[72px] texte-annexe"
              disabled={enTraitement}
              onClick={onReprendre}
            >
              {t('pointage:technicien.boutons.reprendre')}
            </Button>
          ) : null}
          {onPause ? (
            <Button
              size="lg"
              className="min-h-[72px] texte-annexe"
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
              className="min-h-[72px] texte-annexe"
              disabled={enTraitement}
              onClick={onChanger}
            >
              {t('pointage:technicien.boutons.changer')}
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="outline"
            className="min-h-[72px] texte-annexe"
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
