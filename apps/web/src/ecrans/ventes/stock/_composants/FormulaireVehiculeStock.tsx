import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  schemaModificationVehiculeStock,
  type EntreeModificationVehiculeStock,
  type ReponseVehiculeStock,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { construireIfMatch } from '@/hooks/ventes/stock/vehicule-stock.api';
import { useModifierVehiculeStock } from '@/hooks/ventes/stock/useTransitionsVehiculeStock';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly stock: ReponseVehiculeStock;
}

/** Tri-état `oui`/`non`/`non_renseigne` -> `boolean | null` (`vendeurPrecedentAssujetti`, RV-60) —
 *  un `Checkbox` bi-état ne peut pas représenter « pas encore renseigné », qui reste un état
 *  légitime tant que la reprise/l'achat n'a pas encore été qualifié fiscalement. */
type ValeurAssujetti = 'oui' | 'non' | 'non_renseigne';

function versValeurAssujetti(valeur: boolean | null): ValeurAssujetti {
  if (valeur === true) return 'oui';
  if (valeur === false) return 'non';
  return 'non_renseigne';
}

function depuisValeurAssujetti(valeur: ValeurAssujetti): boolean | null {
  if (valeur === 'oui') return true;
  if (valeur === 'non') return false;
  return null;
}

interface ValeursFormulaire {
  readonly dateEntreeStock: string;
  readonly prixAchatCentimes: number | null;
  readonly prixVenteAfficheCentimes: number | null;
  readonly vendeurPrecedentAssujetti: ValeurAssujetti;
}

function versValeursFormulaire(stock: ReponseVehiculeStock): ValeursFormulaire {
  return {
    dateEntreeStock: stock.dateEntreeStock,
    prixAchatCentimes: stock.prixAchatCentimes,
    prixVenteAfficheCentimes: stock.prixVenteAfficheCentimes,
    vendeurPrecedentAssujetti: versValeurAssujetti(stock.vendeurPrecedentAssujetti),
  };
}

/** `ValeursFormulaire` -> objet nu conforme à `schemaModificationVehiculeStock` (@dfa/shared).
 *  `prixAchatCentimes` reste obligatoire dans le formulaire (jamais `null` — la fiche stock en a
 *  toujours un, `RV-03`) ; seul `prixVenteAfficheCentimes` peut passer explicitement à `null`
 *  (« pas encore chiffré »). */
function versEntree(valeurs: ValeursFormulaire): EntreeModificationVehiculeStock {
  return {
    dateEntreeStock: valeurs.dateEntreeStock,
    prixAchatCentimes: valeurs.prixAchatCentimes ?? 0,
    prixVenteAfficheCentimes: valeurs.prixVenteAfficheCentimes,
    vendeurPrecedentAssujetti: depuisValeurAssujetti(valeurs.vendeurPrecedentAssujetti),
  };
}

/**
 * Modification de la fiche stock (`PATCH /vehicules/{id}/stock`, `If-Match` obligatoire) — SEUL
 * endpoint qui fixe/change `prixVenteAfficheCentimes` (y compris `null -> valeur` = « mettre en
 * vente ») : il n'existe pas d'action « mettre en vente » séparée côté API (voir le brief de
 * livraison). `prixAchatCentimes` reste modifiable jusqu'à `statutCommercial = 'vendu'` exclu
 * (verrouillé côté serveur ; ce formulaire désactive aussi le champ pour ne jamais promettre une
 * saisie vouée à échouer, §8 « jamais un bouton dont le clic échouerait à coup sûr »).
 */
export function FormulaireVehiculeStock({ ouvert, onOuvertChange, stock }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'validation', 'erreurs']);
  const modifier = useModifierVehiculeStock(stock.id);
  const prixAchatVerrouille = stock.statutCommercial === 'vendu';

  const form = useForm<ValeursFormulaire>({ defaultValues: versValeursFormulaire(stock) });

  useEffect(() => {
    if (ouvert) form.reset(versValeursFormulaire(stock));
  }, [ouvert, stock]);

  const soumettre = form.handleSubmit((valeurs) => {
    form.clearErrors();
    const objetNu = versEntree(valeurs);
    const resultat = schemaModificationVehiculeStock.safeParse(objetNu);
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
      { entree: resultat.data, ifMatch: construireIfMatch(stock.version) },
      { onSuccess: () => onOuvertChange(false) },
    );
  });

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('ventes:stock.fiche.actions.mettreAJour')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stock-date-entree">{t('ventes:stock.champs.dateEntreeStock')}</Label>
            <Controller
              control={form.control}
              name="dateEntreeStock"
              render={({ field }) => (
                <DateInput
                  id="stock-date-entree"
                  disabled={modifier.isPending}
                  aria-invalid={form.formState.errors.dateEntreeStock ? true : undefined}
                  value={field.value}
                  onChange={(iso) => field.onChange(iso ?? '')}
                />
              )}
            />
            {form.formState.errors.dateEntreeStock ? (
              <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={form.control}
              name="prixAchatCentimes"
              render={({ field }) => (
                <ChampMontant
                  id="stock-prix-achat"
                  label={t('ventes:stock.champs.prixAchat')}
                  obligatoire
                  disabled={modifier.isPending || prixAchatVerrouille}
                  valeurCentimes={field.value}
                  onChangeCentimes={field.onChange}
                  erreur={
                    form.formState.errors.prixAchatCentimes ? t('validation:requis') : undefined
                  }
                />
              )}
            />
            <Controller
              control={form.control}
              name="prixVenteAfficheCentimes"
              render={({ field }) => (
                <ChampMontant
                  id="stock-prix-vente"
                  label={t('ventes:stock.champs.prixVenteAffiche')}
                  disabled={modifier.isPending}
                  valeurCentimes={field.value}
                  onChangeCentimes={field.onChange}
                />
              )}
            />
          </div>
          {prixAchatVerrouille ? (
            <p className="-mt-2 texte-libelle text-muted-foreground">
              {t('ventes:stock.fiche.prixAchatVerrouille')}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stock-assujetti">
              {t('ventes:stock.champs.vendeurPrecedentAssujetti')}
            </Label>
            <Controller
              control={form.control}
              name="vendeurPrecedentAssujetti"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(valeur) => field.onChange(valeur as ValeurAssujetti)}
                  disabled={modifier.isPending}
                >
                  <SelectTrigger
                    id="stock-assujetti"
                    aria-label={t('ventes:stock.champs.vendeurPrecedentAssujetti')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="non_renseigne">
                      {t('ventes:stock.assujetti.nonRenseigne')}
                    </SelectItem>
                    <SelectItem value="oui">{t('ventes:stock.assujetti.oui')}</SelectItem>
                    <SelectItem value="non">{t('ventes:stock.assujetti.non')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {modifier.error ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreur(modifier.error, t)}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOuvertChange(false)}
              disabled={modifier.isPending}
            >
              {t('commun:actions.annuler')}
            </Button>
            <Button type="submit" disabled={modifier.isPending}>
              {modifier.isPending
                ? t('commun:chargement.enCours')
                : t('commun:actions.enregistrer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
