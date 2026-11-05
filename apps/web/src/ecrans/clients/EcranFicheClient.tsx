import { Plus, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import type { ClientResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { BandeauAlerteClient } from '@/composants/motifs/BandeauAlerteClient';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { BadgeStatutDossierVente } from '@/ecrans/ventes/dossiers/BadgeStatutDossierVente';
// Matrice de droits ventes (RF-115) DUPLIQUÉE côté front, jamais importée depuis `apps/api` —
// voir l'en-tête de `ecrans/ventes/dossiers/droits.ts`. Hors périmètre d'écriture ici
// (`ecrans/ventes/`), import en lecture seulement.
import { peutLireDossierVente } from '@/ecrans/ventes/dossiers/droits';
import { useClient } from '@/hooks/clients/useClient';
import { useOrdresClient } from '@/hooks/clients/useOrdresClient';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { useListeDossiersVente } from '@/hooks/ventes/dossiers/useListeDossiersVente';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { EtatSousCollection } from './onglets/EtatSousCollection';
import { OngletAdresses } from './onglets/OngletAdresses';
import { OngletConditions } from './onglets/OngletConditions';
import { OngletConsentements } from './onglets/OngletConsentements';
import { OngletContacts } from './onglets/OngletContacts';
import { OngletNotes } from './onglets/OngletNotes';
import { SectionRendezVousClient } from './SectionRendezVousClient';
import { texteOuVide } from './utils';

/**
 * État de navigation posé par `EcranListeClients` juste après une création réussie (issue #79,
 * client Rossier : « Connexion impossible », recliqué, « Une erreur s'est produite », le client
 * avait pourtant déjà été créé — CL-000013). `POST /clients` peut réussir sans que l'écran de
 * création le sache si l'accusé de réception se perd (voir le commentaire réseau de
 * `FormulaireNouveauClient.tsx`) ; ICI, le cas mesuré est différent et tout aussi trompeur : la
 * CRÉATION a été confirmée côté front (`onCree` a été appelé), mais la LECTURE `GET /clients/{id}`
 * qui suit immédiatement — déclenchée par cette même navigation — échoue à son tour (nouvelle
 * coupure, latence). Sans ce marqueur, la branche d'erreur ci-dessous ne peut pas distinguer
 * « ce client n'existe pas / erreur d'affichage » de « ce client vient d'être créé, seul
 * l'affichage échoue » — deux informations opposées qui ne doivent jamais partager le même
 * rendu (doctrine du dépôt). `state`, jamais un paramètre d'URL : disparaît sur un rechargement de
 * page ou un lien direct, exactement le comportement voulu (l'information n'est valable que pour
 * CETTE navigation précise, pas pour un retour ultérieur sur la même fiche).
 */
interface EtatNavigationClientCree {
  readonly clientCreeNumero: string;
  readonly clientCreeNom: string;
}

function estEtatNavigationClientCree(valeur: unknown): valeur is EtatNavigationClientCree {
  return (
    typeof valeur === 'object' &&
    valeur !== null &&
    typeof (valeur as Record<string, unknown>).clientCreeNumero === 'string' &&
    typeof (valeur as Record<string, unknown>).clientCreeNom === 'string'
  );
}

/** `chemins.ts` (routes/) n'a pas encore d'entrée Atelier — module en cours de câblage par un
 *  autre agent (périmètre disjoint, voir routeur.tsx : `EcranFonctionAVenir`). Même sémantique que
 *  `construireChemin` : le site n'est ajouté que s'il est déjà défini, jamais inventé — répété ici
 *  plutôt que d'éditer un fichier hors périmètre. */
function cheminOr(id: string, site: string | undefined): string {
  return site
    ? `/ordres-reparation/${id}?site=${encodeURIComponent(site)}`
    : `/ordres-reparation/${id}`;
}

function cheminNouvelOr(clientId: string, site: string | undefined): string {
  const parametres = new URLSearchParams({ clientId });
  if (site) parametres.set('site', site);
  return `/atelier/ordres-reparation/nouveau?${parametres.toString()}`;
}

/** `chemins.vehicules.nouveau` (`routes/chemins.ts`, hors périmètre d'écriture ici) n'accepte
 *  qu'un `?site=` — pas de `clientId`. Même doctrine que `cheminNouvelOr` ci-dessus : le paramètre
 *  manquant se construit localement plutôt que d'éditer un fichier hors périmètre.
 *  `EcranNouveauVehicule.tsx` lit `?clientId=` pour préremplir le détenteur à la création
 *  (`detenteurId`, `POST /vehicules` — geste manquant signalé par @laupernoe : « je ne sais pas comment
 *  assigner un véhicule à un client »). */
function cheminNouveauVehicule(clientId: string, site: string | undefined): string {
  const parametres = new URLSearchParams({ clientId });
  if (site) parametres.set('site', site);
  return `/vehicules/nouveau?${parametres.toString()}`;
}

/** `:id` — convention assumée en l'absence de routage câblé à ce jour (hors périmètre, un agent
 *  dédié câble `src/routes/routeur.tsx`) ; à ajuster ici si le nom réel du paramètre diffère. */
export function EcranFicheClient() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const navigate = useNavigate();
  const location = useLocation();
  // Issue #79 : présent UNIQUEMENT quand cette navigation suit une création tout juste réussie
  // (`EcranListeClients`, voir `EtatNavigationClientCree` ci-dessus) — `undefined` sur tout autre
  // chemin d'arrivée (lien direct, retour depuis un autre écran, rechargement de page).
  const etatCreation = estEtatNavigationClientCree(location.state) ? location.state : undefined;
  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // deux onglets sur deux sites différents ne doivent pas se contredire.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const requete = useClient(id);
  const vehicules = useVehiculesClient(id);
  const ordres = useOrdresClient(id);
  const session = useSession();
  // RF-115 : `admin` n'a AUCUN droit `ventes.*` — un refus de droit (403) n'est pas une absence
  // de donnée, les deux ne doivent jamais partager le même rendu (« Aucun dossier de vente. »
  // affiché à un rôle qui n'a simplement pas le droit de le savoir aurait fait croire à un client
  // sans historique). `peutLireDossierVente` (ecrans/ventes/dossiers/droits.ts) laisse decider
  // AVANT d'émettre la requête plutôt qu'après un 403 — correctif le plus juste : ne pas demander
  // ce qu'on n'a pas le droit de voir. Tant que la session n'est pas résolue, `session.data` vaut
  // `undefined` et `peutLireDossierVente(undefined)` renvoie `false` : la section affiche son
  // squelette de chargement (`session.isLoading`) plutôt que de flasher le message de refus avant
  // de savoir — voir le rendu de la section plus bas.
  const peutVoirDossiersVente = peutLireDossierVente(session.data?.utilisateur.role);
  // Lot B (correction 6, ajout hors liste initiale) — « ses dossiers de vente », troisième liste
  // à côté de « ses véhicules » et « ses OR » déjà câblées. `useListeDossiersVente`
  // (hooks/ventes/dossiers/, déjà existant) accepte `clientAcheteurId` tel quel dans son filtre
  // gelé (`FiltresDossiersVente`) — même acheteur, pas de second champ à croiser.
  const dossiersVente = useListeDossiersVente(
    { clientAcheteurId: id, tri: 'prospectionLe:desc' },
    { enabled: Boolean(id) && peutVoirDossiersVente },
  );

  // `titreVisible={false}` FORCÉ (contredit la détection automatique, qui laisserait ce h1
  // visible : « Fiche client » ne recoupe aucun libellé de navigation). Mesuré : ce n'est pas
  // l'onglet qui fait doublon ici mais le CONTENU — `IdentiteClient`, juste sous ce même en-tête,
  // affiche déjà le nom et le badge de statut du client en gros caractères. Rendre ce h1 visible
  // empilerait un second titre générique au-dessus d'une identité déjà affichée — même défaut,
  // à l'intérieur de l'écran plutôt qu'entre l'écran et l'onglet (même doctrine que
  // `EcranFicheOrdreReparation.tsx`/`EcranFicheVehicule.tsx`). Comportement inchangé sur le fond
  // (aucun h1 visible n'existait avant ce chantier), désormais uniforme sur les trois états
  // (chargement/erreur/contenu) via le gabarit commun.
  if (requete.isLoading) {
    return (
      <GabaritEcran titre={t('clients:fiche.titre')} titreVisible={false}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (requete.isError || !requete.data) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    // Issue #79 : cette navigation suit une création CONFIRMÉE (`etatCreation` défini) — la
    // création a réussi, seule CETTE lecture échoue. Le message générique habituel (« Une erreur
    // s'est produite » / « Connexion impossible », armé d'un simple « Réessayer ») laisse croire
    // que rien n'a abouti, exactement ce qui a failli faire ressaisir le client Rossier en double.
    // Peu importe ici que l'échec de LECTURE soit lui-même réseau ou non (`estErreurReseau`) : ce
    // qui compte pour l'utilisateur, c'est que la CRÉATION, elle, a réussi — un seul message le
    // dit, quelle que soit la cause de l'échec d'affichage.
    return (
      <GabaritEcran titre={t('clients:fiche.titre')} titreVisible={false}>
        <EtatErreur
          titre={
            etatCreation
              ? t('clients:ficheApresCreation.titre')
              : t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')
          }
          description={
            etatCreation
              ? t('clients:ficheApresCreation.description', {
                  nom: etatCreation.clientCreeNom,
                  numero: etatCreation.clientCreeNumero,
                })
              : requete.error
                ? messageErreur(requete.error, t)
                : ''
          }
          onReessayer={() => void requete.refetch()}
        />
        {etatCreation ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(chemins.clients.liste(site))}
            >
              {t('clients:ficheApresCreation.retourListe')}
            </Button>
          </div>
        ) : null}
      </GabaritEcran>
    );
  }

  const client = requete.data;
  const lignesVehicules = vehicules.data?.pages.flatMap((page) => page.donnees) ?? [];
  const lignesOrdres = ordres.data?.pages.flatMap((page) => page.donnees) ?? [];

  // `DialogueNouveauRendezVous.site` (composants/rendez-vous/) est obligatoire (un `SiteResume`
  // complet, pas juste un id) — même repli que `TableauBordMagasinier.tsx` (site actif du tenant,
  // sinon le premier) quand la fiche est ouverte sans `?site=` explicite : jamais un site inventé,
  // seulement le seul choix non ambigu quand aucun n'est précisé.
  const siteRendezVous = site
    ? session.data?.sites.find((candidat) => candidat.id === site)
    : (session.data?.sites.find((candidat) => candidat.actif) ?? session.data?.sites[0]);

  // `IdentiteClient` prend un `ClientResume` (projection de LISTE) ; `GET /clients/{id}` renvoie
  // `ReponseClient` (fiche complète), qui n'a pas `localite`/`nombreVehicules` — des agrégats que
  // `IdentiteClient` ne lit d'ailleurs pas (seuls nomAffiche/numeroClient/statut le sont). Valeurs
  // neutres ci-dessous, jamais affichées.
  const clientPourIdentite: ClientResume = {
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

  // Fil d'Ariane contextuel (chantier « un seul patron », 24.08.2026) — même dispositif que
  // `EnTeteOrdreReparation.tsx` (pris comme modèle) : le client est en tête de hiérarchie
  // (aucune ressource au-dessus dans ce produit), un seul ancêtre — la liste dont il vient.
  const segmentsFilAriane: readonly SegmentFilAriane[] = [
    { cle: 'clients', libelle: t('clients:titre'), href: chemins.clients.liste(site) },
  ];

  return (
    <GabaritEcran titre={t('clients:fiche.titre')} titreVisible={false}>
      <FilAriane segments={segmentsFilAriane} pageCourante={client.nomAffiche} />

      <BandeauAlerteClient
        bloque={client.statut === 'bloque'}
        alertes={client.notesAlerte.map((note) => ({ id: note.id, texte: note.texte }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <IdentiteClient client={clientPourIdentite} alerte={client.notesAlerte.length > 0} />
        {/* Action primaire unique de la fiche (RM-21) — chemin assumé en l'absence de câblage
         *  du module atelier à ce jour, à ajuster par l'agent de routage si besoin. */}
        <Button type="button" onClick={() => navigate(cheminNouvelOr(client.id, site))}>
          <Wrench aria-hidden className="h-4 w-4" />
          {t('clients:fiche.ouvrirOr')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 texte-corps">
            <dt className="text-muted-foreground">{t('clients:identite.ide')}</dt>
            <dd>{texteOuVide(client.ide)}</dd>
            <dt className="text-muted-foreground">{t('clients:identite.langue')}</dt>
            <dd>{t(`commun:langues.${client.langueCorrespondance}`)}</dd>
            <dt className="text-muted-foreground">{t('clients:identite.telephone')}</dt>
            <dd>{texteOuVide(client.telephone)}</dd>
            <dt className="text-muted-foreground">{t('clients:identite.email')}</dt>
            <dd>{texteOuVide(client.email)}</dd>
            {client.poObligatoire ? (
              <>
                <dt className="text-muted-foreground">{t('clients:identite.po')}</dt>
                <dd className="font-medium text-foreground">{t('clients:identite.po')}</dd>
              </>
            ) : null}
          </dl>

          <OngletConditions clientId={client.id} />

          <Tabs defaultValue="contacts">
            <TabsList>
              <TabsTrigger value="contacts">{t('clients:fiche.onglets.contacts')}</TabsTrigger>
              <TabsTrigger value="adresses">{t('clients:fiche.onglets.adresses')}</TabsTrigger>
              <TabsTrigger value="consentements">
                {t('clients:fiche.onglets.consentements')}
              </TabsTrigger>
              <TabsTrigger value="notes">{t('clients:fiche.onglets.notes')}</TabsTrigger>
            </TabsList>
            <TabsContent value="contacts" className="pt-4">
              <OngletContacts clientId={client.id} />
            </TabsContent>
            <TabsContent value="adresses" className="pt-4">
              <OngletAdresses clientId={client.id} />
            </TabsContent>
            <TabsContent value="consentements" className="pt-4">
              <OngletConsentements
                clientId={client.id}
                plusAucunContact={client.plusAucunContact}
                motifContact={client.motif}
              />
            </TabsContent>
            <TabsContent value="notes" className="pt-4">
              <OngletNotes clientId={client.id} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="min-w-0 space-y-6">
          <SectionRendezVousClient
            client={clientPourIdentite}
            vehiculesClient={lignesVehicules}
            site={siteRendezVous}
          />

          {/* Défaut corrigé : cette section testait `isLoading` puis la longueur de la liste,
           *  SANS branche d'erreur — un 403/404 stable retombait indéfiniment dans le squelette
           *  de chargement (TanStack Query réessaie par défaut), jamais résolu. `EtatSousCollection`
           *  (déjà utilisé par les 5 onglets de sous-collection, voir `onglets/`) couvre les trois
           *  états explicitement — `useVehiculesClient` (hooks/clients/) porte déjà sa propre
           *  politique de réessai via `useDoitReessayer()` (403/404 jamais réessayés). */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="texte-titre-section font-medium text-foreground">
                {t('clients:fiche.vehicules')}
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate(cheminNouveauVehicule(client.id, site))}
              >
                <Plus aria-hidden className="h-4 w-4" />
                {t('clients:fiche.actions.ajouterVehicule')}
              </Button>
            </div>
            <EtatSousCollection
              enChargement={vehicules.isLoading}
              erreur={vehicules.error}
              onReessayer={() => void vehicules.refetch()}
              vide={lignesVehicules.length === 0}
              texteVide={t('clients:fiche.vehiculesVide')}
            >
              <ul className="space-y-2">
                {lignesVehicules.map((vehicule) => (
                  <li key={vehicule.id}>
                    {/* Bordure structurelle : carte cliquable de navigation (repli mobile de
                     *  tableau). */}
                    <button
                      type="button"
                      onClick={() => navigate(chemins.vehicules.detail(vehicule.id, site))}
                      className="w-full rounded-md border p-3 text-left hover:bg-muted anneau-focus"
                    >
                      <IdentiteVehicule vehicule={vehicule} taillePlaque="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            </EtatSousCollection>
          </section>

          {/* Même défaut, même correctif que la section « véhicules » ci-dessus — voir son
           *  commentaire. `useOrdresClient` (hooks/clients/) porte la même politique de réessai. */}
          <section className="space-y-2">
            <h2 className="texte-titre-section font-medium text-foreground">
              {t('clients:fiche.derniersOr')}
            </h2>
            <EtatSousCollection
              enChargement={ordres.isLoading}
              erreur={ordres.error}
              onReessayer={() => void ordres.refetch()}
              vide={lignesOrdres.length === 0}
              texteVide={t('clients:fiche.derniersOrVide')}
            >
              <ul className="space-y-2">
                {lignesOrdres.map((or) => (
                  <li key={or.id}>
                    {/* Bordure structurelle : carte cliquable de navigation, même motif que la
                     *  liste « véhicules » ci-dessus. */}
                    <button
                      type="button"
                      onClick={() => navigate(cheminOr(or.id, site))}
                      className="w-full space-y-1 rounded-md border p-3 text-left hover:bg-muted anneau-focus"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="texte-corps font-medium text-foreground">{or.numero}</span>
                        <BadgeStatutOr etat={or.etatAffiche} />
                      </div>
                      <span className="texte-libelle text-muted-foreground">
                        {or.ouvertLe ? formaterDate(or.ouvertLe) : texteOuVide(null)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </EtatSousCollection>
          </section>

          {/* Lot B (correction 6) — « ses dossiers de vente », troisième liste. Première question
           *  qu'un vendeur se pose face à un client qui revient — rien ne la couvrait avant ce
           *  lot.
           *
           *  Défaut corrigé (mesuré en navigateur, connecté `admin` — rôle SANS
           *  `ventes.dossier.lire`, RF-115) : six requêtes `GET /dossiers-vente` en moins de dix
           *  secondes, toutes en 403, jamais arrêtées — TanStack Query réessaie par défaut un état
           *  qui ne se résoudra jamais, et l'écran affichait indéfiniment le squelette de
           *  chargement. Deux corrections :
           *   1. `peutVoirDossiersVente` gate la requête elle-même (`enabled`, voir plus haut) : un
           *      rôle qui n'a pas le droit ne le demande plus du tout — ni martèlement, ni attente.
           *   2. Si le calcul front divergeait malgré tout de la matrice réelle (défensif
           *      seulement, le serveur reste l'arbitre — voir `droits.ts`), le message « vous n'avez
           *      pas le droit » (ci-dessous) et le 403 réel (`EtatSousCollection`, `retry: false`
           *      sur 403/404 dans `useListeDossiersVente`) restent tous deux DISTINCTS de « aucun
           *      dossier de vente » — jamais le même rendu pour deux informations opposées. */}
          <section className="space-y-2">
            <h2 className="texte-titre-section font-medium text-foreground">
              {t('clients:fiche.dossiersVente')}
            </h2>
            {session.isLoading ? (
              <EtatChargement lignes={2} />
            ) : !peutVoirDossiersVente ? (
              <p className="texte-corps text-muted-foreground">
                {t('clients:fiche.dossiersVenteDroitRequis')}
              </p>
            ) : (
              <EtatSousCollection
                enChargement={dossiersVente.isLoading}
                erreur={dossiersVente.error}
                onReessayer={() => void dossiersVente.refetch()}
                vide={dossiersVente.dossiers.length === 0}
                texteVide={t('clients:fiche.dossiersVenteVide')}
              >
                <ul className="space-y-2">
                  {dossiersVente.dossiers.map((dossier) => (
                    <li key={dossier.id}>
                      {/* Bordure structurelle : carte cliquable de navigation, même motif que
                       *  les deux listes ci-dessus. */}
                      <button
                        type="button"
                        onClick={() => navigate(chemins.ventes.dossiers.detail(dossier.id, site))}
                        className="w-full space-y-1 rounded-md border p-3 text-left hover:bg-muted anneau-focus"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="texte-corps font-medium text-foreground">
                            {dossier.vehicule?.vehicule.designation ??
                              t('clients:fiche.dossierSansVehicule')}
                          </span>
                          <BadgeStatutDossierVente statut={dossier.statut} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </EtatSousCollection>
            )}
          </section>
        </div>
      </div>
    </GabaritEcran>
  );
}
