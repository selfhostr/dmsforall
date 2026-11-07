import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type {
  EtatAfficheOrdreReparation,
  LocalisationVehicule,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { ActionPrimaire } from '@/composants/layout/ActionPrimaire';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { listerOrdresReparation } from '@/hooks/atelier/ordres-reparation.api';
import { useSession } from '@/hooks/useSession';
import { formaterDateHeure, formaterMontant, formaterKilometrage } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import {
  DialogueFacturerEtEncaisser,
  type DemandeFacturerEtEncaisser,
} from '@/ecrans/facturation/DialogueFacturerEtEncaisser';

import { demandeFacturerEtEncaisserDepuisOr } from './facturer-encaisser-or';
import { trouverOrPrecedent } from './or-precedent';

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

// `EtatAfficheOrdreReparation` -> suffixe camelCase de `or:statutsAide` — même mapping que
// `BadgeStatutOr.CONFIG_STATUT_OR.cle`, dupliqué ici faute d'export partagé (ce composant
// n'appartient pas au périmètre de cet écran, même doctrine que `CLES_STATUT`,
// `EcranListeOrdresReparation.tsx`).
//
// CORRECTIF issue #110 (test terrain, verbatim : « je ne saurais pas dire à un client si sa
// voiture est prête »). ÉTABLI avant tout changement : `termine`/`restitue`/`cloture` sont TROIS
// ÉTATS RÉELS distincts de la machine à états (`STATUTS_ORDRE_REPARATION`,
// `packages/shared/src/contrats/atelier/enums.ts`) — « travaux finis, prêt au retrait » /
// « rendu au client » / « dossier administrativement fermé » — jamais trois mots pour la même
// chose, et `BadgeStatutOr` (seul point de rendu du statut, vérifié : liste, fiche, tableau de
// bord et fiche client passent tous par lui avec `etatAffiche`) les libelle DÉJÀ de façon
// cohérente partout. Rien à unifier. Ce que le rapport de test décrit vient d'ailleurs : `or.json`
// portait déjà un texte `statutsAide.*` par état (« Travaux terminés, prêt au retrait », etc.)
// mais AUCUN écran ne le consommait — la seule information disponible au comptoir était le mot
// seul du badge, insuffisant pour trancher entre trois états voisins. Rendu ici en texte TOUJOURS
// VISIBLE (jamais une infobulle au survol : la moitié du parc de ce produit est une tablette, sans
// pointeur ni hover, docs/design-comptoir.md).
const CLES_ETAT_AIDE: Record<EtatAfficheOrdreReparation, string> = {
  planifie: 'planifie',
  ouvert: 'ouvert',
  en_cours: 'enCours',
  attente_accord: 'attenteAccord',
  attente_pieces: 'attentePieces',
  attente_externe: 'attenteExterne',
  controle: 'controle',
  termine: 'termine',
  facture: 'facture',
  restitue: 'restitue',
  cloture: 'cloture',
  annule: 'annule',
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
  const { t } = useTranslation(['or', 'commun', 'navigation']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  // Lot C (`docs/plan-refonte-navigation.md`) — fil d'Ariane contextuel « qui et quoi » (client ›
  // véhicule › OR), à la place du fil de menu générique. Mêmes cibles que les blocs identité
  // cliquables ci-dessous (Lot B) : `chemins.clients.detail`/`chemins.vehicules.detail`.
  // `or.vehicule.plaque` porte DÉJÀ le canton en préfixe côté contrat (même doctrine que
  // `composants/identite/Plaque.tsx`, corrigé pour le même bug) : ne jamais le préfixer une
  // seconde fois avec `or.vehicule.canton`, ça produit un doublon (« VS VS 123456 »). `libelle`
  // du fil d'Ariane est une chaîne simple (`SegmentFilAriane.libelle: string`), donc pas question
  // de réutiliser ici le composant `Plaque` (qui rend du JSX) — la chaîne serveur suffit telle
  // quelle.
  const plaqueTexte = or.vehicule.plaque;
  const libelleVehicule = plaqueTexte
    ? `${plaqueTexte} · ${or.vehicule.designation}`
    : or.vehicule.designation;
  const segmentsFilAriane: readonly SegmentFilAriane[] = [
    {
      cle: 'client',
      libelle: or.client.nomAffiche,
      href: chemins.clients.detail(or.client.id, site),
    },
    {
      cle: 'vehicule',
      libelle: libelleVehicule,
      href: chemins.vehicules.detail(or.vehicule.id, site),
    },
  ];

  // Lot C — action primaire, elle SUIT l'état plutôt que de le redeviner : `facturer` est déjà le
  // signal serveur (`or.actionsDisponibles`, même source que `PanneauActionsOr`, non dupliquée
  // ici). SIGNALÉ (hors périmètre de ce lot) : l'autre moitié de l'exemple du plan, « Ajouter une
  // ligne » tant que l'OR est en cours, n'est PAS implémentée ici — son seul déclencheur
  // (`DialogueAjoutLigneOr`) vit dans `EcranFicheOrdreReparation.tsx` (fiche hors en-tête, hors
  // périmètre) et n'expose aucun moyen de lui donner un libellé accessible distinct depuis
  // l'extérieur ; le réutiliser tel quel créerait un second bouton strictement identique
  // (même nom accessible « Ajouter un travail ou une pièce ») et casserait les requêtes `findByRole` à
  // correspondance unique déjà vertes dans `EcranFicheOrdreReparation.spec.tsx`. Un futur lot qui
  // toucherait ce fichier pourrait déplacer ce déclencheur ici plutôt que de le dupliquer.
  const peutFacturer = or.actionsDisponibles.includes('facturer');
  // « Facturer et encaisser » : action principale quand le cas est simple (un client, tout
  // réalisé) ; sinon « Facturer » mène à l'écran détaillé. L'état du dialogue reste ici : après la
  // facturation `actionsDisponibles` perd `facturer`, le bouton disparaît mais le dialogue doit
  // rester ouvert pour l'encaissement et le PDF.
  const session = useSession();
  const [demande, setDemande] = useState<DemandeFacturerEtEncaisser | null>(null);
  const demandeSimple = demandeFacturerEtEncaisserDepuisOr(or, session.data?.utilisateur.role);

  // Lot B (`docs/plan-refonte-navigation.md`) — « l'OR précédent du même véhicule ». Requête
  // minimale via la fonction de transport (`vehiculeId` désormais sérialisé, défaut réparé), non
  // mise en cache sous une clé partagée (`clesQuery.or.*`, gelée, hors périmètre) pour ne rien
  // risquer de collision avec l'invalidation existante de la liste d'OR.
  const requetePrecedent = useQuery({
    queryKey: ['or-precedent', or.vehicule.id, or.id],
    queryFn: async () => {
      const page = await listerOrdresReparation(
        { vehiculeId: or.vehicule.id, tri: 'ouvertLe:desc' },
        { limite: 50 },
      );
      return page.donnees;
    },
  });
  const orPrecedent = trouverOrPrecedent(requetePrecedent.data ?? [], or);

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
        <FilAriane segments={segmentsFilAriane} pageCourante={or.numero} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="texte-titre-section font-semibold text-foreground">{or.numero}</span>
            <BadgeStatutOr etat={or.etatAffiche} />
          </div>
          {peutFacturer && demandeSimple ? (
            <ActionPrimaire>
              <Button type="button" variant="default" onClick={() => setDemande(demandeSimple)}>
                {t('or:transitions.facturerEncaisser')}
              </Button>
            </ActionPrimaire>
          ) : peutFacturer ? (
            <ActionPrimaire>
              <Button asChild variant="default">
                <Link
                  to={`/ordres-reparation/${or.id}/facturer`}
                  // Distinct de `PanneauActionsOr` (même libellé visible « Facturer », ligne
                  // ci-dessous — WCAG 2.5.3 : le nom accessible CONTIENT le texte visible) : deux
                  // liens vers la même destination coexistent sur l'écran (celui-ci, mis en
                  // avant ; l'autre, dans la liste complète des actions), un nom accessible
                  // distinct évite toute ambiguïté au clavier/lecteur d'écran.
                  aria-label={t('navigation:actionPrimaire.aria', {
                    action: t('or:transitions.facturer'),
                  })}
                >
                  {t('or:transitions.facturer')}
                </Link>
              </Button>
            </ActionPrimaire>
          ) : null}
        </div>

        {/* Issue #110 — voir `CLES_ETAT_AIDE` ci-dessus pour le contexte complet. Texte TOUJOURS
         *  visible (jamais une infobulle), juste sous le badge : de quoi répondre au client sans
         *  avoir à deviner ce que « Terminé »/« Restitué »/« Clôturé » distinguent. */}
        <p className="-mt-2 texte-libelle text-muted-foreground">
          {t(`or:statutsAide.${CLES_ETAT_AIDE[or.etatAffiche]}`)}
        </p>

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
            className="w-fit texte-libelle text-primary underline-offset-4 hover:underline anneau-focus"
            onClick={() => navigate(chemins.atelier.ordresReparation.detail(orPrecedent.id, site))}
          >
            {t('or:bandeau.orPrecedent', { numero: orPrecedent.numero })}
          </button>
        ) : null}

        {/* DESIGN.md « bordure structurelle uniquement » — ce bandeau (km entrée/sortie,
         *  localisation, restitution, plafond) est un simple groupe de contenu (paires dt/dd en
         *  lecture seule, aucun comportement propre) : `border` retiré, remplacé par une surface
         *  tonale (même mécanisme que `Card`, jamais cumulée avec un trait). */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/40 p-3 texte-corps sm:grid-cols-3">
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
      <DialogueFacturerEtEncaisser
        demande={demande}
        onFermer={() => setDemande(null)}
        onOuvrirFacture={(factureId) => navigate(`/factures/${factureId}`)}
        onFacturerEnDetail={() => navigate(`/ordres-reparation/${or.id}/facturer`)}
      />
    </Card>
  );
}
