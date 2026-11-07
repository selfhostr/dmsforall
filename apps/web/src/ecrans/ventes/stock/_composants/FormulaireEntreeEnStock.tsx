import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  PROVENANCES_VEHICULE_STOCK,
  schemaMiseEnStock,
  type EntreeMiseEnStock,
  type SiteResume,
  type VehiculeResume,
} from '@dfa/shared';

import { useCleIdempotence } from '@/api/idempotence';
import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useMettreEnStock } from '@/hooks/ventes/stock/useTransitionsVehiculeStock';

/** Sentinelle de provenance « autre » — `provenance` est une liste EXTENSIBLE côté contrat
 *  (`z.string().trim().min(1).max(60)`, PROVENANCES_VEHICULE_STOCK n'est qu'une proposition
 *  fermée côté UI) : un vendeur doit pouvoir saisir un motif non encore répertorié sans être
 *  bloqué par un select fermé. */
const PROVENANCE_AUTRE = '__autre__';

type ValeurAssujetti = 'oui' | 'non' | 'non_renseigne';

function depuisValeurAssujetti(valeur: ValeurAssujetti): boolean | null {
  if (valeur === 'oui') return true;
  if (valeur === 'non') return false;
  return null;
}

interface ValeursFormulaire {
  readonly siteId: string;
  readonly provenanceSelect: string;
  readonly provenanceLibre: string;
  readonly dateEntreeStock: string;
  readonly prixAchatCentimes: number | null;
  readonly prixVenteAfficheCentimes: number | null;
  readonly vendeurPrecedentAssujetti: ValeurAssujetti;
}

function dateDuJour(): string {
  return new Date().toISOString().slice(0, 10);
}

function valeursVides(siteParDefaut: string): ValeursFormulaire {
  return {
    siteId: siteParDefaut,
    provenanceSelect: PROVENANCES_VEHICULE_STOCK[0],
    provenanceLibre: '',
    dateEntreeStock: dateDuJour(),
    prixAchatCentimes: null,
    prixVenteAfficheCentimes: null,
    vendeurPrecedentAssujetti: 'non_renseigne',
  };
}

function versEntree(valeurs: ValeursFormulaire): EntreeMiseEnStock {
  return {
    siteId: valeurs.siteId,
    provenance:
      valeurs.provenanceSelect === PROVENANCE_AUTRE
        ? valeurs.provenanceLibre.trim()
        : valeurs.provenanceSelect,
    dateEntreeStock: valeurs.dateEntreeStock,
    prixAchatCentimes: valeurs.prixAchatCentimes ?? 0,
    prixVenteAfficheCentimes: valeurs.prixVenteAfficheCentimes,
    vendeurPrecedentAssujetti: depuisValeurAssujetti(valeurs.vendeurPrecedentAssujetti),
  };
}

interface Props {
  readonly vehicule: VehiculeResume;
  readonly sites: readonly SiteResume[];
  readonly onRetour: () => void;
  /** Appelé avec le véhicule mis en stock (= `vehicule.id`) après un `POST` réussi. */
  readonly onMisEnStock: (vehiculeId: string) => void;
}

/**
 * `POST /vehicules/{vehiculeId}/stock` (RV-01) — second temps de l'écran « entrée en stock »,
 * une fois le véhicule existant choisi (`SelecteurVehiculeExistant`). `Idempotency-Key`
 * obligatoire (`useCleIdempotence`, même règle que `FormulaireArticle`) : un double-clic comptoir
 * ne doit jamais produire deux fiches de coût pour le même véhicule.
 */
