import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

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
import { peutLireDossierVente } from '@/ecrans/ventes/dossiers/droits';
import { listerDocumentsVente } from '@/hooks/facturation/documents-vente.api';
import { listerDepotsPneusVehicule } from '@/hooks/pneus/depot-pneus.api';
import { useSession } from '@/hooks/useSession';
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

  // RF-115 : `admin` n'a AUCUN droit `ventes.*` — un refus de droit (403) n'est pas une absence de
  // donnée, les deux ne doivent jamais partager le même rendu (règle du dépôt : « on ne sait pas »,
  // « il n'y en a pas » et « tu n'as pas le droit » ne partagent jamais le même rendu). Même
  // correctif exact que `EcranFicheClient.tsx` (défaut mesuré identique côté client : un rôle sans
  // droit martelait `GET /dossiers-vente` en 403 en boucle, TanStack Query réessayant par défaut un
  // état qui ne se résoudra jamais, jusqu'à ce que la section disparaisse silencieusement).
  // `peutLireDossierVente` (ecrans/ventes/dossiers/droits.ts) décide AVANT d'émettre la requête —
  // gate via `enabled`, zéro requête pour un rôle qui n'a pas le droit — et
  // `useListeDossiersVente` applique déjà `useDoitReessayer()` en interne (un 403/404 stable n'est
  // jamais réessayé, même si le calcul front divergeait du serveur). Tant que la session n'est pas
  // résolue, `session.data` vaut `undefined` et `peutLireDossierVente(undefined)` renvoie `false` :
  // la section affiche son squelette de chargement (`session.isLoading`) plutôt que de flasher le
  // message de refus avant de savoir — voir le rendu de la section plus bas.
  const session = useSession();
  const peutVoirDossiersVente = peutLireDossierVente(session.data?.utilisateur.role);

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
  // (hooks/ventes/dossiers/, déjà existant) accepte `vehiculeId` tel quel dans son filtre gelé
  // (`FiltresDossiersVente`) ET porte une option `enabled` dédiée précisément à ce correctif (voir
  // son en-tête : « évite d'émettre une requête vouée à un 403 stable ») — le correctif réutilise
  // ce hook plutôt que le `useQuery` local qu'utilisaient les autres sous-collections de cette
  // fiche (`requeteOr`/`requeteFactures`/`requeteDepotsPneus`), car lui seul porte déjà la
  // politique de réessai `useDoitReessayer()` attendue ici.
  const requeteDossiersVente = useListeDossiersVente(
    { vehiculeId, tri: 'prospectionLe:desc' },
    { enabled: Boolean(vehiculeId) && peutVoirDossiersVente },
  );

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

  // « le lien qui manque le plus tous les jours » (magasinier) menait à `/pneus` sans jamais
  // désigner LEQUEL des jeux du véhicule regarder — retrouver la bonne case demandait de refaire
  // une recherche visuelle dans le local. `chemins.pneus.hangar` (`routes/chemins.ts`, hors
  // périmètre d'écriture exclusif de cet agent) n'a pas de troisième paramètre `depot` : le chemin
  // est donc complété ICI plutôt que d'éditer `routes/`. `EcranHangarPneus.tsx` lit `?depot=` avec
  // la même mécanique que `?site=`/`?onglet=` (voir sa note de tête) et fait défiler jusqu'à la
  // carte correspondante, focus au clavier compris — jamais un filtre qui masquerait le reste du
  // local.
  function cheminHangarPourDepot(depotId: string): string {
    const base = chemins.pneus.hangar(site);
    return `${base}${base.includes('?') ? '&' : '?'}depot=${encodeURIComponent(depotId)}`;
  }

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
       *  le client, pas sur un « dossier n°x » qui n'existe pas côté serveur.
       *
       *  Défaut corrigé (mesuré en navigateur, connecté `admin` — rôle SANS `ventes.dossier.lire`,
       *  RF-115) : la requête partait sans garde de droits ni politique de réessai — six requêtes
       *  `GET /dossiers-vente` en moins de dix secondes, toutes en 403, jamais arrêtées, puis la
       *  section entière disparaissait en silence (un refus de droit rendu comme une absence de
       *  donnée). `peutVoirDossiersVente` gate désormais la requête elle-même (voir sa définition
       *  plus haut) : zéro requête pour un rôle qui n'a pas le droit, et les trois états —
       *  chargement de la session, droit manquant, résultat — restent chacun DISTINCTS, même
       *  doctrine que les sections « Pneus »/« OR »/« Factures » ci-dessous. */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('vehicules:fiche.dossierVente.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {session.isLoading ? (
            <EtatChargement lignes={2} />
          ) : !peutVoirDossiersVente ? (
            <p className="texte-corps text-muted-foreground">
              {t('vehicules:fiche.dossierVente.droitRequis')}
            </p>
          ) : requeteDossiersVente.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteDossiersVente.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteDossiersVente.error, t)}
              onReessayer={() => void requeteDossiersVente.refetch()}
            />
          ) : dossiersVente.length === 0 ? (
            <EtatVide
              titre={t('vehicules:fiche.dossierVente.titre')}
              description={t('vehicules:fiche.dossierVente.vide')}
            />
          ) : (
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
          )}
        </CardContent>
      </Card>

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
                <li
                  key={depot.id}
                  className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="texte-corps text-foreground">
                      {t(`pneus:saison.${depot.saison}`)}
                    </span>
                    <span className="texte-libelle text-muted-foreground">
                      {depot.codeCase
                        ? t('vehicules:fiche.pneus.emplacement', { emplacement: depot.codeCase })
                        : t('vehicules:fiche.pneus.emplacementNonRenseigne')}
                    </span>
                  </div>
                  <Link
                    to={cheminHangarPourDepot(depot.id)}
                    className="texte-libelle font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {t('vehicules:fiche.pneus.lienHangar')}
                  </Link>
                </li>
              ))}
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
