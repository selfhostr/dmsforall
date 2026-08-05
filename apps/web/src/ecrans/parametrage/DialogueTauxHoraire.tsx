import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  schemaCreationTauxHoraire,
  schemaModificationTauxHoraire,
  type ReponseTauxHoraire,
} from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { useCreerTauxHoraire } from '@/hooks/parametrage/useCreerTauxHoraire';
import { useModifierTauxHoraire } from '@/hooks/parametrage/useModifierTauxHoraire';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** `undefined` => création. Fourni => modification (le `code` reste affiché mais verrouillé,
   *  RM-65 : le contrôleur refuse tout changement de `code` sur `PATCH`). */
  readonly tauxHoraire?: ReponseTauxHoraire;
}

/** Forme LOCALE du formulaire — délibérément distincte d'`EntreeCreationTauxHoraire` sur UN seul
 *  point : `montantCentimes` y est `number | null`, jamais `number`. Un défaut à `0` afficherait
 *  « 0.00 » pré-rempli dans `ChampMontant` pour un champ pourtant obligatoire (un montant
 *  horaire à zéro franc n'existe pas en pratique) — `null` affiche un champ vide, cohérent avec
 *  la manière dont `SheetEncaissement` traite déjà ses lignes de montant vides. */
interface ValeursFormulaireTauxHoraire {
  readonly code: string;
  readonly libelle: string;
  readonly montantCentimes: number | null;
  readonly valideDuLe: string;
  readonly valideAuLe: string | null;
}

const VALEURS_VIDES: ValeursFormulaireTauxHoraire = {
  code: '',
  libelle: '',
  montantCentimes: null,
  valideDuLe: new Date().toISOString().slice(0, 10),
  valideAuLe: null,
};

function versValeursFormulaire(
  tauxHoraire: ReponseTauxHoraire | undefined,
): ValeursFormulaireTauxHoraire {
  if (!tauxHoraire) return VALEURS_VIDES;
  return {
    code: tauxHoraire.code,
    libelle: tauxHoraire.libelle,
    montantCentimes: tauxHoraire.montantCentimes,
    valideDuLe: tauxHoraire.valideDuLe,
    valideAuLe: tauxHoraire.valideAuLe,
  };
}

/**
 * Création/modification d'une période de taux horaire (RM-65) — UN SEUL dialogue pour les deux
 * gestes, validé par les MÊMES schémas zod que le serveur (`schemaCreationTauxHoraire`/
 * `schemaModificationTauxHoraire`, `@dfa/shared`) — appliqués manuellement au moment de la
 * soumission (pas via `zodResolver` : la forme locale du formulaire diverge volontairement du
 * schéma sur `montantCentimes`, voir `ValeursFormulaireTauxHoraire`). Le `code` est simplement
 * rendu `readOnly` en modification (jamais retiré du corps envoyé : sa valeur déjà valide
 * traverse la validation sans y participer activement). Le serveur refuse toute période qui
 * chevauche une période valide existante du même code (`409 CONFLIT`) — affiché en bandeau
 * générique ici faute de `champ` porté par cette erreur précise côté contrat.
 */
