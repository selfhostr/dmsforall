import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import {
  schemaCreationPrestation,
  TYPES_LIGNE_OR,
  type EntreeCreationPrestation,
  type ReponsePrestation,
  type TypeLigneOr,
} from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { useCreerPrestation } from '@/hooks/parametrage/useCreerPrestation';
import { useModifierPrestation } from '@/hooks/parametrage/useModifierPrestation';
import { ChampTempsCentiemes } from './ChampTempsCentiemes';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** `undefined` => création. */
  readonly prestation?: ReponsePrestation;
  /** Codes des taux horaires du catalogue (chargés par l'écran parent) — propose un select
   *  plutôt qu'une saisie libre : un code fautif ici resterait invisible jusqu'à un OR. */
  readonly codesTauxHoraires: readonly string[];
}

/** TVA suisse (CONTRIBUTING.md) — trois taux réels + l'exonération, jamais une saisie libre en pour
 *  mille : un garagiste ne doit jamais pouvoir taper un taux qui n'existe pas légalement. */
const TAUX_TVA_SUISSES = [81, 26, 38, 0] as const;

const VALEURS_VIDES: EntreeCreationPrestation = {
  code: '',
  designationFr: '',
  designationDe: null,
  designationIt: null,
  typeLigne: 'forfait',
  tempsBaremeCentiemes: null,
  tauxHoraireCode: null,
  tauxTvaPourmille: 81,
  prixCentimes: null,
};

function versValeursFormulaire(
  prestation: ReponsePrestation | undefined,
): EntreeCreationPrestation {
  if (!prestation) return VALEURS_VIDES;
  return {
    code: prestation.code,
    designationFr: prestation.designation.fr,
    designationDe: prestation.designation.de || null,
    designationIt: prestation.designation.it || null,
    typeLigne: prestation.typeLigne,
    tempsBaremeCentiemes: prestation.tempsBaremeCentiemes,
    tauxHoraireCode: prestation.tauxHoraireCode,
    tauxTvaPourmille: prestation.tauxTvaPourmille,
    prixCentimes: prestation.prixCentimes,
  };
}

const AUCUN = '__aucun__';

/**
 * Création/modification d'une prestation du catalogue (§7.9) — même patron que
 * `DialogueTauxHoraire` : un seul dialogue, `code` verrouillé en modification. Les prix sont
 * TVA COMPRISE (RF-40) : `prixCentimes` est ce que le garage annonce au comptoir, jamais un
 * montant hors taxe à recalculer.
 */
