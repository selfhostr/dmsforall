import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  CATEGORIES_ARTICLE,
  schemaCreationArticle,
  schemaModificationArticle,
  type CategorieArticle,
  type EntreeCreationArticle,
  type ReponseArticle,
} from '@dfa/shared';

import { useCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { messageErreur } from '@/api/erreurs';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { useCreerArticle } from '@/hooks/pieces/useCreerArticle';
import { useModifierArticle } from '@/hooks/pieces/useTransitionsArticle';

/** TVA suisse (CONTRIBUTING.md) — trois taux réels + l'exonération, même liste que
 *  `ecrans/parametrage/DialoguePrestation.tsx` (dupliquée : ce module n'importe rien de
 *  `parametrage/`, périmètres disjoints). */
const TAUX_TVA_SUISSES = [81, 26, 38, 0] as const;

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** `undefined` => création. Fourni => modification. */
  readonly article?: ReponseArticle;
  /** Appelé après une création réussie, avec l'article créé — l'écran liste n'a rien à faire de
   *  plus (invalidation déjà gérée par `useCreerArticle`), mais la fiche pourrait vouloir y
   *  naviguer directement. */
  readonly onCree?: (article: ReponseArticle) => void;
}

/** Forme locale du formulaire — `prixVenteTtcCentimes`/`montantConsigneTtcCentimes` en
 *  `number | null` (jamais un défaut à `0` pré-rempli, même raison que `ValeursFormulaireTauxHoraire`
 *  dans `DialogueTauxHoraire.tsx`) ; `marque`/`codeBarres` en `string` simple (converties en
 *  `null` à la soumission, `versEntree` ci-dessous). */
interface ValeursFormulaireArticle {
  readonly designation: string;
  readonly marque: string;
  readonly categorie: CategorieArticle;
  readonly referencePrincipale: string;
  readonly codeBarres: string;
  readonly prixVenteTtcCentimes: number | null;
  readonly tauxTvaPourmille: number;
  readonly estEchangeStandard: boolean;
  readonly montantConsigneTtcCentimes: number | null;
}

const VALEURS_VIDES: ValeursFormulaireArticle = {
  designation: '',
  marque: '',
  categorie: 'piece_mecanique',
  referencePrincipale: '',
  codeBarres: '',
  prixVenteTtcCentimes: null,
  tauxTvaPourmille: 81,
  estEchangeStandard: false,
  montantConsigneTtcCentimes: null,
};

function versValeursFormulaire(article: ReponseArticle | undefined): ValeursFormulaireArticle {
  if (!article) return VALEURS_VIDES;
  return {
    designation: article.designation,
    marque: article.marque ?? '',
    categorie: article.categorie,
    referencePrincipale: article.referencePrincipale,
    codeBarres: article.codeBarres ?? '',
    prixVenteTtcCentimes: article.prixVenteTtcCentimes,
    tauxTvaPourmille: article.tauxTvaPourmille,
    estEchangeStandard: article.estEchangeStandard,
    montantConsigneTtcCentimes: article.montantConsigneTtcCentimes,
  };
}

/** `ValeursFormulaireArticle` -> objet nu conforme à `schemaArticleObjet` (@dfa/shared) — la
 *  contrainte RP-37 (`montantConsigneTtcCentimes` obligatoire SSI `estEchangeStandard`) est
 *  appliquée ICI plutôt que déléguée à `zodResolver` : `schemaCreationArticle`/
 *  `schemaModificationArticle` sont deux dérivations distinctes du même objet nu (l'une avec
 *  `.refine()`, l'autre `.partial()` sans lui) — un seul `zodResolver` ne peut pas couvrir les
 *  deux, même patron que `DialogueTauxHoraire.tsx` (`safeParse` manuel à la soumission). */
function versEntree(valeurs: ValeursFormulaireArticle): EntreeCreationArticle {
  return {
    designation: valeurs.designation.trim(),
    marque: valeurs.marque.trim() === '' ? null : valeurs.marque.trim(),
    categorie: valeurs.categorie,
    referencePrincipale: valeurs.referencePrincipale.trim(),
    codeBarres: valeurs.codeBarres.trim() === '' ? null : valeurs.codeBarres.trim(),
    prixVenteTtcCentimes: valeurs.prixVenteTtcCentimes ?? 0,
    tauxTvaPourmille: valeurs.tauxTvaPourmille,
    estEchangeStandard: valeurs.estEchangeStandard,
    montantConsigneTtcCentimes: valeurs.estEchangeStandard ? valeurs.montantConsigneTtcCentimes : null,
  };
}

/**
 * Création/modification d'un article du référentiel (RP-01 → RP-08) — un seul dialogue pour les
 * deux gestes, même patron que `DialogueTauxHoraire`/`DialoguePrestation` (`parametrage/`). Les
 * prix sont TVA COMPRISE (RF-40) : `prixVenteTtcCentimes` est ce que le magasinier annonce au
 * comptoir, jamais un montant hors taxe à recalculer.
 *
 * `numeroArticle` n'apparaît JAMAIS dans ce formulaire (généré par le serveur, RP-08) — en
 * modification, il reste affiché en lecture seule par l'écran appelant (`EnTeteFicheArticle`),
 * pas répété ici.
 */
