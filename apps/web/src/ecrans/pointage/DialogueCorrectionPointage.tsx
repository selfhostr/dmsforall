import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { ReponsePointage } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCorrigerPointage } from '@/hooks/pointage/useCorrigerPointage';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly pointage: ReponsePointage | undefined;
  readonly onCorrige?: () => void;
}

interface ValeursFormulaireCorrection {
  /** `datetime-local` (`YYYY-MM-DDTHH:mm`, PAS `schemaHorodatage` ISO complet — c'est ce que le
   *  navigateur produit) : converti en ISO à la soumission, `versEntreeCorrection` ci-dessous. */
  readonly debutLe: string;
  readonly finLe: string;
  readonly motif: string;
}

function versDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  // `Date#toISOString()` rend toujours UTC (`Z`) ; `datetime-local` attend l'heure LOCALE sans
  // fuseau — on ôte les secondes/millisecondes/`Z` après conversion locale plutôt que de tronquer
  // l'ISO brut, qui resterait en UTC et afficherait une heure fausse au technicien.
  const date = new Date(iso);
  const decalage = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - decalage).toISOString().slice(0, 16);
}

function versValeursFormulaire(pointage: ReponsePointage | undefined): ValeursFormulaireCorrection {
  return {
    debutLe: versDatetimeLocal(pointage?.debutLe ?? null),
    finLe: versDatetimeLocal(pointage?.finLe ?? null),
    motif: '',
  };
}

/**
 * RM-94 : correction manuelle d'un pointage (heure de début/fin), réservée à l'encadrement
 * (`atelier.pointage.corriger_autrui`). Ce dialogue ne couvre QUE la correction d'horaire — pas la
 * réaffection de cible (ligne/OR/activité, RM-123 « réaffecter ») ni le classement en improductif,
 * que le même endpoint `POST /pointages/{id}/corriger` accepterait aussi (voir
 * `schemaCorrectionPointage`) : hors périmètre de cette première version, la réaffectation de
 * cible mériterait son propre écran (sélection d'une autre ligne/OR, même complexité que
 * `DialogueChoixCiblePointage`) plutôt qu'un champ de plus ici.
 *
 * `motif` est rendu OBLIGATOIRE côté formulaire (contrairement au schéma serveur, qui ne l'exige
 * QUE si un champ change réellement) : ce dialogue n'a par construction aucune autre raison d'être
 * ouvert qu'un changement à venir, autant demander la justification tout de suite plutôt que
 * découvrir `400 POINTAGE_MOTIF_REQUIS` après coup.
 */
export function DialogueCorrectionPointage({ ouvert, onOuvertChange, pointage, onCorrige }: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const corriger = useCorrigerPointage();

  const form = useForm<ValeursFormulaireCorrection>({
    defaultValues: versValeursFormulaire(pointage),
  });

  useEffect(() => {
    if (ouvert) form.reset(versValeursFormulaire(pointage));
  }, [ouvert, pointage]);

  const soumettre = form.handleSubmit((valeurs) => {
    if (!pointage) return;
    corriger.mutate(
      {
        id: pointage.id,
        entree: {
          debutLe: new Date(valeurs.debutLe).toISOString(),
          finLe: valeurs.finLe.trim() === '' ? undefined : new Date(valeurs.finLe).toISOString(),
          motif: valeurs.motif.trim(),
        },
        idempotencyKey: genererCleIdempotence(),
      },
      {
        onSuccess: () => {
          onOuvertChange(false);
          onCorrige?.();
        },
      },
    );
  });

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pointage:correction.titre')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correction-debut">{t('pointage:correction.debut')}</Label>
              <Input
                id="correction-debut"
                type="datetime-local"
                {...form.register('debutLe', { required: true })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correction-fin">{t('pointage:correction.fin')}</Label>
              <Input id="correction-fin" type="datetime-local" {...form.register('finLe')} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="correction-motif">{t('pointage:correction.motif')}</Label>
            <Textarea
              id="correction-motif"
              placeholder={t('pointage:correction.motifPlaceholder')}
              aria-invalid={form.formState.errors.motif ? true : undefined}
              {...form.register('motif', {
                required: true,
                validate: (valeur) => valeur.trim().length > 0,
              })}
            />
            {form.formState.errors.motif ? (
              <p className="texte-libelle text-destructive">
                {t('pointage:correction.motifRequis')}
              </p>
            ) : null}
          </div>

          {corriger.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{messageErreur(corriger.error, t)}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOuvertChange(false)}>
              {t('pointage:correction.annuler')}
            </Button>
            <Button type="submit" disabled={corriger.isPending}>
              {t('pointage:correction.enregistrer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