export function DialoguePrestation({
  ouvert,
  onOuvertChange,
  prestation,
  codesTauxHoraires,
}: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'validation', 'erreurs']);
  const estModification = prestation !== undefined;
  const creer = useCreerPrestation();
  const modifier = useModifierPrestation();
  const enCours = creer.isPending || modifier.isPending;
  const [actif, setActif] = useState(prestation?.actif ?? true);

  const form = useForm<z.input<typeof schemaCreationPrestation>, unknown, EntreeCreationPrestation>(
    {
      resolver: zodResolver(schemaCreationPrestation),
      defaultValues: versValeursFormulaire(prestation),
    },
  );

  useEffect(() => {
    if (!ouvert) return;
    form.reset(versValeursFormulaire(prestation));
    setActif(prestation?.actif ?? true);
  }, [ouvert, prestation]);

  const soumettre = form.handleSubmit((valeurs) => {
    if (estModification && prestation) {
      modifier.mutate(
        {
          id: prestation.id,
          entree: {
            designationFr: valeurs.designationFr,
            designationDe: valeurs.designationDe,
            designationIt: valeurs.designationIt,
            typeLigne: valeurs.typeLigne,
            tempsBaremeCentiemes: valeurs.tempsBaremeCentiemes,
            tauxHoraireCode: valeurs.tauxHoraireCode,
            tauxTvaPourmille: valeurs.tauxTvaPourmille,
            prixCentimes: valeurs.prixCentimes,
            actif,
          },
        },
        { onSuccess: () => onOuvertChange(false) },
      );
      return;
    }
    creer.mutate(valeurs, { onSuccess: () => onOuvertChange(false) });
  });

  const erreur = estModification ? modifier.error : creer.error;
  const estConflit = erreur instanceof ErreurApi && erreur.probleme.code === 'CONFLIT';

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {estModification
              ? t('parametrage:referentiels.prestations.modifier')
              : t('parametrage:referentiels.prestations.nouvelle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-code">
                {t('parametrage:referentiels.prestations.champs.code')}
              </Label>
              <Input
                id="pr-code"
                readOnly={estModification || enCours}
                aria-invalid={form.formState.errors.code ? true : undefined}
                aria-describedby={form.formState.errors.code ? 'pr-code-erreur' : undefined}
                {...form.register('code')}
              />
              {form.formState.errors.code ? (
                <p id="pr-code-erreur" className="texte-libelle text-destructive">
                  {t('validation:requis')}
                </p>
              ) : null}
              {estModification ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('parametrage:referentiels.prestations.codeVerrouille')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-type">
                {t('parametrage:referentiels.prestations.champs.typeLigne')}
              </Label>
              <Controller
                control={form.control}
                name="typeLigne"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(valeur) => field.onChange(valeur as TypeLigneOr)}
                    disabled={enCours}
                  >
                    <SelectTrigger
                      id="pr-type"
                      aria-label={t('parametrage:referentiels.prestations.champs.typeLigne')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES_LIGNE_OR.map((valeur) => (
                        <SelectItem key={valeur} value={valeur}>
                          {t(`parametrage:referentiels.prestations.typesLigne.${valeur}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {/* DESIGN.md « bordure structurelle » — conservée : `fieldset` regroupant trois VRAIS
              champs de saisie (désignation FR/DE/IT), le contour rend visible le groupe de
              contrôles qu'un `<legend>` seul ne délimiterait pas. */}
          <fieldset className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-3">
            <legend className="px-1 texte-libelle font-medium text-foreground">
              {t('parametrage:referentiels.prestations.champs.designation')}
            </legend>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-designation-fr">{t('commun:langues.fr')}</Label>
              <Input
                id="pr-designation-fr"
                readOnly={enCours}
                aria-invalid={form.formState.errors.designationFr ? true : undefined}
                aria-describedby={
                  form.formState.errors.designationFr ? 'pr-designation-fr-erreur' : undefined
                }
                {...form.register('designationFr')}
              />
              {form.formState.errors.designationFr ? (
                <p id="pr-designation-fr-erreur" className="texte-libelle text-destructive">
                  {t('validation:requis')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-designation-de">{t('commun:langues.de')}</Label>
              <Input
                id="pr-designation-de"
                readOnly={enCours}
                {...form.register('designationDe', {
                  setValueAs: (valeur: string) => (valeur === '' ? null : valeur),
                })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-designation-it">{t('commun:langues.it')}</Label>
              <Input
                id="pr-designation-it"
                readOnly={enCours}
                {...form.register('designationIt', {
                  setValueAs: (valeur: string) => (valeur === '' ? null : valeur),
                })}
              />
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={form.control}
              name="tempsBaremeCentiemes"
              render={({ field }) => (
                <ChampTempsCentiemes
                  id="pr-temps-bareme"
                  label={t('parametrage:referentiels.prestations.champs.tempsBareme')}
                  disabled={enCours}
                  valeurCentiemes={field.value ?? null}
                  onChangeCentiemes={field.onChange}
                />
              )}
            />
            <Controller
              control={form.control}
              name="prixCentimes"
              render={({ field }) => (
                <ChampMontant
                  id="pr-prix"
                  label={t('parametrage:referentiels.prestations.champs.prix')}
                  disabled={enCours}
                  valeurCentimes={field.value ?? null}
                  onChangeCentimes={field.onChange}
                />
              )}
            />
          </div>
          <p className="-mt-2 texte-libelle text-muted-foreground">
            {t('parametrage:referentiels.prestations.prixTvaComprise')}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-taux-horaire">
                {t('parametrage:referentiels.prestations.champs.tauxHoraireCode')}
              </Label>
              <Controller
                control={form.control}
                name="tauxHoraireCode"
                render={({ field }) => (
                  <Select
                    value={field.value ?? AUCUN}
                    onValueChange={(valeur) => field.onChange(valeur === AUCUN ? null : valeur)}
                    disabled={enCours}
                  >
                    <SelectTrigger
                      id="pr-taux-horaire"
                      aria-label={t('parametrage:referentiels.prestations.champs.tauxHoraireCode')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUCUN}>
                        {t('parametrage:referentiels.prestations.aucunTauxHoraire')}
                      </SelectItem>
                      {codesTauxHoraires.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-tva">
                {t('parametrage:referentiels.prestations.champs.tauxTva')}
              </Label>
              <Controller
                control={form.control}
                name="tauxTvaPourmille"
                render={({ field }) => (
                  <Select
                    value={String(field.value)}
                    onValueChange={(valeur) => field.onChange(Number(valeur))}
                    disabled={enCours}
                  >
                    <SelectTrigger
                      id="pr-tva"
                      aria-label={t('parametrage:referentiels.prestations.champs.tauxTva')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAUX_TVA_SUISSES.map((pourmille) => (
                        <SelectItem key={pourmille} value={String(pourmille)}>
                          {t(`parametrage:referentiels.prestations.tauxTvaLibelles.${pourmille}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {estModification ? (
            <label htmlFor="prestation-actif" className="flex items-center gap-2 texte-corps">
              <Checkbox
                id="prestation-actif"
                checked={actif}
                onCheckedChange={(coche) => setActif(coche === true)}
                disabled={enCours}
              />
              {t('parametrage:referentiels.prestations.champs.actif')}
            </label>
          ) : null}

          {erreur ? (
            <p className="texte-libelle text-destructive" role="alert">
              {estConflit
                ? t('parametrage:referentiels.prestations.erreurCodeExistant')
                : messageErreur(erreur, t)}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOuvertChange(false)}
              disabled={enCours}
            >
              {t('commun:actions.annuler')}
            </Button>
            <Button type="submit" disabled={enCours}>
              {enCours ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