export function FormulaireArticle({ ouvert, onOuvertChange, article, onCree }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'validation', 'erreurs']);
  const estModification = article !== undefined;
  const idempotence = useCleIdempotence();
  const creer = useCreerArticle();
  const modifier = useModifierArticle(article?.id ?? '');
  const enCours = creer.isPending || modifier.isPending;

  const form = useForm<ValeursFormulaireArticle>({ defaultValues: versValeursFormulaire(article) });

  useEffect(() => {
    if (ouvert) form.reset(versValeursFormulaire(article));
  }, [ouvert, article]);

  const estEchangeStandard = form.watch('estEchangeStandard');

  const soumettre = form.handleSubmit((valeurs) => {
    form.clearErrors();
    const objetNu = versEntree(valeurs);

    if (estModification && article) {
      const resultat = schemaModificationArticle.safeParse(objetNu);
      if (!resultat.success) {
        rapporterErreursZod(resultat.error, form);
        return;
      }
      modifier.mutate(resultat.data, { onSuccess: () => onOuvertChange(false) });
      return;
    }

    const resultat = schemaCreationArticle.safeParse(objetNu);
    if (!resultat.success) {
      rapporterErreursZod(resultat.error, form);
      return;
    }
    creer.mutate(
      { entree: resultat.data, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          idempotence.regenerer();
          onOuvertChange(false);
          onCree?.(reponse.donnees);
        },
      },
    );
  });

  const erreur = estModification ? modifier.error : creer.error;

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{estModification ? t('pieces:articles.actions.modifier') : t('pieces:articles.actions.ajouter')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="art-designation">{t('pieces:articles.designation')}</Label>
              <Input
                id="art-designation"
                readOnly={enCours}
                aria-invalid={form.formState.errors.designation ? true : undefined}
                {...form.register('designation', { required: true })}
              />
              {form.formState.errors.designation ? <p className="texte-libelle text-destructive">{t('validation:requis')}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="art-marque">{t('pieces:articles.marque')}</Label>
              <Input id="art-marque" readOnly={enCours} {...form.register('marque')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="art-reference">{t('pieces:articles.reference')}</Label>
              <Input
                id="art-reference"
                readOnly={enCours}
                aria-invalid={form.formState.errors.referencePrincipale ? true : undefined}
                {...form.register('referencePrincipale', { required: true })}
              />
              {form.formState.errors.referencePrincipale ? (
                <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="art-code-barres">{t('pieces:articles.codeBarres')}</Label>
              <Input id="art-code-barres" readOnly={enCours} {...form.register('codeBarres')} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="art-categorie">{t('pieces:articles.categorie')}</Label>
            <Controller
              control={form.control}
              name="categorie"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(valeur) => field.onChange(valeur as CategorieArticle)} disabled={enCours}>
                  <SelectTrigger id="art-categorie" aria-label={t('pieces:articles.categorie')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES_ARTICLE.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`pieces:articles.categories.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={form.control}
              name="prixVenteTtcCentimes"
              render={({ field }) => (
                <ChampMontant
                  id="art-prix-vente"
                  label={t('pieces:articles.prix.vente')}
                  obligatoire
                  disabled={enCours}
                  valeurCentimes={field.value}
                  onChangeCentimes={field.onChange}
                  erreur={form.formState.errors.prixVenteTtcCentimes ? t('validation:requis') : undefined}
                />
              )}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="art-tva">{t('pieces:articles.tva')}</Label>
              <Controller
                control={form.control}
                name="tauxTvaPourmille"
                render={({ field }) => (
                  <Select value={String(field.value)} onValueChange={(valeur) => field.onChange(Number(valeur))} disabled={enCours}>
                    <SelectTrigger id="art-tva" aria-label={t('pieces:articles.tva')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAUX_TVA_SUISSES.map((pourmille) => (
                        <SelectItem key={pourmille} value={String(pourmille)}>
                          {t(`pieces:articles.tauxTvaLibelles.${pourmille}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <p className="-mt-2 texte-libelle text-muted-foreground">{t('pieces:articles.prix.aideTvaComprise')}</p>

          <div className="flex flex-col gap-3 rounded-md border p-3">
            <label className="flex items-center gap-2 texte-corps">
              <Controller
                control={form.control}
                name="estEchangeStandard"
                render={({ field }) => (
                  <Checkbox checked={field.value} onCheckedChange={(coche) => field.onChange(coche === true)} disabled={enCours} />
                )}
              />
              {t('pieces:articles.echangeStandard')}
            </label>
            {estEchangeStandard ? (
              <Controller
                control={form.control}
                name="montantConsigneTtcCentimes"
                render={({ field }) => (
                  <ChampMontant
                    id="art-consigne"
                    label={t('pieces:articles.montantConsigne')}
                    obligatoire
                    disabled={enCours}
                    valeurCentimes={field.value}
                    onChangeCentimes={field.onChange}
                    erreur={form.formState.errors.montantConsigneTtcCentimes ? t('validation:requis') : undefined}
                  />
                )}
              />
            ) : null}
          </div>

          {erreur ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreur(erreur, t)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOuvertChange(false)} disabled={enCours}>
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

/** Reporte chaque problème zod sur le champ RHF correspondant — même patron que
 *  `DialogueTauxHoraire.tsx` (le message affiché reste `validation:requis`, générique et traduit,
 *  jamais le message zod par défaut). */
function rapporterErreursZod(
  erreur: { readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }> },
  form: ReturnType<typeof useForm<ValeursFormulaireArticle>>,
): void {
  for (const issue of erreur.issues) {
    const chemin = issue.path[0];
    if (typeof chemin === 'string') {
      form.setError(chemin as keyof ValeursFormulaireArticle, { type: 'manual' });
    }
  }
}
