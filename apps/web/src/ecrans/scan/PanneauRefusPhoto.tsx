import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { CadrePermis } from './CadrePermis';
import type { MotifRefusPhoto } from './analyserQualitePhoto';
import type { FractionsCadre } from './geometrieCadre';

interface Props {
  readonly urlApercu: string;
  readonly fractions: FractionsCadre;
  readonly motif: MotifRefusPhoto;
  readonly onReprendre: () => void;
  readonly onEnvoyerQuandMeme: () => void;
}

/**
 * REFUS EXPLICITE ET RÉESSAYABLE (brief du coordinateur) — la photo elle-même reste visible, avec
 * le cadre superposé à l'endroit exact où `reduireImagePourEnvoi` recadrerait (`fractions`, voir
 * `geometrieCadre.ts`) : l'utilisateur voit CE QUE le contrôle a jugé, pas seulement un message
 * abstrait. Raison en français simple (`motifs.*`, jamais un code technique), action PRIMAIRE
 * unique = reprendre (même bouton, même libellé que l'échec de lecture — `scan:actions.reessayer`,
 * doctrine : une action garde toujours le même nom).
 *
 * CONTOURNEMENT ATTEIGNABLE MAIS PAS MIS EN AVANT (décision de @laupernoe) : lien texte, pas un bouton
 * plein — mais cible tactile >= 44px (h-11) quand même, jamais un mini-lien injoignable au pouce.
 * L'avertissement (« lecture probablement incomplète ») est affiché AU-DESSUS du lien, jamais
 * après-coup : l'utilisateur le lit avant de décider, pas une fois l'action lancée.
 */
export function PanneauRefusPhoto({
  urlApercu,
  fractions,
  motif,
  onReprendre,
  onEnvoyerQuandMeme,
}: Props) {
  const { t } = useTranslation('scan');

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="relative overflow-hidden rounded-lg border">
        <img src={urlApercu} alt={t('scan:refus.apercuAlt')} className="block w-full" />
        <CadrePermis fractions={fractions} />
      </div>

      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{t('scan:refus.titre')}</AlertTitle>
        <AlertDescription>{t(`scan:refus.motifs.${motif}`)}</AlertDescription>
      </Alert>

      {/* h-14, action PRIMAIRE unique de cet écran — même doctrine que le bouton de capture. */}
      <Button type="button" className="h-14 w-full gap-2 texte-annexe" onClick={onReprendre}>
        {t('scan:actions.reessayer')}
      </Button>

      <div className="flex flex-col items-center gap-1 pt-1 text-center">
        <p className="texte-libelle text-muted-foreground">
          {t('scan:refus.avertissementEnvoiForce')}
        </p>
        <button
          type="button"
          onClick={onEnvoyerQuandMeme}
          className="flex h-11 items-center px-2 texte-libelle text-muted-foreground underline underline-offset-2"
        >
          {t('scan:refus.envoyerQuandMeme')}
        </button>
      </div>
    </div>
  );
}