export function DialogueTauxHoraire({ ouvert, onOuvertChange, tauxHoraire }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'validation', 'erreurs']);
  const estModification = tauxHoraire !== undefined;
  const creer = useCreerTauxHoraire();
  const modifier = useModifierTauxHoraire();
  const enCours = creer.isPending || modifier.isPending;

  const form = useForm<ValeursFormulaireTauxHoraire>({
    defaultValues: versValeursFormulaire(tauxHoraire),
  });

  useEffect(() => {
    if (ouvert) form.reset(versValeursFormulaire(tauxHoraire));
  }, [ouvert, tauxHoraire]);

  const soumettre = form.handleSubmit((valeurs) => {
    form.clearErrors();

    if (estModification && tauxHoraire) {
      const resultat = schemaModificationTauxHoraire.safeParse({
        libelle: valeurs.libelle,
        montantCentimes: valeurs.montantCentimes,
        valideDuLe: valeurs.valideDuLe,
        valideAuLe: valeurs.valideAuLe,
      });
      if (!resultat.success) {
        rapporterErreursZod(resultat.error, form);
        return;
      }
      modifier.mutate(
        { id: tauxHoraire.id, entree: resultat.data },
        { onSuccess: () => onOuvertChange(false) },
      );
      return;
    }

    const resultat = schemaCreationTauxHoraire.safeParse(valeurs);
    if (!resultat.success) {
      rapporterErreursZod(resultat.error, form);
      return;
    }
    creer.mutate(resultat.data, { onSuccess: () => onOuvertChange(false) });
  });

  const erreur = estModification ? modifier.error : creer.error;
  const estConflit = erreur instanceof ErreurApi && erreur.probleme.code === 'CONFLIT';

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {estModification
              ? t('parametrage:referentiels.tauxHoraires.modifier')
              : t('parametrage:referentiels.tauxHoraires.nouveau')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="th-code">
                {t('parametrage:referentiels.tauxHoraires.champs.code')}
              </Label>
              <Input
                id="th-code"
                readOnly={estModification || enCours}
                aria-invalid={form.formState.errors.code ? true : undefined}
                aria-describedby={form.formState.errors.code ? 'th-code-erreur' : undefined}
                {...form.register('code')}
              />
              {form.formState.errors.code ? (
                <p id="th-code-erreur" className="texte-libelle text-destructive">
                  {t('validation:requis')}
                </p>
              ) : null}
              {estModification ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('parametrage:referentiels.tauxHoraires.codeVerrouille')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="th-libelle">
                {t('parametrage:referentiels.tauxHoraires.champs.libelle')}
              </Label>
              <Input
                id="th-libelle"
                readOnly={enCours}
                aria-invalid={form.formState.errors.libelle ? true : undefined}
                aria-describedby={form.formState.errors.libelle ? 'th-libelle-erreur' : undefined}
                {...form.register('libelle')}
              />
              {form.formState.errors.libelle ? (
                <p id="th-libelle-erreur" className="texte-libelle text-destructive">
                  {t('validation:requis')}
                </p>
              ) : null}
            </div>
          </div>

          <Controller
            control={form.control}
            name="montantCentimes"
            render={({ field }) => (
              <ChampMontant
                id="th-montant"
                label={t('parametrage:referentiels.tauxHoraires.champs.montant')}
                obligatoire
                disabled={enCours}
                valeurCentimes={field.value}
                onChangeCentimes={field.onChange}
                erreur={form.formState.errors.montantCentimes ? t('validation:requis') : undefined}
              />
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="th-valide-du">
                {t('parametrage:referentiels.tauxHoraires.champs.valideDuLe')}
              </Label>
              <Controller
                control={form.control}
                name="valideDuLe"
                render={({ field }) => (
                  <DateInput
                    id="th-valide-du"
                    disabled={enCours}
                    erreur={form.formState.errors.valideDuLe ? t('validation:requis') : undefined}
                    value={field.value}
                    onChange={(iso) => field.onChange(iso ?? '')}
                  />
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="th-valide-au">
                {t('parametrage:referentiels.tauxHoraires.champs.valideAuLe')}
              </Label>
              <Controller
                control={form.control}
                name="valideAuLe"
                render={({ field }) => (
                  <DateInput
                    id="th-valide-au"
                    disabled={enCours}
                    value={field.value}
                    onChange={(iso) => field.onChange(iso ?? null)}
                  />
                )}
              />
              <p className="texte-libelle text-muted-foreground">
                {t('parametrage:referentiels.tauxHoraires.valideAuLeAide')}
              </p>
            </div>
          </div>

          {erreur ? (
            <p className="texte-libelle text-destructive" role="alert">
              {estConflit
                ? t('parametrage:referentiels.tauxHoraires.erreurChevauchement')
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

/** Reporte chaque problème zod sur le champ RHF correspondant (`setError`, jamais un bandeau
 *  générique pour une faute de saisie localisable) — le MESSAGE affiché reste `validation:requis`
 *  (générique, traduit) quel que soit le message zod par défaut (non traduit, jamais montré à
 *  l'écran, même discipline que `messageErreur` pour les erreurs serveur). */
function rapporterErreursZod(
  erreur: { readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }> },
  form: ReturnType<typeof useForm<ValeursFormulaireTauxHoraire>>,
): void {
  for (const issue of erreur.issues) {
    const chemin = issue.path[0];
    if (typeof chemin === 'string') {
      form.setError(chemin as keyof ValeursFormulaireTauxHoraire, { type: 'manual' });
    }
  }
}
