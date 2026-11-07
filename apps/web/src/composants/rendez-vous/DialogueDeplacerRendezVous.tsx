import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaModificationRendezVous,
  type EntreeModificationRendezVous,
  type MomentRendezVous,
} from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MOMENTS: readonly MomentRendezVous[] = ['matin', 'apres_midi', 'toute_journee'];

interface Props {
  readonly ouvert: boolean;
  readonly onOpenChange: (ouvert: boolean) => void;
  readonly dateActuelle: string;
  readonly momentActuel: MomentRendezVous;
  readonly onConfirmer: (entree: EntreeModificationRendezVous) => void;
  readonly enCours?: boolean;
  /** Message d'échec DÉJÀ TRADUIT — la saisie reste en place. */
  readonly erreur?: string | null;
}

/** Déplacer un rendez-vous encore confirmé : nouvelle date et nouveau moment. Le client, le
 *  véhicule et le motif ne changent pas (pour cela : annuler et recréer). */
export function DialogueDeplacerRendezVous({
  ouvert,
  onOpenChange,
  dateActuelle,
  momentActuel,
  onConfirmer,
  enCours = false,
  erreur = null,
}: Props) {
  const { t } = useTranslation(['planning', 'commun', 'validation']);
  const [dateLe, setDateLe] = useState(dateActuelle);
  const [moment, setMoment] = useState<MomentRendezVous>(momentActuel);
  const [erreurDate, setErreurDate] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setDateLe(dateActuelle);
    setMoment(momentActuel);
    setErreurDate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- piloté par `ouvert` seul.
  }, [ouvert]);

  function confirmer() {
    const resultat = schemaModificationRendezVous.safeParse({ dateLe, moment });
    if (!resultat.success || dateLe === '') {
      setErreurDate(true);
      return;
    }
    setErreurDate(false);
    onConfirmer(resultat.data);
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planning:deplacer.titre')}</DialogTitle>
        </DialogHeader>
        {erreur ? (
          <p role="alert" className="texte-corps text-destructive">
            {erreur}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-groupe">
          <div className="flex flex-col gap-champ">
            <Label htmlFor="rdv-deplacer-date">{t('planning:deplacer.nouvelleDate')}</Label>
            <DateInput
              id="rdv-deplacer-date"
              value={dateLe || null}
              onChange={(valeur) => setDateLe(valeur ?? '')}
            />
            {erreurDate ? (
              <p className="texte-petit text-destructive">{t('validation:requis')}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-champ">
            <Label htmlFor="rdv-deplacer-moment">{t('planning:champs.moment')}</Label>
            <Select
              value={moment}
              onValueChange={(valeur) => setMoment(valeur as MomentRendezVous)}
            >
              <SelectTrigger id="rdv-deplacer-moment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOMENTS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`planning:moments.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('commun:actions.annuler')}
            </Button>
          </DialogClose>
          <Button type="button" disabled={enCours} onClick={confirmer}>
            {t('planning:deplacer.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
