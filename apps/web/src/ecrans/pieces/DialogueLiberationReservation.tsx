import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { useLibererReservation } from '@/hooks/pieces/useTransitionsReservation';

import { messageErreurMutation } from './messages-erreur-mutation';

interface Props {
  readonly reservationId: string | null;
  readonly onFerme: () => void;
}

/** `POST /reservations/{id}/liberer` (RP-23, 3e cas) — motif OBLIGATOIRE (`schemaMotif`, min. 3
 *  caractères) : le geste manuel n'est pas anodin, contrairement à `satisfaire`. */
export function DialogueLiberationReservation({ reservationId, onFerme }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'validation']);
  const liberer = useLibererReservation();
  const [motif, setMotif] = useState('');

  useEffect(() => {
    if (reservationId) setMotif('');
  }, [reservationId]);

  const motifValide = motif.trim().length >= 3;

  function soumettre() {
    if (!reservationId || !motifValide) return;
    liberer.mutate({ id: reservationId, entree: { motif: motif.trim() } }, { onSuccess: onFerme });
  }

  return (
    <Dialog open={reservationId !== null} onOpenChange={(ouvert) => !ouvert && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pieces:reservations.liberation.titre')}</DialogTitle>
          <DialogDescription>{t('pieces:reservations.liberation.description')}</DialogDescription>
        </DialogHeader>

        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resa-motif" requis>
            {t('pieces:reservations.liberation.champMotif')}
          </Label>
          <Input
            id="resa-motif"
            required
            readOnly={liberer.isPending}
            value={motif}
            onChange={(evenement) => setMotif(evenement.target.value)}
            aria-invalid={motif.length > 0 && !motifValide ? true : undefined}
          />
          {motif.length > 0 && !motifValide ? (
            <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
          ) : null}
        </div>

        {liberer.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreurMutation(liberer.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFerme} disabled={liberer.isPending}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={liberer.isPending || !motifValide} onClick={soumettre}>
            {liberer.isPending
              ? t('commun:chargement.enCours')
              : t('pieces:reservations.actions.liberer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
