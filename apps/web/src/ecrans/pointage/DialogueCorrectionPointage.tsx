import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { ReponsePointage } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatetimeInput } from '@/components/ui/datetime-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { useCorrigerPointage } from '@/hooks/pointage/useCorrigerPointage';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly pointage: ReponsePointage | undefined;
  readonly onCorrige?: () => void;
}

interface ValeursFormulaireCorrection {
  /** ISO (`aaaa-mm-jjThh:mm:ss.sssZ`), ou `undefined` si vide — contrat de `DatetimeInput`
   *  (`components/ui/datetime-input.tsx`), jamais une chaîne `datetime-local` du navigateur.
   *  Issue #153 : un `<input type="datetime-local">` natif suit le format du NAVIGATEUR (constaté
   *  MM/JJ/AAAA + AM/PM en anglais US, seul endroit du produit hors du format suisse jj.mm.aaaa)
   *  — même défaut, même correctif que l'issue #89 (`FormulaireNouvelOrdreReparation.tsx`,
   *  `restitutionPromiseLe`). `DatetimeInput` affiche/saisit en jj.mm.aaaa HH:MM et rend
   *  directement un ISO déjà correctement converti (`instantSuisseVersUtc`, fuseau Europe/Zurich
   *  explicite) : aucune reconversion à la soumission, voir `soumettre` ci-dessous. */
  readonly debutLe: string | undefined;
  readonly finLe: string | undefined;
  readonly motif: string;
}

function versValeursFormulaire(pointage: ReponsePointage | undefined): ValeursFormulaireCorrection {
  return {
    debutLe: pointage?.debutLe ?? undefined,
    finLe: pointage?.finLe ?? undefined,
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
    if (!pointage || !valeurs.debutLe) return;
    corriger.mutate(
      {
        id: pointage.id,
        entree: {
          // Déjà des ISO valides ici — `DatetimeInput.onChange` (`components/ui/datetime-input.tsx`)
          // les convertit lui-même en heure SUISSE explicite (`instantSuisseVersUtc`, fuseau
          // Europe/Zurich) avant de les remonter. Repasser par `new Date(...).toISOString()`
          // réintroduirait le décalage de fuseau que ce composant existe pour éliminer (voir sa
          // docstring, et `FormulaireNouvelOrdreReparation.tsx` pour le même correctif, issue #89).
          debutLe: valeurs.debutLe,
          finLe: valeurs.finLe,
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
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('pointage:correction.titre')}
      pied={
        <>
          <Button type="button" variant="outline" onClick={() => onOuvertChange(false)}>
            {t('pointage:correction.annuler')}
          </Button>
          <Button type="submit" form="formulaire-correction-pointage" disabled={corriger.isPending}>
            {t('pointage:correction.enregistrer')}
          </Button>
        </>
      }
    >
      <form
        id="formulaire-correction-pointage"
        onSubmit={soumettre}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="correction-debut">{t('pointage:correction.debut')}</Label>
            <Controller
              control={form.control}
              name="debutLe"
              rules={{ required: true }}
              render={({ field }) => (
                <DatetimeInput
                  id="correction-debut"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  erreur={
                    form.formState.errors.debutLe ? t('pointage:correction.debutRequis') : undefined
                  }
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="correction-fin">{t('pointage:correction.fin')}</Label>
            <Controller
              control={form.control}
              name="finLe"
              render={({ field }) => (
                <DatetimeInput
                  id="correction-fin"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correction-motif">{t('pointage:correction.motif')}</Label>
          <Textarea
            id="correction-motif"
            placeholder={t('pointage:correction.motifPlaceholder')}
            aria-invalid={form.formState.errors.motif ? true : undefined}
            aria-describedby={form.formState.errors.motif ? 'correction-motif-erreur' : undefined}
            {...form.register('motif', {
              required: true,
              validate: (valeur) => valeur.trim().length > 0,
            })}
          />
          {form.formState.errors.motif ? (
            <p id="correction-motif-erreur" className="texte-libelle text-destructive">
              {t('pointage:correction.motifRequis')}
            </p>
          ) : null}
        </div>

        {corriger.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{messageErreur(corriger.error, t)}</AlertDescription>
          </Alert>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
