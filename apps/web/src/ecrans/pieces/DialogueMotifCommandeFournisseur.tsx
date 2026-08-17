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

import { messageErreurMutation } from './messages-erreur-mutation';

interface Props {
  readonly ouvert: boolean;
  readonly titre: string;
  readonly description: string;
  readonly libelleAction: string;
  readonly enCours: boolean;
  readonly erreur?: unknown;
  readonly onFermer: () => void;
  readonly onConfirmer: (motif: string) => void;
}

/**
 * Dialogue générique « motif obligatoire » — factorise `annuler` (commande entière) et
 * `annuler-reliquat` (par ligne) de `EcranFicheCommandeFournisseur` : les DEUX transitions
 * partagent `schemaMotif` (min. 3 caractères) côté contrat, même patron que
 * `DialogueLiberationReservation` (réservations). Un seul composant, paramétré par le texte,
 * plutôt que deux quasi-doublons.
 */
export function DialogueMotifCommandeFournisseur({
  ouvert,
  titre,
  description,
  libelleAction,
  enCours,
  erreur,
  onFermer,
  onConfirmer,
}: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'validation']);
  const [motif, setMotif] = useState('');

  useEffect(() => {
    if (ouvert) setMotif('');
  }, [ouvert]);

  const motifValide = motif.trim().length >= 3;

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && onFermer()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cmd-motif" requis>
            {t('pieces:commandes.lignes.motif')}
          </Label>
          <Input
            id="cmd-motif"
            required
            readOnly={enCours}
            value={motif}
            onChange={(evenement) => setMotif(evenement.target.value)}
            aria-invalid={motif.length > 0 && !motifValide ? true : undefined}
          />
          {motif.length > 0 && !motifValide ? (
            <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
          ) : null}
        </div>

        {erreur ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreurMutation(erreur, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFermer} disabled={enCours}>
            {t('commun:actions.annuler')}
          </Button>
          <Button
            type="button"
            disabled={enCours || !motifValide}
            onClick={() => onConfirmer(motif.trim())}
          >
            {enCours ? t('commun:chargement.enCours') : libelleAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
