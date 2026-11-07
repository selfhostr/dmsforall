import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';

import type {
  ClientResume,
  ReponseClient,
  ReponseOrdreReparation,
  VehiculeResume,
} from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { BandeauAlerteClient } from '@/composants/motifs/BandeauAlerteClient';
import { PanneauLateral } from '@/composants/PanneauLateral';
// Import de lecture depuis le module `clients` (hors périmètre d'écriture ici, voir CONTRIBUTING.md) —
// réutilise TEL QUEL le même formulaire que `EcranListeClients.tsx` (tiroir « Nouveau client »),
// jamais une resaisie locale de la création client. Issue #107 (test terrain, verbatim : « c'est
// là que j'aurais attrapé un bloc-notes ») : chercher un client inexistant depuis « Nouvel ordre
// de réparation » menait à `/recherche`, qui n'offre elle-même AUCUN moyen de créer le client —
// cul-de-sac total. Ce bouton coupe court AVANT même d'atteindre la recherche : le client créé ici
// alimente directement `?clientId=`, l'écran continue sur le choix du véhicule SANS jamais quitter
// ce flux. Ne dépend pas du bouton « Nouveau client » de l'écran Clients (`#122`, corrigé par un
// lot parallèle) : ce déclencheur est un second point d'entrée totalement indépendant vers le
// même formulaire, qui reste utilisable quel que soit l'état de ce correctif-là.
import { FormulaireNouveauClient } from '@/ecrans/clients/FormulaireNouveauClient';
import { useClient } from '@/hooks/clients/useClient';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { chemins } from '@/routes/chemins';

import { FormulaireNouvelOrdreReparation } from './FormulaireNouvelOrdreReparation';
import { SelecteurSiteOrRequis } from './SelecteurSiteOrRequis';
import { SelecteurVehiculeOrdre } from './SelecteurVehiculeOrdre';

/** `chemins.ts` (routes/) n'a pas encore d'entrée Atelier — module en cours de câblage par un
 *  autre lot (périmètre disjoint, voir `EcranFicheOrdreReparation.tsx`). Même helper local que
 *  `EcranFicheClient.tsx`/`EcranRecherche.tsx`, répété ici plutôt que d'éditer un fichier hors
 *  périmètre. La fiche d'OR lit `:orId` (pas `:id`, voir `routeur.tsx`) — sans effet sur cette
 *  construction en chaîne. */
function cheminOr(id: string, site: string | undefined): string {
  return site
    ? `/ordres-reparation/${id}?site=${encodeURIComponent(site)}`
    : `/ordres-reparation/${id}`;
}

/** `GET /clients/{id}` renvoie `ReponseClient` (fiche complète), qui n'a pas `localite`/
 *  `nombreVehicules` — agrégats que `IdentiteClient` ne lit d'ailleurs pas (seuls
 *  `nomAffiche`/`numeroClient`/`statut` le sont). Même conversion que `EcranFicheClient.tsx`,
 *  répétée plutôt que d'en faire une fonction partagée hors périmètre pour deux appelants. */
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

/** Cadre commun des états du parcours détaillé : panneau latéral droit par-dessus la liste des OR
 *  (même geste que « Nouveau client »). Fermer = retour à la liste, `?site=` conservé. */
