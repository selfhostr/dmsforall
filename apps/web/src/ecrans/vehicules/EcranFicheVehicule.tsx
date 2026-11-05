import { useQuery } from '@tanstack/react-query';
import { Link2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import type { FiltresDocumentsVente, VehiculeResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { BlocDonneesAtelier } from '@/composants/vehicule/BlocDonneesAtelier';
import { BlocEcheances } from '@/composants/vehicule/BlocEcheances';
import { EncartAlertesVehicule } from '@/composants/vehicule/EncartAlertesVehicule';
import { FriseDetentions } from '@/composants/vehicule/FriseDetentions';
import { FriseKilometrage } from '@/composants/vehicule/FriseKilometrage';
import { BadgeStatutDossierVente } from '@/ecrans/ventes/dossiers/BadgeStatutDossierVente';
import { peutLireDossierVente } from '@/ecrans/ventes/dossiers/droits';
import { listerOrdresReparation } from '@/hooks/atelier/ordres-reparation.api';
import { listerDocumentsVente } from '@/hooks/facturation/documents-vente.api';
import { useDoitReessayer } from '@/hooks/pagination-curseur';
import { listerDepotsPneusVehicule } from '@/hooks/pneus/depot-pneus.api';
import { useSession } from '@/hooks/useSession';
import { useContexteAtelier } from '@/hooks/vehicules/useContexteAtelier';
import { useDetentionsVehicule } from '@/hooks/vehicules/useDetentionsVehicule';
import { useKilometragesVehicule } from '@/hooks/vehicules/useKilometragesVehicule';
import { useVehicule } from '@/hooks/vehicules/useVehicule';
import { useListeDossiersVente } from '@/hooks/ventes/dossiers/useListeDossiersVente';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { DialogueRattacherClient } from './DialogueRattacherClient';
import { peutLireOrdresReparation } from './droits';
import { EnTeteFicheVehicule } from './EnTeteFicheVehicule';
import { FormulaireKilometrage } from './FormulaireKilometrage';
import { PanneauTravauxReportes } from './PanneauTravauxReportes';
import { SectionRendezVousVehicule } from './SectionRendezVousVehicule';

/** Miroir de `SEUIL_DESIGNATIONS_APERCU` (`apps/api/src/atelier/service-or.ts`) — non exporté par
 *  `@dfa/shared`. `designationsApercu` n'atteint jamais plus de trois entrées ; si la longueur
 *  reçue touche ce seuil, on ne peut pas savoir si d'autres désignations existent (le contrat ne
 *  porte pas de compte exact des lignes valides) — l'aperçu se signale alors comme tel plutôt que
 *  de se faire passer pour la liste complète. */
const SEUIL_DESIGNATIONS_APERCU_FRONT = 3;

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
  const [rattacherOuvert, setRattacherOuvert] = useState(false);

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
  // DÉFAUT CORRIGÉ (issue #162, 16.08.2026) : même motif que `peutVoirDossiersVente` ci-dessus,
  // repéré ici en cherchant s'il se répétait ailleurs dans cet écran — il se répétait. Un rôle
  // sans `atelier.or.lire` (ex. `vendeur`) laissait cette section « Ordres de réparation » en
  // squelette de chargement indéfiniment (403 stable, réessayé par défaut, jamais transformé en
  // état affichable).
  const peutVoirOrdresReparation = peutLireOrdresReparation(session.data?.utilisateur.role);
  const reessayerOr = useDoitReessayer();

  // Lot B (`docs/plan-refonte-navigation.md`) — « ses OR », via la fonction de transport
  // (`vehiculeId` désormais sérialisé, défaut réparé — voir `ordres-reparation.api.ts`).
  const requeteOr = useQuery({
    queryKey: ['vehicule-ordres-reparation', vehiculeId],
    queryFn: async () => {
      const page = await listerOrdresReparation(
        { vehiculeId, tri: 'ouvertLe:desc' },
        { limite: 20 },
      );
      return page.donnees;
    },
    enabled: vehiculeId !== undefined && peutVoirOrdresReparation,
    retry: reessayerOr,
  });

  // « ses factures » — `listerDocumentsVente` (hooks/facturation/) sérialise déjà `vehiculeId`
  // (`FiltresDocumentsVente`, contrat gelé) : rien à contourner ici, contrairement à la requête OR
  // ci-dessus. `useQuery` local plutôt que le hook `useListeDocumentsVente` (pagination infinie,
  // sans option `enabled`) — même raisonnement que `EcranFicheOrdreReparation.tsx`.
  //
  // CORRIGE issue #59 : `typeDocument` était absent d'office — `devis`/`bon_commande`/`facture`
  // remontaient TOUS sous une carte intitulée « Factures », fabriquant l'illusion d'un doublon de
  // numérotation (un devis et une facture ne partagent jamais la même série). `typeDocument:
  // ['facture']` MÊME convention que partout ailleurs dans le dépôt où « facture » est filtré
  // explicitement (`EcranListeFactures.tsx`, `useFacturesOuvertesClient.ts`,
  // `TableauBordComptable.tsx`) — un `avoir` (série ET numérotation propres, `MD-14`) en est
  // exclu au même titre qu'un devis, pas seulement les documents de pré-vente. Filtre appliqué
  // RÉELLEMENT au SQL, pas seulement accepté par le contrat (`ServiceDocumentsVente.lister`,
  // `apps/api/src/facturation/documents/service-documents.ts` : `inArray(documentVente
  // .typeDocument, filtres.typeDocument)`), vérifié en exécution réelle (voir rapport de
  // livraison) plutôt que supposé du contrat seul.
  //
  // Un devis EN COURS n'est pas perdu pour autant : la carte « Dossier de vente » ci-dessous
  // (`requeteDossiersVente`, même écran) couvre déjà cette affaire en attente — statut affiché via
  // `BadgeStatutDossierVente`, lien vers le dossier complet. Dupliquer cette information sous
  // « Factures » réintroduirait exactement la confusion signalée plutôt que de la corriger ; le
  // titre de la carte reste donc inchangé, aucun second bloc ni renommage n'est nécessaire.
  const requeteFactures = useQuery({
    queryKey: ['vehicule-documents-vente', vehiculeId],
    queryFn: () => {
      const filtres: FiltresDocumentsVente = {
        vehiculeId,
        typeDocument: ['facture'],
        tri: 'dateDocument:desc',
      };
      return listerDocumentsVente(filtres, { limite: 20 });
    },
    enabled: vehiculeId !== undefined,
  });

  // « son jeu de pneus au dépôt et son emplacement » — `listerDepotsPneusVehicule`
  // (hooks/pneus/depot-pneus.api.ts) existe déjà (route `GET /vehicules/{id}/depots-pneus`) mais
  // n'était consommée par aucun hook React Query à ce jour (seul le hangar l'était) : appelée ICI
  // directement, sans créer de nouveau fichier `hooks/pneus/useDepotsPneusVehicule.ts` (hors du
  // périmètre d'écriture exclusif de ce lot). Statuts ACTIFS uniquement (`en_depot`/
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

  // `titreVisible={false}` FORCÉ (contredit la détection automatique, qui laisserait ce h1
  // visible : « Fiche véhicule » ne recoupe aucun libellé de navigation). Mesuré : ce n'est pas
  // l'onglet qui fait doublon ici mais le CONTENU — `EnTeteFicheVehicule` affiche déjà, juste sous
  // ce même en-tête, la plaque/le VIN en gros caractères (`IdentiteVehicule`, taille `xl`). Rendre
  // ce h1 visible empilerait un second titre générique au-dessus d'une identité déjà affichée —
  // même doctrine que `EcranFicheOrdreReparation.tsx`/`EcranFicheClient.tsx`. Comportement inchangé
  // sur le fond (déjà `sr-only` avant ce chantier), désormais uniforme sur les trois états
  // (chargement/erreur/contenu) via le gabarit commun.
  if (requeteVehicule.isPending || requeteContexte.isPending) {
    return (
      <GabaritEcran titre={t('commun:titres.vehiculeDetail')} titreVisible={false}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (requeteVehicule.isError || requeteContexte.isError) {
    const erreur = requeteVehicule.error ?? requeteContexte.error;
    return (
      <GabaritEcran titre={t('commun:titres.vehiculeDetail')} titreVisible={false}>
        <EtatErreur
          titre={t('vehicules:fiche.erreur.titre')}
          description={messageErreur(erreur, t)}
          onReessayer={() => {
            void requeteVehicule.refetch();
            void requeteContexte.refetch();
          }}
        />
      </GabaritEcran>
    );
  }

  const vehicule = requeteVehicule.data;
  const contexte = requeteContexte.data;

  // Lot B — « propriétaire · détenteurs précédents ». `FriseDetentions` (`composants/vehicule/`,
  // hors périmètre exclusif de ce lot) rend déjà l'historique visuellement mais aucune entrée
  // n'y est cliquable — étendre son interface n'est pas dans le périmètre annoncé de ce chantier.
  // Ce bloc-ci consomme la MÊME donnée déjà chargée (`requeteDetentions`, aucune requête
  // supplémentaire) pour offrir le lien manquant, en complément de la frise plutôt qu'à sa place.
  const detentions = requeteDetentions.data ?? [];
  const proprietaireActuel = detentions.find((detention) => detention.finLe === null) ?? null;
  const detenteursPrecedents = detentions.filter((detention) => detention.finLe !== null);

  // `DialogueNouveauRendezVous.site` (composants/rendez-vous/) est obligatoire (un `SiteResume`
  // complet, pas juste un id) — même repli que `TableauBordMagasinier.tsx` (site actif du tenant,
  // sinon le premier) quand la fiche est ouverte sans `?site=` explicite.
  const siteRendezVous = site
    ? session.data?.sites.find((candidat) => candidat.id === site)
    : (session.data?.sites.find((candidat) => candidat.actif) ?? session.data?.sites[0]);

  // Projection `VehiculeResume` depuis `ReponseVehicule` (fiche complète) — `DialogueNouveauRendezVous`
  // et `IdentiteVehicule` n'attendent que le résumé, même doctrine que `clientPourIdentite` dans
  // `EcranFicheClient.tsx`.
  const vehiculePourRendezVous: VehiculeResume = {
    id: vehicule.id,
    plaque: vehicule.plaque,
    canton: vehicule.canton,
    designation: vehicule.designation,
    vin: vehicule.vin,
    premiereMiseEnCirculationLe: vehicule.premiereMiseEnCirculationLe,
    identificationIncomplete: vehicule.identificationIncomplete,
    emplacementLibre: vehicule.emplacementLibre,
  };

  const ordresVehicule = requeteOr.data ?? [];
  const facturesVehicule = requeteFactures.data?.donnees ?? [];
  const depotsPneus = requeteDepotsPneus.data?.donnees ?? [];
  const dossiersVente = requeteDossiersVente.dossiers;

  // « le lien qui manque le plus tous les jours » (magasinier) menait à `/pneus` sans jamais
  // désigner LEQUEL des jeux du véhicule regarder — retrouver la bonne case demandait de refaire
  // une recherche visuelle dans le local. `chemins.pneus.hangar` (`routes/chemins.ts`, hors
  // périmètre d'écriture exclusif de ce lot) n'a pas de troisième paramètre `depot` : le chemin
  // est donc complété ICI plutôt que d'éditer `routes/`. `EcranHangarPneus.tsx` lit `?depot=` avec
  // la même mécanique que `?site=`/`?onglet=` (voir sa note de tête) et fait défiler jusqu'à la
  // carte correspondante, focus au clavier compris — jamais un filtre qui masquerait le reste du
  // local.
  function cheminHangarPourDepot(depotId: string): string {
    const base = chemins.pneus.hangar(site);
    return `${base}${base.includes('?') ? '&' : '?'}depot=${encodeURIComponent(depotId)}`;
  }

  // Fil d'Ariane contextuel (chantier « un seul patron », 24.08.2026) — même dispositif que
  // `EnTeteOrdreReparation.tsx` (« client › véhicule »), pris ici comme modèle : « pour un
  // véhicule, la chaîne client › véhicule a un sens réel ». Un véhicule SANS détenteur courant
  // (occasion pas encore rattachée, cas réel couvert par `DialogueRattacherClient`) n'a aucun
  // ancêtre cliquable — jamais un client inventé, le fil se réduit alors à la seule page courante.
  const libellePageVehicule = vehicule.plaque
    ? `${vehicule.plaque} · ${vehicule.designation}`
    : vehicule.designation;
  const segmentsFilAriane: readonly SegmentFilAriane[] = proprietaireActuel
    ? [
        {
          cle: 'client',
          libelle: proprietaireActuel.client.nomAffiche,
          href: chemins.clients.detail(proprietaireActuel.client.id, site),
        },
      ]
    : [];

  return (
    <GabaritEcran titre={t('commun:titres.vehiculeDetail')} titreVisible={false}>
      <FilAriane segments={segmentsFilAriane} pageCourante={libellePageVehicule} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <EnTeteFicheVehicule vehicule={vehicule} dernierKilometrage={contexte.dernierKilometrage} />
        {/* Lot B — action primaire « nouvel OR » depuis la fiche véhicule. CORRECTIF issue #48 :
         *  `vehiculeId` (le véhicule DÉJÀ affiché à l'écran) est désormais transmis en plus de
         *  `clientId` — `EcranNouvelOrdreReparation` (périmètre atelier, corrigé au même lot) le lit
         *  pour présélectionner ce véhicule via `SelecteurVehiculeOrdre` plutôt que de faire
         *  rechoisir parmi TOUS les véhicules du client (dont d'autres sans rapport avec cette
         *  fiche). Le choix reste modifiable sur l'écran suivant : un véhicule peut être amené par
         *  quelqu'un d'autre que son détenteur (cas réel en garage). */}
        <Button
          type="button"
          onClick={() =>
            navigate(
              proprietaireActuel
                ? `/atelier/ordres-reparation/nouveau?clientId=${encodeURIComponent(proprietaireActuel.client.id)}&vehiculeId=${encodeURIComponent(vehicule.id)}${site ? `&site=${encodeURIComponent(site)}` : ''}`
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
                className="w-fit text-left texte-corps font-medium text-primary underline-offset-4 hover:underline anneau-focus"
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
                      className="text-left texte-corps text-primary underline-offset-4 hover:underline anneau-focus"
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

      <SectionRendezVousVehicule
        vehicule={vehiculePourRendezVous}
        detenteur={proprietaireActuel?.client ?? null}
        site={siteRendezVous}
      />

      {/* Convergence patron de fiche (chantier « un seul patron », 24.08.2026) : les QUATRE
       *  listes d'activité du véhicule (dossier de vente, pneus, OR, factures) rejoignent un
       *  onglets unique — même dispositif que `EcranFicheClient.tsx` (contacts/adresses/
       *  consentements/notes), désormais convergé plutôt que « quatre onglets ici, zéro onglet
       *  là ». Restent SCINDÉS de ce groupe (panneaux empilés, jamais un clic requis) :
       *  propriétaire, rendez-vous, échéances/données d'atelier, travaux reportés, kilométrage,
       *  détentions — la doctrine « SANS CLIQUER » du comptoir (voir l'en-tête de ce fichier)
       *  s'applique précisément à eux, aucun de ces quatre-là n'en fait partie.
       *
       *  Défaut corrigé (mesuré en navigateur, connecté `admin` — rôle SANS `ventes.dossier.lire`,
       *  RF-115) : la requête « dossier de vente » partait sans garde de droits ni politique de
       *  réessai — six requêtes `GET /dossiers-vente` en moins de dix secondes, toutes en 403,
       *  jamais arrêtées, puis la section entière disparaissait en silence (un refus de droit
       *  rendu comme une absence de donnée). `peutVoirDossiersVente` gate désormais la requête
       *  elle-même (voir sa définition plus haut) : zéro requête pour un rôle qui n'a pas le
       *  droit, et les trois états — chargement de la session, droit manquant, résultat — restent
       *  chacun DISTINCTS, même doctrine que « OR » ci-dessous. */}
      <Tabs defaultValue="dossierVente">
        <TabsList>
          <TabsTrigger value="dossierVente">{t('vehicules:fiche.dossierVente.titre')}</TabsTrigger>
          <TabsTrigger value="pneus">{t('vehicules:fiche.pneus.titre')}</TabsTrigger>
          <TabsTrigger value="or">{t('vehicules:fiche.ordresReparation.titre')}</TabsTrigger>
          <TabsTrigger value="factures">{t('vehicules:fiche.factures.titre')}</TabsTrigger>
        </TabsList>

        <TabsContent value="dossierVente" className="pt-4">
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
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline anneau-focus"
                    onClick={() => navigate(chemins.ventes.dossiers.detail(dossier.id, site))}
                  >
                    {dossier.clientAcheteur.nomAffiche}
                  </button>
                  <BadgeStatutDossierVente statut={dossier.statut} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Lot B — jeu de pneus au dépôt et son emplacement (magasinier : « le lien qui manque le
         *  plus tous les jours », condition posée pour accepter le déménagement du dépôt pneus
         *  vers Atelier). Lien vers le hangar (aucune fiche par jeu dédiée à ce jour). */}
        <TabsContent value="pneus" className="pt-4">
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
                    className="texte-libelle font-medium text-primary underline-offset-4 hover:underline anneau-focus"
                  >
                    {t('vehicules:fiche.pneus.lienHangar')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Lot B — ses OR. */}
        <TabsContent value="or" className="pt-4">
          {session.isLoading ? (
            <EtatChargement lignes={2} />
          ) : !peutVoirOrdresReparation ? (
            <p className="texte-corps text-muted-foreground">
              {t('vehicules:fiche.ordresReparation.droitRequis')}
            </p>
          ) : requeteOr.isPending ? (
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
                <li key={or.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="text-left texte-corps text-primary underline-offset-4 hover:underline anneau-focus"
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
                  </div>
                  {/* CORRECTIF issue #82 (rapport terrain réceptionniste) : cette liste ne disait
                   *  jamais CE QUI avait été fait sur l'OR, obligeant à ouvrir chaque ordre un par
                   *  un pour répondre au client. `designationsApercu` (§82, `@dfa/shared`) est
                   *  BORNÉ à `SEUIL_DESIGNATIONS_APERCU` côté serveur (actuellement 3, dupliqué ici
                   *  faute d'export partagé — même limite que celle déjà dupliquée par
                   *  `EcranListeOrdresReparation.tsx`) et exclut déjà les lignes annulées/refusées.
                   *  Tableau vide (OR sans ligne facturable) : aucune ligne n'est rendue, jamais une
                   *  virgule orpheline. `nombreLignes` mélange les lignes annulées et n'est donc PAS
                   *  un signal fiable de troncature — seul le fait d'atteindre le seuil de 3 l'est. */}
                  {or.designationsApercu && or.designationsApercu.length > 0 ? (
                    <p className="texte-libelle text-muted-foreground">
                      {t(
                        or.designationsApercu.length >= SEUIL_DESIGNATIONS_APERCU_FRONT
                          ? 'vehicules:fiche.ordresReparation.designationsTronquees'
                          : 'vehicules:fiche.ordresReparation.designations',
                        { liste: or.designationsApercu.join(', ') },
                      )}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Lot B — ses factures. */}
        <TabsContent value="factures" className="pt-4">
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
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline anneau-focus"
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
        </TabsContent>
      </Tabs>

      {/* DESIGN.md grief n°2 — `items-start` : `BlocEcheances` (échéance expertise + 2 garanties,
       *  hauteur quasi fixe) et `BlocDonneesAtelier` (0 à 9 champs selon ce qui est renseigné,
       *  jusqu'à l'état vide) ont des hauteurs structurellement différentes ; sans `items-start`,
       *  la grille CSS étirerait la plus courte à la hauteur de sa voisine — même défaut que celui
       *  déjà corrigé sur `TableauBordDirection.tsx`/`EcranFicheOrdreReparation.tsx` (atelier). Les
       *  deux blocs restent de simples `Card` (contenu variable, jamais `compact`) : c'est
       *  l'écart de hauteur réel entre eux qui justifie `items-start` ici, pas la densité. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
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
       *  SIGNALÉ, PAS CORRIGÉ (Lot B, hors périmètre exclusif de ce lot) : le plan demande
       *  « travaux reportés avec ouvrir un OR à partir de ces travaux » — `PanneauTravauxReportes.tsx`
       *  n'a aujourd'hui aucun tel geste et vit hors de la liste de fichiers confiée à ce lot
       *  (seul `EcranFicheVehicule.tsx` y figure). À ajouter par le lot propriétaire de ce
       *  composant. */}
      {vehiculeId ? <PanneauTravauxReportes vehiculeId={vehiculeId} /> : null}

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
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="texte-titre-section">{t('vehicules:detentions.titre')}</CardTitle>
          {/* Geste manquant signalé par @laupernoe : « je ne sais pas comment assigner un véhicule à un
           *  client ». `POST /changer-detenteur` (RM-20/21) couvre les deux cas d'un seul bouton —
           *  aucun détenteur courant (« Rattacher à un client ») ou détenteur existant (« Changer
           *  de détenteur », occasion revendue) — voir `DialogueRattacherClient.tsx`. */}
          <Button type="button" variant="outline" onClick={() => setRattacherOuvert(true)}>
            <Link2 aria-hidden className="h-4 w-4" />
            {t(
              proprietaireActuel
                ? 'vehicules:detentions.changer'
                : 'vehicules:detentions.rattacher',
            )}
          </Button>
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
        <>
          <FormulaireKilometrage
            vehiculeId={vehiculeId}
            ouvert={formulaireKmOuvert}
            onOuvertChange={setFormulaireKmOuvert}
          />
          <DialogueRattacherClient
            vehiculeId={vehiculeId}
            detenteurActuel={proprietaireActuel ? proprietaireActuel.client : null}
            ouvert={rattacherOuvert}
            onOuvertChange={setRattacherOuvert}
          />
        </>
      ) : null}
    </GabaritEcran>
  );
}
