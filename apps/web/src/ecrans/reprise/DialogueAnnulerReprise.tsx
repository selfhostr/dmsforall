import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { useAnnulerDossierReprise } from '@/hooks/reprise/useAnnulerDossierReprise';

interface Props {
  readonly dossierId: string;
}

/**
 * Annulation — geste volontaire, motif requis (`schemaMotif`, 3-500 caractères). Superposition
 * (`Dialog`) : reste sur Radix/shadcn existant, EXCEPTION du dépôt jamais contournée (coss réservé
 * aux composants feuille).
 */
export function DialogueAnnulerReprise({ dossierId }: Props) {
  const { t } = useTranslation('reprise');
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState('');
  const idMotif = useId();
  const annuler = useAnnulerDossierReprise(dossierId);

  const motifValide = motif.trim().length >= 3;

  function confirmer() {
    if (!motifValide) return;
    annuler.mutate(
      { motif: motif.trim() },
      {
        onSuccess: () => {
          setOuvert(false);
          setMotif('');
        },
      },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={setOuvert}>
      <DialogTrigger asChild>
        <Button variant="ghost">{t('reprise:annulation.bouton')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reprise:annulation.titre')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">{t('reprise:annulation.description')}</p>
        <div className="flex flex-col gap-champ">
          <label htmlFor={idMotif} className="texte-libelle font-medium">
            {t('reprise:annulation.motif.libelle')}
          </label>
          <Textarea
            id={idMotif}
            value={motif}
            onChange={(evenement) => setMotif(evenement.target.value)}
            aria-describedby={`${idMotif}-aide`}
          />
          <p id={`${idMotif}-aide`} className="text-sm text-muted-foreground">
            {t('reprise:annulation.motif.aide')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOuvert(false)}>
            {t('reprise:annulation.renoncer')}
          </Button>
          <Button
            variant="destructive"
            onClick={confirmer}
            disabled={!motifValide}
            enChargement={annuler.isPending}
          >
            {t('reprise:annulation.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