function GabaritEcran({ titre, children }: { readonly titre: string; readonly children: ReactNode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return (
    <PanneauLateral
      ouvert
      onOuvertChange={(ouvert) => {
        if (!ouvert) {
          navigate(chemins.atelier.ordresReparation.liste(searchParams.get('site') ?? undefined));
        }
      }}
      titre={titre}
    >
      {children}
    </PanneauLateral>
  );
}

/**
 * Écran de création d'un OR (§7.6) — LE geste le plus fréquent du comptoir : il doit tolérer
 * l'information incomplète et ne jamais bloquer sur ce qui peut être complété plus tard (voir
 * `FormulaireNouvelOrdreReparation`, qui ne rend obligatoire que ce que le contrat exige déjà).
 *
 * Deux prérequis ne sont en revanche JAMAIS devinés :
 *  - `site` (`?site=`) : détermine la numérotation (RM-49, `porteeNumerotation`) et le
 *    paramétrage appliqué à l'OR. Son absence bloque l'écran avec un message explicite plutôt que
 *    de choisir un site au hasard — ouvrir un OR sur le mauvais site est une erreur qui ne se
 *    découvre qu'à la facturation, quand elle coûte le plus cher à corriger.
 *  - `clientId` (`?clientId=`) : aucun point d'entrée du produit ne mène ici sans lui à ce jour
 *    (le seul lien existant est celui de la fiche client, `EcranFicheClient.tsx`, RM-21). Sans
 *    lui, on renvoie vers `/recherche` — l'écran déjà construit pour trouver un client — plutôt
 *    que de dupliquer une seconde recherche ici.
 *
 * `vehiculeId` (`?vehiculeId=`) : CORRECTIF issue #48 — arrive désormais pré-rempli quand on
 * vient de la fiche d'un véhicule (`EcranFicheVehicule.tsx`), qui connaît déjà le véhicule
 * affiché. Présélectionné dans `SelecteurVehiculeOrdre` SANS retirer la liste ni sauter d'étape :
 * un OR peut viser un autre véhicule du même client (amené par quelqu'un d'autre que son
 * détenteur, cas réel en garage) — le champ reste modifiable via `onChangerVehicule`.
 */
function EcranNouvelOrdreReparationClassique() {
  const { t } = useTranslation(['or', 'commun', 'erreurs']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const clientId = searchParams.get('clientId') ?? undefined;
  const vehiculeIdPreselectionne = searchParams.get('vehiculeId') ?? undefined;

  const [vehiculeChoisi, setVehiculeChoisi] = useState<VehiculeResume | null>(null);
  // Issue #107 — voir l'import de `FormulaireNouveauClient` ci-dessus pour le contexte complet.
  const [creationClientOuverte, setCreationClientOuverte] = useState(false);
  // La présélection ne doit s'appliquer QU'UNE FOIS : si l'utilisateur revient explicitement au
  // sélecteur (`onChangerVehicule`, plus bas), l'effet ci-dessous ne doit pas la réimposer aussitôt.
  const preselectionTenteeRef = useRef(false);

  const requeteClient = useClient(clientId);
  // Même clé de cache que `SelecteurVehiculeOrdre` (`clesQuery.clients.vehicules`, via
  // `useVehiculesClient`) : aucun appel réseau supplémentaire, seulement une lecture anticipée qui
  // permet de résoudre `vehiculeIdPreselectionne` en `VehiculeResume` avant même que le sélecteur
  // ne soit monté. Désactivée (`clientId` non transmis au hook) tant qu'il n'y a rien à
  // présélectionner — pas de requête superflue sur le chemin sans `vehiculeId` (issue #47).
  const requeteVehiculesPreselection = useVehiculesClient(
    vehiculeIdPreselectionne ? clientId : undefined,
  );

  useEffect(() => {
    if (preselectionTenteeRef.current || !vehiculeIdPreselectionne) return;
    const page = requeteVehiculesPreselection.data;
    if (!page) return;
    const vehicules = page.pages.flatMap((p) => p.donnees);
    const trouve = vehicules.find((v) => v.id === vehiculeIdPreselectionne);
    // Trouvé -> présélection. Pas trouvé (véhicule hors page chargée, ou n'appartenant pas à ce
    // client) -> abandon silencieux, l'utilisateur choisit normalement dans la liste. Dans les
    // deux cas, une seule tentative — voir le commentaire de `preselectionTenteeRef`.
    if (trouve) setVehiculeChoisi(trouve);
    preselectionTenteeRef.current = true;
  }, [vehiculeIdPreselectionne, requeteVehiculesPreselection.data]);

  function surCreation(or: ReponseOrdreReparation) {
    navigate(cheminOr(or.id, site));
  }

  // Revue UX du 10.08.2026 : un réceptionnaire arrivé ici (souvent sans avoir jamais choisi de
  // site ce jour-là) tombait sur un cul-de-sac — « Retour à l'accueil » perdait le `clientId` déjà
  // trouvé, l'obligeant à rechercher le client une seconde fois après avoir choisi un site depuis
  // l'en-tête. `SelecteurSiteOrRequis` (même doctrine que `ecrans/pieces/SelecteurSiteRequis.tsx`)
  // résout le site SANS quitter cet écran ni perdre `clientId` : il complète juste `?site=` dans
  // l'URL courante.
  // Titre TOUJOURS visible à travers les cinq états ci-dessous (site manquant / client manquant /
  // chargement / erreur / formulaire) : la détection automatique du gabarit ne trouve aucun
  // doublon (« Nouvel ordre de réparation » ne recoupe ni l'onglet « Ordres de réparation » ni
  // aucune vue), et un même h1 sur tous les états évite que l'en-tête saute d'un état à l'autre
  // (contrat gabarit §5.1). Le titre de chaque état intermédiaire (`EtatVide`/`EtatErreur`) reste
  // en outre affiché SOUS ce h1 — même patron que `EcranListeOrdresReparation` (h1 de page +
  // titre d'état), pas un second doublon.
  if (!site) {
    return (
      <GabaritEcran titre={t('or:nouveau.titre')}>
        <div className="flex w-full flex-col gap-4">
          <SelecteurSiteOrRequis
            onChoisir={(siteId) =>
              setSearchParams((params) => {
                const suivant = new URLSearchParams(params);
                suivant.set('site', siteId);
                return suivant;
              })
            }
          />
        </div>
      </GabaritEcran>
    );
  }

  if (!clientId) {
    return (
      <GabaritEcran titre={t('or:nouveau.titre')}>
        <div className="flex w-full flex-col gap-4">
          <EtatVide
            titre={t('or:nouveau.client.requisTitre')}
            description={t('or:nouveau.client.requisDescription')}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button asChild variant="outline">
                  <Link to={chemins.recherche.globale(site)}>{t('commun:actions.rechercher')}</Link>
                </Button>
                {/* Issue #107 : le client cherché peut ne pas exister encore — ce second bouton
                 *  évite le détour par `/recherche`, qui ne sait de toute façon rien créer. */}
                <Button type="button" onClick={() => setCreationClientOuverte(true)}>
                  {t('or:nouveau.client.creerAction')}
                </Button>
              </div>
            }
          />
          <PanneauLateral
            ouvert={creationClientOuverte}
            onOuvertChange={setCreationClientOuverte}
            titre={t('or:nouveau.client.creerTitre')}
          >
              <FormulaireNouveauClient
                ouvert={creationClientOuverte}
                onCree={(client: ReponseClient) => {
                  setCreationClientOuverte(false);
                  // Reste sur CET écran (jamais un aller-retour par `/recherche` ou la fiche
                  // client) : le client vient d'être choisi, l'étape suivante naturelle est le
                  // véhicule — `setSearchParams` complète l'URL exactement comme
                  // `SelecteurSiteOrRequis` le fait déjà pour `?site=` juste au-dessus.
                  setSearchParams((params) => {
                    const suivant = new URLSearchParams(params);
                    suivant.set('clientId', client.id);
                    return suivant;
                  });
                }}
              />
          </PanneauLateral>
        </div>
      </GabaritEcran>
    );
  }

  if (requeteClient.isPending) {
    return (
      <GabaritEcran titre={t('or:nouveau.titre')}>
        <div className="flex w-full flex-col gap-6">
          <EtatChargement lignes={6} />
        </div>
      </GabaritEcran>
    );
  }

  if (requeteClient.isError) {
    const estErreurReseau = requeteClient.error instanceof ErreurReseau;
    return (
      <GabaritEcran titre={t('or:nouveau.titre')}>
        <div className="flex w-full flex-col gap-6">
          <EtatErreur
            titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
            description={messageErreur(requeteClient.error, t)}
            onReessayer={() => void requeteClient.refetch()}
          />
        </div>
      </GabaritEcran>
    );
  }

  const client = requeteClient.data;

  return (
    <GabaritEcran titre={t('or:nouveau.titre')}>
      <div className="flex w-full flex-col gap-4">
        <BandeauAlerteClient
          bloque={client.statut === 'bloque'}
          alertes={client.notesAlerte.map((note) => ({ id: note.id, texte: note.texte }))}
        />
        <IdentiteClient client={versClientResume(client)} alerte={client.notesAlerte.length > 0} />

        {vehiculeChoisi ? (
          <FormulaireNouvelOrdreReparation
            site={site}
            client={client}
            vehicule={vehiculeChoisi}
            onChangerVehicule={() => setVehiculeChoisi(null)}
            onCree={surCreation}
          />
        ) : (
          <SelecteurVehiculeOrdre
            clientId={client.id}
            valeur={null}
            onChangeValeur={(_vehiculeId, vehicule) => setVehiculeChoisi(vehicule)}
          />
        )}
      </div>
    </GabaritEcran>
  );
}

/**
 * Point d'entrée historique de la création d'un OR (fiche client, fiche véhicule, anciens liens) :
 * redirige vers l'écran « depuis une plaque » (`creation-rapide/`), qui reprend `site`, `clientId`
 * et `vehiculeId` et ouvre l'OR en un écran au lieu de quatre. L'ancien parcours (site, puis client,
 * puis véhicule, puis formulaire) reste atteignable avec `?parcours=classique` — c'est le lien
 * « parcours détaillé » de l'écran rapide.
 */
export function EcranNouvelOrdreReparation() {
  const [searchParams] = useSearchParams();
  if (searchParams.get('parcours') === 'classique') {
    return <EcranNouvelOrdreReparationClassique />;
  }
  return (
    <Navigate
      replace
      to={chemins.atelier.ordresReparation.depuisPlaque({
        site: searchParams.get('site') ?? undefined,
        clientId: searchParams.get('clientId') ?? undefined,
        vehiculeId: searchParams.get('vehiculeId') ?? undefined,
      })}
    />
  );
}
