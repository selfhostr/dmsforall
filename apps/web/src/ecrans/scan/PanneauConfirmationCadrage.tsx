import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { CadrePermis } from './CadrePermis';
import type { FractionsCadre } from './geometrieCadre';

interface Props {
  readonly urlApercu: string;
  readonly fractions: FractionsCadre;
  readonly onContinuer: () => void;
  readonly onPhotoEntiere: () => void;
}

/**
 * CONFIRMATION D'UN CADRAGE DÉTECTÉ AUTOMATIQUEMENT — n'apparaît QUE quand
 * `analyserQualitePhoto` a confié le recadrage à une vraie détection de bords
 * (`detecterBordsDocument.ts`, `cadrageDetecte: true`), jamais pour le repli sur le cadre
 * géométrique fixe : ce dernier reste, comme avant ce chantier, envoyé directement sans étape
 * intermédiaire (marge généreuse par construction, jamais de recours nécessaire). C'est
 * précisément l'inverse : une détection réelle peut se tromper et rogner le document — brief
 * explicite de @laupernoe (18.08.2026), « une détection ratée qui coupe la moitié du document sans
 * recours serait pire que pas de détection ». Cette étape est donc le RECOURS : elle montre
 * exactement ce qui serait envoyé et permet d'y renoncer avant tout envoi réseau.
 *
 * ICÔNE + MOT, JAMAIS LA SEULE COULEUR — même exigence que la bordure verte prévue pour la prise
 * de vue en direct (`CaptureLiveCadrage.tsx`) : `CheckCircle2` + un titre explicite portent le
 * signal, le cadre reste dans le même style neutre (`border-primary`, `CadrePermis`) que celui du
 * panneau de refus — délibéré : la couleur du panneau de refus (via `Alert variant="destructive"`,
 * lui-même icône + mot) suffit à distinguer les deux contextes, sans avoir besoin d'une palette de
 * statut supplémentaire ici (`--statut-*` reste réservé au statut d'OR/de ligne, voir index.css).
 *
 * DEUX ISSUES, MÊME PATRON QUE LE REFUS : action PRIMAIRE = accepter le cadrage détecté
 * (`onContinuer`, bouton plein `h-14`) ; contournement ATTEIGNABLE MAIS PAS MIS EN AVANT
 * (`onPhotoEntiere`, lien texte `h-11` — même discipline tactile que
 * `scan:refus.envoyerQuandMeme` dans `PanneauRefusPhoto.tsx`) pour repartir de la photo entière,
 * sans aucun recadrage, si la détection s'est trompée.
 */
export function PanneauConfirmationCadrage({
  urlApercu,
  fractions,
  onContinuer,
  onPhotoEntiere,
}: Props) {
  const { t } = useTranslation('scan');

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="relative overflow-hidden rounded-lg border">
        <img src={urlApercu} alt={t('scan:cadrage.apercuAlt')} className="block w-full" />
        <CadrePermis fractions={fractions} />
      </div>

      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
        <div>
          <p className="texte-corps font-medium">{t('scan:cadrage.titre')}</p>
          <p className="texte-libelle text-muted-foreground">{t('scan:cadrage.description')}</p>
        </div>
      </div>

      {/* h-14, action PRIMAIRE unique de cet écran — même doctrine que le bouton de capture et
          celui de reprise du panneau de refus. */}
      <Button type="button" className="h-14 w-full gap-2 texte-annexe" onClick={onContinuer}>
        {t('scan:cadrage.continuer')}
      </Button>

      <div className="flex flex-col items-center gap-1 pt-1 text-center">
        <button
          type="button"
          onClick={onPhotoEntiere}
          className="flex h-11 items-center px-2 texte-libelle text-muted-foreground underline underline-offset-2"
        >
          {t('scan:cadrage.photoEntiere')}
        </button>
      </div>
    </div>
  );
}
