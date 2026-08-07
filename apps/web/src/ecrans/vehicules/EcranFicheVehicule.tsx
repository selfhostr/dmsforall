import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { FiltresDocumentsVente, OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { BlocDonneesAtelier } from '@/composants/vehicule/BlocDonneesAtelier';
import { BlocEcheances } from '@/composants/vehicule/BlocEcheances';
import { EncartAlertesVehicule } from '@/composants/vehicule/EncartAlertesVehicule';
import { FriseDetentions } from '@/composants/vehicule/FriseDetentions';
import { FriseKilometrage } from '@/composants/vehicule/FriseKilometrage';
import { BadgeStatutDossierVente } from '@/ecrans/ventes/dossiers/BadgeStatutDossierVente';
import { listerDocumentsVente } from '@/hooks/facturation/documents-vente.api';
import { listerDepotsPneusVehicule } from '@/hooks/pneus/depot-pneus.api';
import { useContexteAtelier } from '@/hooks/vehicules/useContexteAtelier';
import { useDetentionsVehicule } from '@/hooks/vehicules/useDetentionsVehicule';
import { useKilometragesVehicule } from '@/hooks/vehicules/useKilometragesVehicule';
import { useVehicule } from '@/hooks/vehicules/useVehicule';
import { useListeDossiersVente } from '@/hooks/ventes/dossiers/useListeDossiersVente';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { EnTeteFicheVehicule } from './EnTeteFicheVehicule';
import { FormulaireKilometrage } from './FormulaireKilometrage';
import { PanneauTravauxReportes } from './PanneauTravauxReportes';

/**
 * Fiche véhicule — ce que le comptoir doit voir en ouvrant un dossier : identité, alertes SANS
 * CLIQUER (`EncartAlertesVehicule`, alimenté par `contexte-atelier`), échéances, données
 * d'atelier, travaux reportés, historiques kilométrage/détention.
 *
 * Deux requêtes PRIMAIRES bloquent l'écran entier (véhicule + contexte-atelier, la donnée qui
 * fait la valeur du produit) ; kilométrages et détentions sont SECONDAIRES et gèrent leur
 * chargement/erreur par section, pour qu'un historique en échec n'empêche jamais de voir les
 * alertes.
 */
export function EcranFicheVehicule() {
  const { t } = useTranslation(['vehicules', 'commun', 'pneus']);
  const { vehiculeId } = useParams<{ vehiculeId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const [formulaireKmOuvert, setFormulaireKmOuvert] = useState(false);

  const requeteVehicule = useVehicule(vehiculeId);
  const requeteContexte = useContexteAtelier(vehiculeId);
  const requeteKilometrages = useKilometragesVehicule(vehiculeId);
  const requeteDetentions = useDetentionsVehicule(vehiculeId);

  // Lot B (`docs/plan-refonte-navigation.md`) — « ses OR ». `listerOrdresReparation`
  // (hooks/atelier/ordres-reparation.api.ts, hors périmètre) ne sérialise QUE `q`/`statut`/
  // `siteId`/`tri` dans son `URLSearchParams` : `vehiculeId` y serait silencieusement ignoré côté
  // client bien que le serveur le supporte (`schemaFiltresOrdresReparation.vehiculeId`). Requête
  // construite ICI, même doctrine que `EnTeteOrdreReparation.tsx` (« l'OR précédent »).
  const requeteOr = useQuery({
    queryKey: ['vehicule-ordres-reparation', vehiculeId],
    queryFn: async () => {
      const parametres = new URLSearchParams({
        vehiculeId: vehiculeId as string,
        tri: 'ouvertLe:desc',
        limite: '20',
      });
      const page = await requeteApi<PageCurseur<OrdreReparationResume>>(
        `/ordres-reparation?${parametres.toString()}`,
        { method: 'GET' },
      );
      return page?.donnees ?? [];
    },
    enabled: vehiculeId !== undefined,
  });

  // « ses factures » — `listerDocumentsVente` (hooks/facturation/) sérialise déjà `vehiculeId`
  // (`FiltresDocumentsVente`, contrat gelé) : rien à contourner ici, contrairement à la requête OR
  // ci-dessus. `useQuery` local plutôt que le hook `useListeDocumentsVente` (pagination infinie,
  // sans option `enabled`) — même raisonnement que `EcranFicheOrdreReparation.tsx`.
  const requeteFactures = useQuery({
    queryKey: ['vehicule-documents-vente', vehiculeId],
    queryFn: () => {
      const filtres: FiltresDocumentsVente = { vehiculeId, tri: 'dateDocument:desc' };
      return listerDocumentsVente(filtres, { limite: 20 });
    },
    enabled: vehiculeId !== undefined,
  });

  // « son jeu de pneus au dépôt et son emplacement » — `listerDepotsPneusVehicule`
  // (hooks/pneus/depot-pneus.api.ts) existe déjà (route `GET /vehicules/{id}/depots-pneus`) mais
  // n'était consommée par aucun hook React Query à ce jour (seul le hangar l'était) : appelée ICI
  // directement, sans créer de nouveau fichier `hooks/pneus/useDepotsPneusVehicule.ts` (hors du
  // périmètre d'écriture exclusif de cet agent). Statuts ACTIFS uniquement (`en_depot`/
  // `a_relancer`) — un jeu `monte` est sur le véhicule, pas « au dépôt » ; `sorti` est un historique
  // terminal, pas une présence actuelle.
  const requeteDepotsPneus = useQuery({
    queryKey: ['vehicule-depots-pneus', vehiculeId],
    queryFn: () =>
      listerDepotsPneusVehicule(
        vehiculeId as string,
        { statut: ['en_depot', 'a_relancer'], tri: 'entreLe:desc' },
        { limite: 10 },
      ),
    enabled: vehiculeId !== undefined,
  });

  // « dossier de vente en cours ou passé » (correction 6, vendeur) — `useListeDossiersVente`
  // (hooks/ventes/dossiers/, déjà existant) accepte `vehiculeId` tel quel dans son filtre gelé.
  const requeteDossiersVente = useListeDossiersVente({
    vehiculeId,
    tri: 'prospectionLe:desc',
  });

  if (requeteVehicule.isPending || requeteContexte.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('commun:titres.vehiculeDetail')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requeteVehicule.isError || requeteContexte.isError) {
    const erreur = requeteVehicule.error ?? requeteContexte.error;
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('commun:titres.vehiculeDetail')}</h1>
        <EtatErreur
          titre={t('vehicules:fiche.erreur.titre')}
          description={messageErreur(erreur, t)}
          onReessayer={() => {
            void requeteVehicule.refetch();
            void requeteContexte.refetch();
          }}
        />
      </div>
    );
  }

  const vehicule = requeteVehicule.data;
  const contexte = requeteContexte.data;

  // Lot B — « propriétaire · détenteurs précédents ». `FriseDetentions` (`composants/vehicule/`,
  // hors périmètre exclusif de cet agent) rend déjà l'historique visuellement mais aucune entrée
  // n'y est cliquable — étendre son interface n'est pas dans le périmètre annoncé de ce chantier.
  // Ce bloc-ci consomme la MÊME donnée déjà chargée (`requeteDetentions`, aucune requête
  // supplémentaire) pour offrir le lien manquant, en complément de la frise plutôt qu'à sa place.
  const detentions = requeteDetentions.data ?? [];
  const proprietaireActuel = detentions.find((detention) => detention.finLe === null) ?? null;
  const detenteursPrecedents = detentions.filter((detention) => detention.finLe !== null);

  const ordresVehicule = requeteOr.data ?? [];
  const facturesVehicule = requeteFactures.data?.donnees ?? [];
  const depotsPneus = requeteDepotsPneus.data?.donnees ?? [];
  const dossiersVente = requeteDossiersVente.dossiers;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t('commun:titres.vehiculeDetail')}</h1>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <EnTeteFicheVehicule vehicule={vehicule} dernierKilometrage={contexte.dernierKilometrage} />
        {/* Lot B — action primaire « nouvel OR » depuis la fiche véhicule. `EcranNouvelOrdreReparation`
         *  ne lit aujourd'hui que `clientId`/`site` en paramètres de requête (aucun `vehiculeId` —
         *  écran hors du périmètre exclusif de cet agent, signalé plutôt que modifié) : le
         *  technicien devra encore chercher/sélectionner le véhicule une fois sur cet écran si le
         *  propriétaire actuel n'est pas connu, mais le geste part bien d'ici. */}
        <Button
          type="button"
          onClick={() =>
            navigate(
              proprietaireActuel
                ? `/atelier/ordres-reparation/nouveau?clientId=${encodeURIComponent(proprietaireActuel.client.id)}${site ? `&site=${encodeURIComponent(site)}` : ''}`
                : `/atelier/ordres-reparation/nouveau${site ? `?site=${encodeURIComponent(site)}` : ''}`,
            )
          }
        >
          <Wrench aria-hidden className="h-4 w-4" />
          {t('vehicules:fiche.actions.nouvelOr')}
        </Button>
      </div>

      <EncartAlertesVehicule
        travauxReportes={contexte.travauxReportes}
        campagnesOuvertes={contexte.campagnesOuvertes}
        expertise={contexte.expertise}
        garantie={contexte.garantie}
        importe={contexte.vehicule.importe}
        alertesClient={contexte.alertesClient}
      />

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('vehicules:fiche.proprietaire.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {proprietaireActuel ? (
            <div className="flex flex-col gap-1">
              <span className="texte-libelle text-muted-foreground">
                {t('vehicules:fiche.proprietaire.actuel')}
              </span>
              <button
                type="button"
                className="w-fit text-left texte-corps font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => navigate(chemins.clients.detail(proprietaireActuel.client.id, site))}
              >
                {proprietaireActuel.client.nomAffiche} · {proprietaireActuel.client.numeroClient}
              </button>
            </div>
          ) : (
            <p className="texte-corps text-muted-foreground">
              {t('vehicules:fiche.proprietaire.vide')}
            </p>
          )}
          {detenteursPrecedents.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t pt-3">
              <span className="texte-libelle text-muted-foreground">
                {t('vehicules:fiche.proprietaire.precedents')}
              </span>
              <ul className="flex flex-col gap-1">
                {detenteursPrecedents.map((detention) => (
                  <li key={detention.id}>
                    <button
                      type="button"
                      className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => navigate(chemins.clients.detail(detention.client.id, site))}
                    >
                      {detention.client.nomAffiche} · {detention.client.numeroClient}
                    </button>
                    <span className="ml-2 texte-libelle text-muted-foreground">
                      {formaterDate(detention.debutLe)} –{' '}
                      {detention.finLe ? formaterDate(detention.finLe) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Lot B (correction 6, vendeur) — dossier de vente en cours ou passé, si ce véhicule est ou
       *  a été en stock. Le contrat ne porte pas de numéro court identifiable à l'oral pour un
       *  dossier (`EnTeteDossierVente.tsx`, même constat) : le lien s'appuie donc sur le statut et
       *  le client, pas sur un « dossier n°x » qui n'existe pas côté serveur. */}
      {dossiersVente.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('vehicules:fiche.dossierVente.titre')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {dossiersVente.map((dossier) => (
                <li key={dossier.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => navigate(chemins.ventes.dossiers.detail(dossier.id, site))}
                  >
                    {dossier.clientAcheteur.nomAffiche}
                  </button>
                  <BadgeStatutDossierVente statut={dossier.statut} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <BlocEcheances
          expertise={contexte.expertise}
          garantieConstructeur={contexte.garantie.constructeur}
          garantieGarage={contexte.garantie.garage}
        />
        <BlocDonneesAtelier donnees={vehicule} />
      </div>

      {/* Panneau de GESTION (RM-73) — remplace l'ancienne liste en lecture seule alimentée par la
       *  projection bornée de `contexte-atelier` : `EncartAlertesVehicule` ci-dessus couvre déjà le
       *  « sans cliquer » pour les travaux OUVERTS, ce panneau ajoute la correction/clôture/abandon
       *  et l'historique complet (non bornés), depuis la ressource dédiée.
       *  SIGNALÉ, PAS CORRIGÉ (Lot B, hors périmètre exclusif de cet agent) : le plan demande
       *  « travaux reportés avec ouvrir un OR à partir de ces travaux » — `PanneauTravauxReportes.tsx`
       *  n'a aujourd'hui aucun tel geste et vit hors de la liste de fichiers confiée à cet agent
       *  (seul `EcranFicheVehicule.tsx` y figure). À ajouter par l'agent propriétaire de ce
       *  composant. */}
      {vehiculeId ? <PanneauTravauxReportes vehiculeId={vehiculeId} /> : null}

      {/* Lot B — jeu de pneus au dépôt et son emplacement (magasinier : « le lien qui manque le
       *  plus tous les jours », condition posée pour accepter le déménagement du dépôt pneus vers
       *  Atelier). Lien vers le hangar (aucune fiche par jeu dédiée à ce jour). */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('vehicules:fiche.pneus.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          {requeteDepotsPneus.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteDepotsPneus.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteDepotsPneus.error, t)}
              onReessayer={() => void requeteDepotsPneus.refetch()}
            />
          ) : depotsPneus.length === 0 ? (
            <EtatVide
              titre={t('vehicules:fiche.pneus.titre')}
              description={t('vehicules:fiche.pneus.vide')}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {depotsPneus.map((depot) => (
                <li key={depot.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="texte-corps text-foreground">
                    {t(`pneus:saison.${depot.saison}`)}
                  </span>
                  <span className="texte-libelle text-muted-foreground">
                    {depot.codeCase
                      ? t('vehicules:fiche.pneus.emplacement', { emplacement: depot.codeCase })
                      : t('vehicules:fiche.pneus.emplacementNonRenseigne')}
                  </span>
                </li>
              ))}
              <li className="pt-2">
                <button
                  type="button"
                  className="texte-libelle text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => navigate(chemins.pneus.hangar(site))}
                >
                  {t('vehicules:fiche.pneus.lienHangar')}
                </button>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lot B — ses OR. */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('vehicules:fiche.ordresReparation.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requeteOr.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteOr.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteOr.error, t)}
              onReessayer={() => void requeteOr.refetch()}
            />
          ) : ordresVehicule.length === 0 ? (
            <EtatVide
              titre={t('vehicules:fiche.ordresReparation.titre')}
              description={t('vehicules:fiche.ordresReparation.vide')}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {ordresVehicule.map((or) => (
                <li key={or.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => navigate(chemins.atelier.ordresReparation.detail(or.id, site))}
                  >
                    {or.numero}
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="texte-libelle text-muted-foreground">
                      {or.ouvertLe ? formaterDate(or.ouvertLe) : ''}
                    </span>
                    <BadgeStatutOr etat={or.etatAffiche} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lot B — ses factures. */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('vehicules:fiche.factures.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requeteFactures.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteFactures.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteFactures.error, t)}
              onReessayer={() => void requeteFactures.refetch()}
            />
          ) : facturesVehicule.length === 0 ? (
            <EtatVide
              titre={t('vehicules:fiche.factures.titre')}
              description={t('vehicules:fiche.factures.vide')}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {facturesVehicule.map((document_) => (
                <li key={document_.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => navigate(`/factures/${document_.id}`)}
                  >
                    {document_.numero ?? t('vehicules:fiche.factures.brouillon')}
                  </button>
                  <span className="texte-libelle text-muted-foreground">
                    {formaterDate(document_.dateDocument)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="texte-titre-section">{t('vehicules:kilometrage.titre')}</CardTitle>
          <Button type="button" variant="outline" onClick={() => setFormulaireKmOuvert(true)}>
            {t('vehicules:kilometrage.relever')}
          </Button>
        </CardHeader>
        <CardContent>
          {requeteKilometrages.isPending ? (
            <EtatChargement lignes={3} />
          ) : requeteKilometrages.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteKilometrages.error, t)}
              onReessayer={() => void requeteKilometrages.refetch()}
            />
          ) : (
            <FriseKilometrage releves={requeteKilometrages.data} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('vehicules:detentions.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          {requeteDetentions.isPending ? (
            <EtatChargement lignes={3} />
          ) : requeteDetentions.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteDetentions.error, t)}
              onReessayer={() => void requeteDetentions.refetch()}
            />
          ) : (
            <FriseDetentions detentions={requeteDetentions.data} />
          )}
        </CardContent>
      </Card>

      {vehiculeId ? (
        <FormulaireKilometrage
          vehiculeId={vehiculeId}
          ouvert={formulaireKmOuvert}
          onOuvertChange={setFormulaireKmOuvert}
        />
      ) : null}
    </div>
  );
}
