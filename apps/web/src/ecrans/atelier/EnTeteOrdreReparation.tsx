import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type {
  LocalisationVehicule,
  OrdreReparationResume,
  PageCurseur,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { formaterDateHeure, formaterMontant, formaterKilometrage } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  // Lot B (`docs/plan-refonte-navigation.md`) — « l'OR précédent du même véhicule ». Requête
  // construite ICI plutôt que via `hooks/atelier/ordres-reparation.api.ts::listerOrdresReparation`
  // (hors périmètre de cet agent) : cette fonction de transport ne sérialise QUE `q`/`statut`/
  // `siteId`/`tri` dans son `URLSearchParams` — `vehiculeId` y serait silencieusement ignoré côté
  // client alors que le serveur le supporte bien (`schemaFiltresOrdresReparation.vehiculeId`,
  // `packages/shared/src/contrats/atelier/ordre-reparation.ts`). Requête minimale, non mise en
  // cache sous une clé partagée (`clesQuery.or.*`, gelée, hors périmètre) pour ne rien risquer de
  // collision avec l'invalidation existante de la liste d'OR.
  const requetePrecedent = useQuery({
    queryKey: ['or-precedent', or.vehicule.id, or.id],
    queryFn: async () => {
      const parametres = new URLSearchParams({
        vehiculeId: or.vehicule.id,
        tri: 'ouvertLe:desc',
        limite: '5',
      });
      const page = await requeteApi<PageCurseur<OrdreReparationResume>>(
        `/ordres-reparation?${parametres.toString()}`,
        { method: 'GET' },
      );
      return page?.donnees ?? [];
    },
  });
  const orPrecedent = requetePrecedent.data?.find((candidat) => candidat.id !== or.id) ?? null;

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

        <IdentiteVehicule
          vehicule={or.vehicule}
          taillePlaque="xl"
          onClick={() => navigate(chemins.vehicules.detail(or.vehicule.id, site))}
        />
        <IdentiteClient
          client={or.client}
          onClick={() => navigate(chemins.clients.detail(or.client.id, site))}
        />

        {or.numeroCommandeInterne ? (
          <p className="texte-corps">
            <span className="text-muted-foreground">{t('or:bandeau.numeroPo')} </span>
            <span className="font-medium text-foreground">{or.numeroCommandeInterne}</span>
          </p>
        ) : null}

        {/* Lot B — l'OR précédent du même véhicule (chef d'atelier, dix dossiers ouverts par
         *  heure : retrouver l'historique sans retaper la plaque). Silencieux tant que la requête
         *  est en vol ou n'a rien trouvé — « aucun OR précédent » est un état normal (premier
         *  passage du véhicule), pas une erreur à signaler. */}
        {orPrecedent ? (
          <button
            type="button"
            className="w-fit texte-libelle text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => navigate(chemins.atelier.ordresReparation.detail(orPrecedent.id, site))}
          >
            {t('or:bandeau.orPrecedent', { numero: orPrecedent.numero })}
          </button>
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
