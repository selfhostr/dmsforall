import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type { ClientResume, ReponseOrdreReparation, VehiculeResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { BandeauAlerteClient } from '@/composants/motifs/BandeauAlerteClient';
import { useClient } from '@/hooks/clients/useClient';
import { chemins } from '@/routes/chemins';

import { FormulaireNouvelOrdreReparation } from './FormulaireNouvelOrdreReparation';
import { SelecteurSiteOrRequis } from './SelecteurSiteOrRequis';
import { SelecteurVehiculeOrdre } from './SelecteurVehiculeOrdre';

/** `chemins.ts` (routes/) n'a pas encore d'entrée Atelier — module en cours de câblage par un
 *  autre agent (périmètre disjoint, voir `EcranFicheOrdreReparation.tsx`). Même helper local que
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
 * `vehiculeId`, lui, n'arrive JAMAIS pré-rempli (aucun écran ne le porte encore dans son URL) :
 * son choix est donc TOUJOURS fait ici, via `SelecteurVehiculeOrdre`, une fois le client connu.
 */
export function EcranNouvelOrdreReparation() {
  const { t } = useTranslation(['or', 'commun', 'erreurs']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const clientId = searchParams.get('clientId') ?? undefined;

  const [vehiculeChoisi, setVehiculeChoisi] = useState<VehiculeResume | null>(null);

  const requeteClient = useClient(clientId);

  function surCreation(or: ReponseOrdreReparation) {
    navigate(cheminOr(or.id, site));
  }

  // Revue UX du 10.08.2026 : un réceptionnaire arrivé ici (souvent sans avoir jamais choisi de
  // site ce jour-là) tombait sur un cul-de-sac — « Retour à l'accueil » perdait le `clientId` déjà
  // trouvé, l'obligeant à rechercher le client une seconde fois après avoir choisi un site depuis
  // l'en-tête. `SelecteurSiteOrRequis` (même doctrine que `ecrans/pieces/SelecteurSiteRequis.tsx`)
  // résout le site SANS quitter cet écran ni perdre `clientId` : il complète juste `?site=` dans
  // l'URL courante.
  if (!site) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
        <h1 className="sr-only">{t('or:nouveau.titre')}</h1>
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
    );
  }

  if (!clientId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
        <h1 className="sr-only">{t('or:nouveau.titre')}</h1>
        <EtatVide
          titre={t('or:nouveau.client.requisTitre')}
          description={t('or:nouveau.client.requisDescription')}
          action={
            <Button asChild>
              <Link to={chemins.recherche.globale(site)}>{t('commun:actions.rechercher')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (requeteClient.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h1 className="sr-only">{t('or:nouveau.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (requeteClient.isError) {
    const estErreurReseau = requeteClient.error instanceof ErreurReseau;
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h1 className="sr-only">{t('or:nouveau.titre')}</h1>
        <EtatErreur
          titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          description={messageErreur(requeteClient.error, t)}
          onReessayer={() => void requeteClient.refetch()}
        />
      </div>
    );
  }

  const client = requeteClient.data;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="texte-titre-section font-semibold text-foreground">{t('or:nouveau.titre')}</h1>

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
  );
}
