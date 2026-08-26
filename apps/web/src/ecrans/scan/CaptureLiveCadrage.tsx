import { Camera, CheckCircle2, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { detecterBordsDepuisSource } from './detecterBordsDocument';
import {
  DUREE_STABILITE_MS,
  ETAT_STABILITE_INITIAL,
  calculerEtatStabilite,
  type EtatStabiliteCadrage,
} from './machineStabiliteCadrage';

/** Cadence d'analyse du flux vidéo — brief de @laupernoe : « analyser chaque image d'un flux vidéo sur un
 *  téléphone chauffe et vide la batterie ». 2/s (500 ms) est délibérément BIEN plus lent qu'une
 *  boucle `requestAnimationFrame` (typiquement 30-60/s) : largement suffisant pour juger un cadrage
 *  qui ne bouge qu'à l'échelle de la main, à une fraction du coût CPU. NON MESURÉ sur téléphone réel
 *  dans cet environnement — voir le rapport de livraison. */
const CADENCE_ANALYSE_MS = 500;

interface Props {
  readonly onCapture: (fichier: File) => void;
  /** Appelé UNE FOIS si l'accès caméra échoue pour quelque raison que ce soit (permission refusée,
   *  caméra absente/occupée, contexte finalement non éligible) — jamais un message affiché ici,
   *  voir la doc de tête. Au parent (`EcranScan.tsx`) de basculer sur la capture native. */
  readonly onIndisponible: () => void;
}

/**
 * PRISE DE VUE EN DIRECT — préparée pour l'instant où le site servira en HTTPS (voir
 * `disponibiliteCaptureLive.ts`, seul point de bascule), INERTE tant que l'origine n'est pas
 * sécurisée : `EcranScan.tsx` ne monte ce composant que si `estCaptureLiveDisponible()` répond
 * `true`. NON VÉRIFIÉE EN CONDITIONS RÉELLES dans cet environnement (aucun téléphone, aucun
 * contexte sécurisé disponible ici) — voir le rapport de livraison pour ce qui reste à confirmer
 * en test terrain.
 *
 * QUATRE POINTS DURS DU BRIEF, un mécanisme par point :
 *  1. COÛT PROCESSEUR — cadence réduite (`CADENCE_ANALYSE_MS`), analyse sur une image réduite
 *     (`detecterBordsDepuisSource`, MÊME algorithme que la photo fixe, voir sa doc), et la boucle
 *     s'arrête ENTIÈREMENT (`document.visibilitychange`) dès que l'onglet n'est plus visible — pas
 *     seulement ralentie.
 *  2. STABILITÉ AVANT DÉCLENCHEMENT — `machineStabiliteCadrage.ts` (machine PURE, testée
 *     séparément) exige un cadrage bon EN CONTINU pendant `DUREE_STABILITE_MS`, jamais au premier
 *     cadrage correct ; une barre de progression VISIBLE (`etatStabilite.progressionMs`) montre le
 *     compte à rebours, un `role="status"` porte le texte annonçant l'imminence.
 *  3. JAMAIS LA SEULE COULEUR — la bordure change de couleur (voir plus bas) MAIS le statut est
 *     TOUJOURS répété en icône + mot (`CheckCircle2`/`Search` + `scan:captureLive.*`).
 *  4. DÉCLENCHEMENT MANUEL TOUJOURS ATTEIGNABLE — le bouton `h-14` en bas ignore complètement
 *     l'état de la détection automatique, capture immédiatement sur simple appui.
 *
 * DESIGN.md « mode sombre par jetons uniquement » — la bordure/le remplissage « cadrage bon »
 * utilisaient la teinte Tailwind `emerald` codée en dur (fixe dans les deux thèmes, hors mesure de
 * contraste). Corrigé en réutilisant `--statut-succes` : les six jetons `--statut-*` sont réservés
 * au STATUT D'UN BADGE D'OR/DE LIGNE (rien à voir ici, ceci n'est pas un badge), mais rien
 * n'interdit de réutiliser leur VALEUR DE COULEUR pour une autre affordance « état bon/prêt » —
 * même réutilisation déjà en place pour l'urgence d'échéance de `BadgeEcheanceSuivi.tsx`
 * (`ecrans/ventes/suivi/`, dimension « urgence », pas un statut d'OR non plus). Reste la seule
 * indication : icône + mot toujours répétés (voir plus bas), la couleur n'est jamais seule à
 * porter le sens.
 */
export function CaptureLiveCadrage({ onCapture, onIndisponible }: Props) {
  const { t } = useTranslation('scan');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const debutStabiliteRef = useRef<number | null>(null);
  // Verrou : empêche un second déclenchement automatique pendant le court instant où `onCapture` a
  // été appelé mais où le composant n'a pas encore été démonté par le parent (changement d'étape).
  const declencheRef = useRef(false);

  const [cadrageBon, setCadrageBon] = useState(false);
  const [etatStabilite, setEtatStabilite] = useState<EtatStabiliteCadrage>(ETAT_STABILITE_INITIAL);

  // Acquisition du flux caméra — UNE FOIS au montage. Piste TOUJOURS arrêtée au démontage (annulé,
  // ou permission accordée après démontage) : jamais une caméra qui reste allumée en arrière-plan.
  useEffect(() => {
    let annule = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((flux) => {
        if (annule) {
          flux.getTracks().forEach((piste) => piste.stop());
          return;
        }
        streamRef.current = flux;
        if (videoRef.current) videoRef.current.srcObject = flux;
      })
      .catch(() => {
        // Refus de permission, caméra absente/occupée, contrainte `facingMode` non satisfaite...
        // toutes les causes possibles reçoivent le MÊME traitement : repli silencieux, jamais un
        // message d'erreur (voir la doc de tête).
        onIndisponible();
      });

    return () => {
      annule = true;
      streamRef.current?.getTracks().forEach((piste) => piste.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onIndisponible` est stable côté appelant (setter d'état), volontairement absent des dépendances pour ne PAS relancer l'acquisition caméra à chaque rendu.
  }, []);

  function capturer() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    const canevas = document.createElement('canvas');
    canevas.width = video.videoWidth;
    canevas.height = video.videoHeight;
    const contexte = canevas.getContext('2d');
    if (!contexte) return;
    contexte.drawImage(video, 0, 0);
    canevas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], 'permis-capture-directe.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }

  // Boucle d'analyse — cadence fixe, jamais liée au rythme de rendu vidéo. Suspendue ENTIÈREMENT
  // (pas seulement ralentie) dès que l'onglet n'est plus visible.
  useEffect(() => {
    let intervalle: ReturnType<typeof setInterval> | null = null;

    function analyser() {
      const video = videoRef.current;
      if (!video || video.readyState < video.HAVE_CURRENT_DATA) return;

      const detection = detecterBordsDepuisSource(video, video.videoWidth, video.videoHeight);
      const bon = detection !== null;
      setCadrageBon(bon);

      const { etat, debutStabiliteMs } = calculerEtatStabilite(
        bon,
        performance.now(),
        debutStabiliteRef.current,
      );
      debutStabiliteRef.current = debutStabiliteMs;
      setEtatStabilite(etat);

      if (etat.declenche && !declencheRef.current) {
        declencheRef.current = true;
        capturer();
      } else if (!etat.stable) {
        declencheRef.current = false; // cadrage reperdu : un futur palier de stabilité doit pouvoir redéclencher
      }
    }

    function demarrer() {
      if (intervalle) return;
      intervalle = setInterval(analyser, CADENCE_ANALYSE_MS);
    }
    function arreter() {
      if (!intervalle) return;
      clearInterval(intervalle);
      intervalle = null;
    }
    function surChangementVisibilite() {
      if (document.visibilityState === 'hidden') arreter();
      else demarrer();
    }

    demarrer();
    document.addEventListener('visibilitychange', surChangementVisibilite);
    return () => {
      arreter();
      document.removeEventListener('visibilitychange', surChangementVisibilite);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `capturer` recrée un canevas à chaque rendu par conception (aucune dépendance externe mutable) ; l'inclure redémarrerait l'intervalle à chaque rendu.
  }, []);

  const progressionPourcent = Math.round((etatStabilite.progressionMs / DUREE_STABILITE_MS) * 100);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border-4 transition-colors',
          cadrageBon ? 'border-statut-succes' : 'border-muted',
        )}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-label={t('scan:captureLive.apercuCameraAlt')}
          className="block w-full"
        />
        {etatStabilite.stable ? (
          <div className="absolute inset-x-0 bottom-0 bg-background/80 p-2" aria-hidden="true">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-statut-succes transition-[width]"
                style={{ width: `${progressionPourcent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Statut en ICÔNE + MOT — jamais la seule couleur de la bordure, voir la doc de tête. */}
      <p role="status" className="flex items-center justify-center gap-2 texte-libelle">
        {cadrageBon ? (
          <>
            <CheckCircle2 className="h-4 w-4 shrink-0 text-statut-succes" aria-hidden="true" />
            {etatStabilite.stable
              ? t('scan:captureLive.captureAutomatiqueImminente')
              : t('scan:captureLive.cadrageBon')}
          </>
        ) : (
          <>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('scan:captureLive.recherche')}
          </>
        )}
      </p>

      {/* Déclenchement MANUEL, toujours atteignable — indépendant de tout ce qui précède, ne touche
          jamais `declencheRef` (réservé à l'anti-double-déclenchement AUTOMATIQUE). */}
      <Button type="button" className="h-14 w-full gap-2 texte-annexe" onClick={capturer}>
        <Camera className="h-5 w-5" aria-hidden="true" />
        {t('scan:captureLive.declencherManuel')}
      </Button>
    </div>
  );
}
