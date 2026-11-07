import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponsePretCourtoisie } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRendrePretCourtoisie } from '@/hooks/courtoisie/useCourtoisie';

interface Props {
  readonly pret: ReponsePretCourtoisie | null;
  readonly onFermer: () => void;
}

/** « Rendu » : le véhicule est revenu, kilométrage au retour facultatif. */
export function DialogueRetourPret({ pret, onFermer }: Props) {
  const { t } = useTranslation(['courtoisie', 'commun', 'erreurs']);
  const rendre = useRendrePretCourtoisie();
  const [km, setKm] = useState('');

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (!pret) return;
    rendre.mutate(
      { id: pret.id, entree: km.trim() === '' ? {} : { kmRetour: Number(km) } },
      { onSuccess: onFermer },
    );
  }

  return (
    <Dialog open={pret !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <DialogContent>
        <form onSubmit={soumettre} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('courtoisie:retour.titre')}</DialogTitle>
            <DialogDescription>
              {pret ? `${pret.vehiculeDesignation} · ${pret.clientNom}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="retour-km">{t('courtoisie:retour.kmRetour')}</Label>
            <Input
              id="retour-km"
              inputMode="numeric"
              value={km}
              onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))}
              placeholder={pret?.kmDepart != null ? String(pret.kmDepart) : ''}
            />
          </div>
          {rendre.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{messageErreur(rendre.error, t)}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('commun:actions.annuler')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={rendre.isPending}>
              {t('courtoisie:retour.confirmer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
