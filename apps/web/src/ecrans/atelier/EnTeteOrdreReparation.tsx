import { useTranslation } from 'react-i18next';

import type { LocalisationVehicule, ReponseOrdreReparation } from '@dfa/shared';

import { Card, CardContent } from '@/components/ui/card';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { formaterDateHeure, formaterMontant, formaterKilometrage } from '@/lib/formats';

// `LocalisationVehicule` -> suffixe de `or:localisations` — mapping non trivial
// (`sous_traitant` -> `sousTraitant` avec interpolation `{fournisseur}`), explicite comme partout
// ailleurs dans ce lot.
const CLES_LOCALISATION: Record<LocalisationVehicule, string> = {
  parc: 'parc',
  atelier: 'atelier',
  sous_traitant: 'sousTraitant',
  essai_routier: 'essaiRoutier',
  lavage: 'lavage',
  pret_au_retrait: 'pretAuRetrait',
  sorti_provisoirement: 'sortiProvisoirement',
  restitue: 'restitue',
};

interface Props {
  readonly or: ReponseOrdreReparation;
}

/**
 * En-tête de fiche OR : identité véhicule/client, statut affiché (§8.3 — jamais `or.statut` brut,
 * voir `BadgeStatutOr`), et le bandeau d'informations opérationnelles (§5.2 du design atelier).
 * Aucun montant recalculé ici : `plafondCentimes`/`totauxParPayeur` viennent tels quels du serveur
 * et sont simplement absents (jamais `0.00`) pour un rôle sans droit aux montants.
 */
export function EnTeteOrdreReparation({ or }: Props) {
  const { t } = useTranslation(['or', 'commun']);

  const localisationTexte =
    or.localisation === 'sous_traitant'
      ? t('or:localisations.sousTraitant', { fournisseur: or.sousTraitantNom ?? '' })
      : t(`or:localisations.${CLES_LOCALISATION[or.localisation]}`);

  const restitutionReportee =
    or.restitutionInitialeLe !== null &&
    or.restitutionPromiseLe !== null &&
    or.restitutionInitialeLe !== or.restitutionPromiseLe;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="texte-titre-section font-semibold text-foreground">{or.numero}</span>
            <BadgeStatutOr etat={or.etatAffiche} />
          </div>
        </div>

        <IdentiteVehicule vehicule={or.vehicule} taillePlaque="xl" />
        <IdentiteClient client={or.client} />

        {or.numeroCommandeInterne ? (
          <p className="texte-corps">
            <span className="text-muted-foreground">{t('or:bandeau.numeroPo')} </span>
            <span className="font-medium text-foreground">{or.numeroCommandeInterne}</span>
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 texte-corps sm:grid-cols-3">
          <dt className="text-muted-foreground">{t('or:bandeau.kmEntree')}</dt>
          <dd className="col-span-2 sm:col-span-1">
            {or.kilometrageEntree !== null ? formaterKilometrage(or.kilometrageEntree, 'km') : ''}
          </dd>

          <dt className="text-muted-foreground">{t('or:bandeau.kmSortie')}</dt>
          <dd className="col-span-2 sm:col-span-1">
            {or.kilometrageSortie !== null ? formaterKilometrage(or.kilometrageSortie, 'km') : ''}
          </dd>

          <dt className="text-muted-foreground">{t('or:bandeau.localisation')}</dt>
          <dd className="col-span-2 sm:col-span-1">{localisationTexte}</dd>

          <dt className="text-muted-foreground">{t('or:bandeau.restitutionPromise')}</dt>
          <dd className="col-span-2 sm:col-span-1">
            {or.restitutionPromiseLe ? formaterDateHeure(or.restitutionPromiseLe) : ''}
            {restitutionReportee ? (
              <span className="ml-1 texte-libelle text-statut-attention">
                ({t('or:bandeau.restitutionReportee')})
              </span>
            ) : null}
          </dd>

          {or.plafondCentimes !== undefined ? (
            <>
              <dt className="text-muted-foreground">{t('or:bandeau.plafond')}</dt>
              <dd className="col-span-2 sm:col-span-1">
                {formaterMontant(or.plafondCentimes)}
                {or.plafondAutorisePar ? (
                  <span className="ml-1 texte-libelle text-muted-foreground">
                    ({or.plafondAutorisePar})
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>

        {or.demandes.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <h2 className="texte-libelle font-medium text-foreground">{t('or:demandes.titre')}</h2>
            <ul className="flex flex-col gap-1">
              {or.demandes.map((demande) => (
                <li key={demande.id} className="texte-corps text-muted-foreground">
                  « {demande.verbatim} »
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
