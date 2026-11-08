import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { schemaModificationVehicule } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { useModifierGarantieVehiculeStock } from '@/hooks/ventes/stock/useModifierGarantieVehiculeStock';

/** Mêmes bornes que `schemaModificationVehicule` (@dfa/shared) — dupliquées ici pour les attributs
 *  `min`/`max` des champs natifs et le message d'erreur, jamais pour re-décider la règle. */
const GARANTIE_MOIS_MAX = 240;
const GARANTIE_KM_MAX = 1_000_000;

const schemaGarantie = schemaModificationVehicule.pick({
  garantieDebutLe: true,
  garantieMois: true,
  garantieKm: true,
});

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly vehiculeId: string;
}

/** `mois`/`km` en texte tant que la saisie est en cours (un champ vide reste représentable, pas de
 *  `NaN` en transit) — convertis en `number | null` seulement à la soumission. */
interface ValeursFormulaire {
  readonly garantieDebutLe: string | null;
  readonly garantieMois: string;
  readonly garantieKm: string;
}

const VALEURS_VIDES: ValeursFormulaire = {
  garantieDebutLe: null,
  garantieMois: '',
  garantieKm: '',
};

/**
 * Dialogue « Garantie » de la fiche stock (issue #141) — saisie manuelle EXPLICITE des trois
 * champs de garantie (`RM-33`) : `CelluleGarantieSuivi` (ecrans/ventes/suivi/) affichait
 * systématiquement « — » faute d'un endroit où les renseigner. AUCUNE valeur n'est pré-remplie
 * depuis la fiche véhicule existante : `GarantieVehicule` (@dfa/shared, exposé par
 * `GET /vehicules/{id}`) ne porte que `debutLe`/`finLe`/`plafondKm`/`active` — PAS la durée brute
 * en mois — reconstruire `mois` depuis `finLe - debutLe` serait exactement la « durée devinée »
 * que ce dialogue s'interdit (voir le brief de livraison). Le formulaire s'ouvre donc toujours
 * vierge ; une saisie précédente n'est ni affichée ni écrasée silencieusement, le vendeur la
 * retape s'il veut la corriger.
 *
 * Séparé de `FormulaireVehiculeStock` (prix/date d'entrée en stock, fiche COMMERCIALE) à
 * dessein : la garantie est un attribut du VÉHICULE lui-même (`PATCH /vehicules/{id}`, droit
 * `vehicule.modifier`), pas de la fiche de coût stock (`PATCH /vehicules/{id}/stock`, droit
 * `ventes.vehicule_stock.modifier`) — les deux endpoints, les deux droits et les deux machines à
 * états sont distincts (voir `droits.ts::peutModifierVehiculeAssocie`) ; les mélanger dans un même
 * formulaire aurait fait croire à une seule permission alors qu'il y en a deux.
 */
export function DialogueGarantieVehiculeStock({ ouvert, onOuvertChange, vehiculeId }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'validation', 'erreurs']);
  const modifier = useModifierGarantieVehiculeStock(vehiculeId);
  const form = useForm<ValeursFormulaire>({ defaultValues: VALEURS_VIDES });

  useEffect(() => {
    if (ouvert) {
      form.reset(VALEURS_VIDES);
      modifier.reset();
    }
  }, [ouvert]);

  const soumettre = form.handleSubmit((valeurs) => {
    form.clearErrors();
    const objetNu = {
      garantieDebutLe: valeurs.garantieDebutLe,
      garantieMois: valeurs.garantieMois.trim() === '' ? null : Number(valeurs.garantieMois),
      garantieKm: valeurs.garantieKm.trim() === '' ? null : Number(valeurs.garantieKm),
    };
    const resultat = schemaGarantie.safeParse(objetNu);
    if (!resultat.success) {
      for (const issue of resultat.error.issues) {
        const chemin = issue.path[0];
        if (typeof chemin === 'string') {
          form.setError(chemin as keyof ValeursFormulaire, { type: 'manual' });
        }
      }
      return;
    }
    modifier.mutate(
      {
        garantieDebutLe: resultat.data.garantieDebutLe ?? null,
        garantieMois: resultat.data.garantieMois ?? null,
        garantieKm: resultat.data.garantieKm ?? null,
      },
      { onSuccess: () => onOuvertChange(false) },
    );
  });

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('ventes:stock.fiche.garantie.titre')}
      pied={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={modifier.isPending}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="garantie-vehicule-stock" disabled={modifier.isPending}>
            {modifier.isPending ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
          </Button>
        </>
      }
    >
      <form
        id="garantie-vehicule-stock"
        onSubmit={soumettre}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="garantie-debut">{t('ventes:stock.fiche.garantie.debutLe')}</Label>
          <Controller
            control={form.control}
            name="garantieDebutLe"
            render={({ field }) => (
              <DateInput
                id="garantie-debut"
                disabled={modifier.isPending}
                erreur={
                  form.formState.errors.garantieDebutLe ? t('validation:dateInvalide') : undefined
                }
                value={field.value}
                onChange={(iso) => field.onChange(iso ?? null)}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="garantie-mois">{t('ventes:stock.fiche.garantie.mois')}</Label>
            <Controller
              control={form.control}
              name="garantieMois"
              render={({ field }) => (
                <Input
                  id="garantie-mois"
                  type="number"
                  min={0}
                  max={GARANTIE_MOIS_MAX}
                  inputMode="numeric"
                  disabled={modifier.isPending}
                  aria-invalid={form.formState.errors.garantieMois ? true : undefined}
                  value={field.value}
                  onChange={(evenement) => field.onChange(evenement.target.value)}
                />
              )}
            />
            {form.formState.errors.garantieMois ? (
              <p className="texte-libelle text-destructive">
                {t('ventes:stock.fiche.garantie.moisHorsPlage')}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="garantie-km">{t('ventes:stock.fiche.garantie.km')}</Label>
            <Controller
              control={form.control}
              name="garantieKm"
              render={({ field }) => (
                <Input
                  id="garantie-km"
                  type="number"
                  min={0}
                  max={GARANTIE_KM_MAX}
                  inputMode="numeric"
                  disabled={modifier.isPending}
                  aria-invalid={form.formState.errors.garantieKm ? true : undefined}
                  value={field.value}
                  onChange={(evenement) => field.onChange(evenement.target.value)}
                />
              )}
            />
            {form.formState.errors.garantieKm ? (
              <p className="texte-libelle text-destructive">
                {t('ventes:stock.fiche.garantie.kmHorsPlage')}
              </p>
            ) : null}
          </div>
        </div>

        {modifier.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(modifier.error, t)}
          </p>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
