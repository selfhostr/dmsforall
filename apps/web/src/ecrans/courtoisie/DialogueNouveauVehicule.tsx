import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { schemaCreationVehiculeCourtoisie } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreerVehiculeCourtoisie } from '@/hooks/courtoisie/useCourtoisie';

interface Props {
  readonly ouvert: boolean;
  readonly onFermer: () => void;
}

/** Ajouter une voiture au parc de courtoisie (chef d'atelier, direction). */
export function DialogueNouveauVehicule({ ouvert, onFermer }: Props) {
  const { t } = useTranslation(['courtoisie', 'commun', 'erreurs']);
  const creer = useCreerVehiculeCourtoisie();
  const [designation, setDesignation] = useState('');
  const [plaque, setPlaque] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    const resultat = schemaCreationVehiculeCourtoisie.safeParse({
      designation,
      plaque: plaque.trim() === '' ? undefined : plaque,
    });
    if (!resultat.success) {
      setErreur(t('courtoisie:parc.erreurValidation'));
      return;
    }
    setErreur(null);
    creer.mutate(resultat.data, {
      onSuccess: () => {
        setDesignation('');
        setPlaque('');
        onFermer();
      },
    });
  }

  return (
    <Dialog open={ouvert} onOpenChange={(o) => (o ? undefined : onFermer())}>
      <DialogContent>
        <form onSubmit={soumettre} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('courtoisie:parc.ajouterTitre')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="parc-designation">{t('courtoisie:parc.designation')}</Label>
            <Input
              id="parc-designation"
              required
              maxLength={200}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder={t('courtoisie:parc.designationPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="parc-plaque">{t('courtoisie:parc.plaque')}</Label>
            <Input
              id="parc-plaque"
              maxLength={200}
              value={plaque}
              onChange={(e) => setPlaque(e.target.value)}
            />
          </div>
          {erreur || creer.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{erreur ?? messageErreur(creer.error, t)}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('commun:actions.annuler')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={creer.isPending}>
              {t('courtoisie:parc.ajouter')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
