import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type { ClientResume, VehiculeStockResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { useClient } from '@/hooks/clients/useClient';
import { useCreationDossierVente } from '@/hooks/ventes/dossiers/useCreationDossierVente';
import { useVehiculeStockParId } from '@/hooks/ventes/dossiers/useVehiculeStockParId';
import { chemins } from '@/routes/chemins';

import { SelecteurClientDossier } from './SelecteurClientDossier';
import { SelecteurVehiculeStockDossier } from './SelecteurVehiculeStockDossier';

/** Même conversion locale que `EcranNouvelOrdreReparation.tsx` (atelier, lot 1) : `GET /clients/{id}`
 *  renvoie `ReponseClient` (fiche complète), pas `ClientResume` — `IdentiteClient` ne lit que les
 *  quelques champs communs aux deux formes. Dupliquée ici plutôt que partagée hors périmètre. */
function versClientResume(client: {
  readonly id: string;
  readonly numeroClient: string;
  readonly nomAffiche: string;
  readonly type: ClientResume['type'];
  readonly statut: ClientResume['statut'];
  readonly langueCorrespondance: ClientResume['langueCorrespondance'];
  readonly poObligatoire: boolean;
  readonly telephone: string | null;
  readonly dernierPassageLe: string | null;
}): ClientResume {
  return {
    id: client.id,
    numeroClient: client.numeroClient,
    nomAffiche: client.nomAffiche,
    type: client.type,
    statut: client.statut,
    langueCorrespondance: client.langueCorrespondance,
    poObligatoire: client.poObligatoire,
    telephone: client.telephone,
    localite: null,
    nombreVehicules: 0,
    dernierPassageLe: client.dernierPassageLe,
  };
}

/**
 * Création d'un dossier de vente (RV-29, design §6.1) — 5 champs SEULEMENT, exactement
 * `schemaCreationDossierVente` (`@dfa/shared`) : `siteId`, `clientAcheteurId`, `clientFactureId`
 * (optionnel), `clientConducteurId` (optionnel), `vehiculeId` (optionnel),
 * `dateLivraisonEstimee` (optionnel).
 *
 * ÉCART SIGNALÉ AVEC LE BRIEF (à lire, pas une omission silencieuse) : le brief de ce lot demande
 * un champ « prix négocié » sur cet écran. Le contrat GELÉ `contrats/ventes/dossier-vente.ts`
 * l'exclut EXPLICITEMENT (§8.2, littéral : « aucune duplication du montant, de la TVA ou du statut
 * de paiement ici ») — confirmé par le design déjà écrit (`docs/design-ecrans-ventes.md` §6.1, qui
 * ne liste que les 5 champs ci-dessus). Le prix vit sur le premier document de la chaîne
 * facturation (devis/bon de commande), créé ENSUITE, hors périmètre de cet écran et de cet agent.
 * Aucun champ prix n'est donc posé ici — l'inventer aurait envoyé un champ que
 * `schemaCreationDossierVente` rejette (`400 VALIDATION_ECHOUEE`).
 *
 * Deux prérequis jamais devinés (même doctrine que `EcranNouvelOrdreReparation`) :
 *  - `site` (`?site=`) : bloque l'écran avec un message explicite si absent.
 *  - le client acheteur : soit pré-rempli via `?clientId=` (venant de la fiche client, RM-21),
 *    soit choisi via `SelecteurClientDossier` — aucune redirection vers `/recherche` ici
 *    (contrairement à l'OR) : contrairement à l'atelier, ce module n'a pas encore de point d'entrée
 *    qui pré-remplit systématiquement `clientId`, un sélecteur inline reste donc nécessaire.
 *
 * `vehiculeId` peut arriver pré-rempli via `?vehiculeId=` (bouton « Vendre » de `BlocVente`, design
 * §1.1/§5.4, écran d'un autre agent) — sinon choisi via `SelecteurVehiculeStockDossier`, TOUJOURS
 * optionnel (RV-30 : un dossier peut exister avant qu'un véhicule précis lui soit assigné).
 */
export function EcranNouveauDossierVente() {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const clientIdPrefilled = searchParams.get('clientId') ?? undefined;
  const vehiculeIdPrefilled = searchParams.get('vehiculeId') ?? undefined;

  const requeteClientPrefilled = useClient(clientIdPrefilled);
  const requeteVehiculePrefilled = useVehiculeStockParId(vehiculeIdPrefilled);

  const [clientAcheteur, setClientAcheteur] = useState<ClientResume | null>(null);
  const [vehicule, setVehicule] = useState<VehiculeStockResume | null>(null);
  const [facturerATiers, setFacturerATiers] = useState(false);
  const [clientFacture, setClientFacture] = useState<ClientResume | null>(null);
  const [conducteurDifferent, setConducteurDifferent] = useState(false);
  const [clientConducteur, setClientConducteur] = useState<ClientResume | null>(null);
  const [dateLivraisonEstimee, setDateLivraisonEstimee] = useState('');
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const creation = useCreationDossierVente();

  const clientAcheteurEffectif = clientIdPrefilled
    ? requeteClientPrefilled.data
      ? versClientResume(requeteClientPrefilled.data)
      : null
    : clientAcheteur;

  const vehiculeEffectif = vehiculeIdPrefilled
    ? requeteVehiculePrefilled.data
      ? {
          id: requeteVehiculePrefilled.data.id,
          vehicule: requeteVehiculePrefilled.data.vehicule,
          provenance: requeteVehiculePrefilled.data.provenance,
          typeVehicule: requeteVehiculePrefilled.data.typeVehicule,
          statutCommercial: requeteVehiculePrefilled.data.statutCommercial,
          prixVenteAfficheCentimes: requeteVehiculePrefilled.data.prixVenteAfficheCentimes,
          joursStock: requeteVehiculePrefilled.data.joursStock,
        }
      : null
    : vehicule;

  function soumettre() {
    if (!site || !clientAcheteurEffectif) return;
    creation.soumettre(
      {
        siteId: site,
        clientAcheteurId: clientAcheteurEffectif.id,
        clientFactureId: facturerATiers ? (clientFacture?.id ?? null) : null,
        clientConducteurId: conducteurDifferent ? (clientConducteur?.id ?? null) : null,
        vehiculeId: vehiculeEffectif?.id ?? null,
        dateLivraisonEstimee: dateLivraisonEstimee.trim() === '' ? null : dateLivraisonEstimee,
      },
      { onSuccess: (dossier) => navigate(chemins.ventes.dossiers.detail(dossier.id, site)) },
    );
  }

  if (!site) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
        <h1 className="sr-only">{t('ventes:dossier.nouveau.titre')}</h1>
        <EtatVide
          titre={t('ventes:dossier.nouveau.siteManquant.titre')}
          description={t('ventes:dossier.nouveau.siteManquant.description')}
          action={
            <Button asChild variant="outline">
              <Link to="/">{t('commun:actions.retourAccueil')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (clientIdPrefilled && requeteClientPrefilled.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:dossier.nouveau.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (clientIdPrefilled && requeteClientPrefilled.isError) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:dossier.nouveau.titre')}</h1>
        <EtatErreur
          titre={t('erreurs:inattendue.titre')}
          description={messageErreur(requeteClientPrefilled.error, t)}
          onReessayer={() => void requeteClientPrefilled.refetch()}
        />
      </div>
    );
  }

  const peutSoumettre = Boolean(clientAcheteurEffectif) && !creation.enCours;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="texte-titre-section font-semibold text-foreground">
        {t('ventes:dossier.nouveau.titre')}
      </h1>

      <LegendeChampsObligatoires>
        {t('commun:formulaires.champsObligatoiresLegende')}
      </LegendeChampsObligatoires>

      <Card>
        <CardHeader>
          <CardTitle className="texte-corps font-medium">
            {t('ventes:dossier.nouveau.client.titre')}
            {/* Seul champ réellement obligatoire de cet écran (`clientAcheteurId`,
             *  `schemaCreationDossierVente`) — `CardTitle` (pas `<Label>`) porte ici le nom visible
             *  du champ (le sélecteur ci-dessous n'a pas de libellé visible propre), même rendu
             *  d'étoile (`aria-hidden`) que `Label requis` pour rester cohérent avec la légende. */}
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clientAcheteurEffectif ? (
            <div className="flex items-center justify-between gap-3">
              <IdentiteClient client={clientAcheteurEffectif} />
              {!clientIdPrefilled ? (
                <Button variant="ghost" size="sm" onClick={() => setClientAcheteur(null)}>
                  {t('commun:actions.modifier')}
                </Button>
              ) : null}
            </div>
          ) : (
            <SelecteurClientDossier
              valeur={null}
              onChangeValeur={(_id, client) => setClientAcheteur(client)}
              libelle={t('ventes:dossier.nouveau.client.titre')}
              requis
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-corps font-medium">
            {t('ventes:dossier.nouveau.vehicule.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vehiculeEffectif ? (
            <div className="flex items-center justify-between gap-3">
              <IdentiteVehicule vehicule={vehiculeEffectif.vehicule} />
              {!vehiculeIdPrefilled ? (
                <Button variant="ghost" size="sm" onClick={() => setVehicule(null)}>
                  {t('commun:actions.modifier')}
                </Button>
              ) : null}
            </div>
          ) : (
            <SelecteurVehiculeStockDossier
              valeur={null}
              onChangeValeur={(_id, v) => setVehicule(v)}
              libelle={t('ventes:dossier.nouveau.vehicule.titre')}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <label htmlFor="dossier-facturer-a-tiers" className="flex items-center gap-2 texte-corps">
            <Checkbox
              id="dossier-facturer-a-tiers"
              checked={facturerATiers}
              onCheckedChange={(coche) => setFacturerATiers(coche === true)}
            />
            {t('ventes:dossier.nouveau.clientFacture.activer')}
          </label>
          {facturerATiers ? (
            <SelecteurClientDossier
              valeur={clientFacture?.id ?? null}
              onChangeValeur={(_id, client) => setClientFacture(client)}
              libelle={t('ventes:dossier.nouveau.clientFacture.titre')}
            />
          ) : null}

          <label
            htmlFor="dossier-conducteur-different"
            className="flex items-center gap-2 texte-corps"
          >
            <Checkbox
              id="dossier-conducteur-different"
              checked={conducteurDifferent}
              onCheckedChange={(coche) => setConducteurDifferent(coche === true)}
            />
            {t('ventes:dossier.nouveau.clientConducteur.activer')}
          </label>
          {conducteurDifferent ? (
            <SelecteurClientDossier
              valeur={clientConducteur?.id ?? null}
              onChangeValeur={(_id, client) => setClientConducteur(client)}
              libelle={t('ventes:dossier.nouveau.clientConducteur.titre')}
            />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dossier-vente-date-livraison">
              {t('ventes:dossier.nouveau.dateLivraisonEstimee')}
            </Label>
            <DateInput
              id="dossier-vente-date-livraison"
              value={dateLivraisonEstimee}
              onChange={(valeurISO: string | undefined) => setDateLivraisonEstimee(valeurISO ?? '')}
            />
          </div>
        </CardContent>
      </Card>

      {creation.erreurActive && creation.confirmationsRequises.length === 0 ? (
        <RefusBloquant
          code={creation.erreurActive.probleme.code}
          blocages={creation.erreurActive.blocages}
          actionsProposees={creation.erreurActive.actionsProposees}
        />
      ) : null}

      {/* Erreur réseau ou inattendue (ni `ErreurApi`, donc `erreurActive` reste `null`) — même
       *  repli que `EcranFicheArticle` : un message court plutôt qu'un `RefusBloquant` qui exige un
       *  `CodeErreur` connu. */}
      {creation.erreur && !creation.erreurActive ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(creation.erreur, t)}
        </p>
      ) : null}

      {/* CONFIRMATION_REQUISE (§4.4) : même patron que `FormulaireNouvelOrdreReparation` — prompt
       *  inline puis modal, un accord explicite plutôt qu'un second clic silencieux. */}
      {creation.confirmationsRequises.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-statut-attention bg-statut-attention-fond p-3"
        >
          <p className="texte-corps text-statut-attention">
            {creation.erreurActive ? messageErreur(creation.erreurActive, t) : ''}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            onClick={() => setConfirmationOuverte(true)}
          >
            {t('commun:actions.continuerQuandMeme')}
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link
            to={site ? `/ventes/dossiers?site=${encodeURIComponent(site)}` : '/ventes/dossiers'}
          >
            {t('commun:actions.annuler')}
          </Link>
        </Button>
        <Button disabled={!peutSoumettre} onClick={soumettre}>
          {t('ventes:dossier.nouveau.creer')}
        </Button>
      </div>

      <AvertissementConfirmable
        ouvert={confirmationOuverte}
        onOuvertChange={setConfirmationOuverte}
        titre={t('ventes:dossier.nouveau.titre')}
        description={creation.erreurActive ? messageErreur(creation.erreurActive, t) : ''}
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() => {
          setConfirmationOuverte(false);
          creation.confirmerEtResoumettre({
            onSuccess: (dossier) => navigate(chemins.ventes.dossiers.detail(dossier.id, site)),
          });
        }}
        enCours={creation.enCours}
      />
    </div>
  );
}