export function FormulaireEntreeEnStock({ vehicule, sites, onRetour, onMisEnStock }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'validation', 'erreurs']);
  const idempotence = useCleIdempotence();
  const mettreEnStock = useMettreEnStock(vehicule.id);
  // Garage mono-site : site implicite, champ masqué (valeur envoyée telle quelle).
  const { estMonoSite, siteId: siteImplicite } = useSiteImplicite();
  const [siteParDefaut] = useState(() => siteImplicite ?? sites[0]?.id ?? '');

  const form = useForm<ValeursFormulaire>({ defaultValues: valeursVides(siteParDefaut) });
  const provenanceSelect = form.watch('provenanceSelect');

  const soumettre = form.handleSubmit((valeurs) => {
    form.clearErrors();
    const objetNu = versEntree(valeurs);
    const resultat = schemaMiseEnStock.safeParse(objetNu);
    if (!resultat.success) {
      for (const issue of resultat.error.issues) {
        const chemin = issue.path[0];
        if (typeof chemin === 'string') {
          form.setError(chemin as keyof ValeursFormulaire, { type: 'manual' });
        }
      }
      return;
    }
    mettreEnStock.mutate(
      { entree: resultat.data, idempotencyKey: idempotence.cle },
      {
        onSuccess: () => {
          idempotence.regenerer();
          onMisEnStock(vehicule.id);
        },
      },
    );
  });

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
      {/* DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : bloc de l'état courant du
       *  choix de véhicule, portant l'action qui le défait (« changer de véhicule »). C'est la
       *  première étape du formulaire figée en résumé, pas un groupe de contenu décoratif. */}
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <IdentiteVehicule vehicule={vehicule} taillePlaque="md" />
        <Button type="button" variant="ghost" onClick={onRetour} disabled={mettreEnStock.isPending}>
          {t('ventes:stock.entree.changerVehicule')}
        </Button>
      </div>

      <LegendeChampsObligatoires>
        {t('commun:formulaires.champsObligatoiresLegende')}
      </LegendeChampsObligatoires>

      {estMonoSite ? null : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entree-site" requis>
            {t('ventes:stock.champs.site')}
          </Label>
          <Controller
            control={form.control}
            name="siteId"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={mettreEnStock.isPending}
              >
                <SelectTrigger
                  id="entree-site"
                  aria-label={t('ventes:stock.champs.site')}
                  aria-required="true"
                  aria-invalid={form.formState.errors.siteId ? true : undefined}
                  aria-describedby={form.formState.errors.siteId ? 'entree-site-erreur' : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {form.formState.errors.siteId ? (
            <p id="entree-site-erreur" className="texte-libelle text-destructive">
              {t('validation:requis')}
            </p>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entree-provenance" requis>
            {t('ventes:stock.champs.provenance')}
          </Label>
          <Controller
            control={form.control}
            name="provenanceSelect"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={mettreEnStock.isPending}
              >
                <SelectTrigger
                  id="entree-provenance"
                  aria-label={t('ventes:stock.champs.provenance')}
                  aria-required="true"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVENANCES_VEHICULE_STOCK.map((valeur) => (
                    <SelectItem key={valeur} value={valeur}>
                      {t(`ventes:stock.provenances.${valeur}`)}
                    </SelectItem>
                  ))}
                  <SelectItem value={PROVENANCE_AUTRE}>
                    {t('ventes:stock.entree.provenanceAutre')}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entree-date" requis>
            {t('ventes:stock.champs.dateEntreeStock')}
          </Label>
          <Controller
            control={form.control}
            name="dateEntreeStock"
            render={({ field }) => (
              <DateInput
                id="entree-date"
                disabled={mettreEnStock.isPending}
                required
                aria-invalid={form.formState.errors.dateEntreeStock ? true : undefined}
                value={field.value}
                onChange={(iso) => field.onChange(iso ?? '')}
              />
            )}
          />
        </div>
      </div>

      {provenanceSelect === PROVENANCE_AUTRE ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entree-provenance-libre" requis>
            {t('ventes:stock.entree.provenanceAutre')}
          </Label>
          <Input
            id="entree-provenance-libre"
            readOnly={mettreEnStock.isPending}
            required
            aria-invalid={form.formState.errors.provenanceLibre ? true : undefined}
            aria-describedby={
              form.formState.errors.provenanceLibre ? 'entree-provenance-libre-erreur' : undefined
            }
            {...form.register('provenanceLibre', {
              required: provenanceSelect === PROVENANCE_AUTRE,
            })}
          />
          {form.formState.errors.provenanceLibre ? (
            <p id="entree-provenance-libre-erreur" className="texte-libelle text-destructive">
              {t('validation:requis')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Controller
          control={form.control}
          name="prixAchatCentimes"
          render={({ field }) => (
            <ChampMontant
              id="entree-prix-achat"
              label={t('ventes:stock.champs.prixAchat')}
              obligatoire
              disabled={mettreEnStock.isPending}
              valeurCentimes={field.value}
              onChangeCentimes={field.onChange}
              erreur={form.formState.errors.prixAchatCentimes ? t('validation:requis') : undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="prixVenteAfficheCentimes"
          render={({ field }) => (
            <ChampMontant
              id="entree-prix-vente"
              label={t('ventes:stock.champs.prixVenteAffiche')}
              disabled={mettreEnStock.isPending}
              valeurCentimes={field.value}
              onChangeCentimes={field.onChange}
            />
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entree-assujetti">
          {t('ventes:stock.champs.vendeurPrecedentAssujetti')}
        </Label>
        <Controller
          control={form.control}
          name="vendeurPrecedentAssujetti"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(valeur) => field.onChange(valeur as ValeurAssujetti)}
              disabled={mettreEnStock.isPending}
            >
              <SelectTrigger
                id="entree-assujetti"
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

      {mettreEnStock.error ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(mettreEnStock.error, t)}
        </p>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onRetour}
          disabled={mettreEnStock.isPending}
        >
          {t('commun:actions.annuler')}
        </Button>
        <Button type="submit" disabled={mettreEnStock.isPending}>
          {mettreEnStock.isPending
            ? t('commun:chargement.enCours')
            : t('ventes:stock.entree.mettreEnStock')}
        </Button>
      </div>
    </form>
  );
}
