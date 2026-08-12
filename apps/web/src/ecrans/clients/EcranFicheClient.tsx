import { Plus, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { ClientResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { BandeauAlerteClient } from '@/composants/motifs/BandeauAlerteClient';
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

  if (requete.isLoading) {
    return (
      <div className="p-6">
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (requete.isError || !requete.data) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    return (
      <div className="p-6">
        <EtatErreur
          titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          description={requete.error ? messageErreur(requete.error, t) : ''}
          onReessayer={() => void requete.refetch()}
        />
      </div>
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

  return (
    <div className="flex flex-col gap-4 p-6">
      <BandeauAlerteClient
        bloque={client.statut === 'bloque'}
        alertes={client.notesAlerte.map((note) => ({ id: note.id, texte: note.texte }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="texte-libelle text-muted-foreground">{t('clients:fiche.titre')}</p>
          <IdentiteClient
            client={clientPourIdentite}
            alerte={client.notesAlerte.length > 0}
            className="mt-1"
          />
        </div>
        {/* Action primaire unique de la fiche (RM-21) — chemin assumé en l'absence de câblage
         *  du module atelier à ce jour, à ajuster par l'agent de routage si besoin. */}
        <Button type="button" onClick={() => navigate(cheminNouvelOr(client.id, site))}>
          <Wrench aria-hidden className="h-4 w-4" />
          {t('clients:fiche.ouvrirOr')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 texte-corps">
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
              <OngletConsentements clientId={client.id} />
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
           *  états explicitement. Réessai encore par défaut ici : `useVehiculesClient`
           *  (hooks/clients/, hors périmètre d'écriture de ce correctif) n'a pas de politique de
           *  réessai dédiée aux 403/404 — à aligner sur `useListeDossiersVente` par le
           *  propriétaire de `hooks/clients/`. */}
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
                    <button
                      type="button"
                      onClick={() => navigate(chemins.vehicules.detail(vehicule.id, site))}
                      className="w-full rounded-md border p-3 text-left hover:bg-muted"
                    >
                      <IdentiteVehicule vehicule={vehicule} taillePlaque="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            </EtatSousCollection>
          </section>

          {/* Même défaut, même correctif que la section « véhicules » ci-dessus — voir son
           *  commentaire. Même réserve sur la politique de réessai : `useOrdresClient`
           *  (hooks/clients/) est hors périmètre d'écriture ici. */}
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
                    <button
                      type="button"
                      onClick={() => navigate(cheminOr(or.id, site))}
                      className="w-full space-y-1 rounded-md border p-3 text-left hover:bg-muted"
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
                      <button
                        type="button"
                        onClick={() => navigate(chemins.ventes.dossiers.detail(dossier.id, site))}
                        className="w-full space-y-1 rounded-md border p-3 text-left hover:bg-muted"
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
    </div>
  );
}
