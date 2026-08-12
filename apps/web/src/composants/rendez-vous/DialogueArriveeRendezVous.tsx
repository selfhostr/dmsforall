import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntreeActionArriveeRendezVous } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  readonly ouvert: boolean;
  readonly onOpenChange: (ouvert: boolean) => void;
  readonly onConfirmer: (entree: EntreeActionArriveeRendezVous) => void;
  readonly enCours?: boolean;
  readonly erreur?: string | null;
}

/**
 * Le véhicule est arrivé — réutilise le geste déjà construit sur l'OR (kilométrage d'entrée,
 * signature différée, `PanneauActionsOr.tsx`) plutôt que de le refaire : « le réceptionniste ne
 * ressaisit rien de ce qu'il a déjà dit au téléphone » (conception, § lien avec l'OR) — ce dialogue
 * ne redemande que ce que le rendez-vous ne connaît pas encore (kilométrage, signature).
 */
export function DialogueArriveeRendezVous({
  ouvert,
  onOpenChange,
  onConfirmer,
  enCours = false,
  erreur = null,
}: Props) {
  const { t } = useTranslation(['planning', 'or', 'commun']);
  const [kilometrage, setKilometrage] = useState<number | null>(null);
  const [signatureDifferee, setSignatureDifferee] = useState(false);
  const [motifDifferee, setMotifDifferee] = useState('');
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    setKilometrage(null);
    setSignatureDifferee(false);
    setMotifDifferee('');
    setErreurValidation(null);
  }, [ouvert]);

  function gererConfirmer() {
    if (kilometrage === null) {
      setErreurValidation(t('or:actions.kilometrageEntree'));
      return;
    }
    if (signatureDifferee && motifDifferee.trim() === '') {
      setErreurValidation(t('or:actions.motifSignatureDifferee'));
      return;
    }
    setErreurValidation(null);
    onConfirmer({
      kilometrageEntree: kilometrage,
      unite: 'km',
      signatureDifferee,
      motifDifferee: motifDifferee.trim() === '' ? undefined : motifDifferee.trim(),
    });
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planning:dialogueArrivee.titre')}</DialogTitle>
        </DialogHeader>

        {erreur ? (
          <p role="alert" className="texte-corps text-destructive">
            {erreur}
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <ChampKilometrage
            valeur={kilometrage}
            onChangeValeur={setKilometrage}
            unite="km"
            label={t('or:actions.kilometrageEntree')}
            obligatoire
          />
          <label
            htmlFor="rdv-arrivee-signature-differee"
            className="flex items-center gap-2 texte-corps"
          >
            <Checkbox
              id="rdv-arrivee-signature-differee"
              checked={signatureDifferee}
              onCheckedChange={(coche) => setSignatureDifferee(coche === true)}
            />
            {t('or:actions.signatureDifferee')}
          </label>
          {signatureDifferee ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rdv-arrivee-motif-differee">
                {t('or:actions.motifSignatureDifferee')}
              </Label>
              <Textarea
                id="rdv-arrivee-motif-differee"
                value={motifDifferee}
                onChange={(evenement) => setMotifDifferee(evenement.target.value)}
              />
            </div>
          ) : null}
          {erreurValidation ? (
            <p className="texte-libelle text-destructive">{erreurValidation}</p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('commun:actions.annuler')}</Button>
          </DialogClose>
          <Button disabled={enCours} onClick={gererConfirmer}>
            {t('planning:dialogueArrivee.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
