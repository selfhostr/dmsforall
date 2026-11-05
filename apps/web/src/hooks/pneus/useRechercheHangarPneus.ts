import { useQueries } from '@tanstack/react-query';

import { TRI_DEFAUT_CREATION, type ReponseDepotPneus, type ResultatRecherche } from '@dfa/shared';

import { useRechercheComptoir } from '@/hooks/recherche/useRechercheComptoir';
import { listerVehicules } from '@/hooks/vehicules/vehicules.api';

import { listerDepotsPneusVehicule } from './depot-pneus.api';

/**
 * Recherche « en deux secondes » du hangar (exigence @laupernoe, §6 de la spec) — PAS d'endpoint dédié
 * côté pneus (le contrat livré ne couvre que hangar/historique-véhicule/créer/changer-saison/
 * sortir/à-relancer, voir l'en-tête de `depot-pneus.api.ts`). Réutilise `GET /recherche`
 * (`useRechercheComptoir`, déjà indexé serveur pour la plaque, le VIN et le nom client — voir
 * `apps/api/src/recherche/service-recherche.ts`) plutôt que de dupliquer une recherche floue côté
 * client : une frappe déclenche UNE requête déjà optimisée, pas un balayage de toutes les lignes
 * chargées du hangar.
 *
 * Trois niveaux, chacun BORNÉ (jamais un balayage de tout le tenant) :
 *  1. `GET /recherche?q=` -> véhicules ET clients correspondants (max `limite` par défaut = 20).
 *  2. Pour chaque CLIENT trouvé, `GET /vehicules?detenteurId=` (max 5) — la spec (RPP-01) veut la
 *     recherche « par client », mais un dépôt de pneus se rattache à un véhicule, jamais
 *     directement à un client (pas de raccourci en base à interroger).
 *  3. Pour chaque véhicule candidat (trouvé directement OU via un client), `GET
 *     /vehicules/{id}/depots-pneus` filtré aux statuts actifs (`en_depot`/`monte`/`a_relancer` —
 *     PAS `sorti`, un jeu sorti n'est plus à retrouver) pour lire son `codeCase`.
 *
 * GAP SIGNALÉ (à l'attention d'expert-api) : un endpoint dédié `GET /depots-pneus/recherche?q=`
 * (qui joindrait véhicule+client directement en base) supprimerait ces trois niveaux et serait
 * plus rapide qu'une chaîne de requêtes côté client — non inventé ici (hors périmètre d'écriture,
 * l'API n'est pas dans mon périmètre), signalé au rapport de livraison.
 *
 * DÉFAUT CORRIGÉ (27.08.2026) : `construireParametres()` dans
 * `@/hooks/vehicules/vehicules.api.ts` ne sérialisait QUE `q`/`statut`/`importe`/`siteId`/`tri` —
 * `detenteurId` était silencieusement absent, donc jamais envoyé au serveur malgré l'absence
 * d'erreur TypeScript (index signature ouverte de `FiltresListeVehicules`). Un contournement
 * local (`listerVehiculesDuClient`, appel direct `GET /vehicules?detenteurId=` via `requeteApi`)
 * avait été posé ici en attendant la correction à la source. `construireParametres` porte
 * maintenant `detenteurId` comme champ nommé (voir `vehicules.api.ts`) : le niveau 2 ci-dessous
 * appelle désormais `listerVehicules` directement, contournement supprimé.
 *
 * NIVEAU 2 NON FUSIONNABLE EN UNE SEULE REQUÊTE : `detenteurId` (`schemaFiltresVehicules`,
 * @dfa/shared) est un identifiant SINGULIER (`schemaIdentifiant.optional()`), pas une liste — le
 * SQL serveur applique `d.client_id = ${filtres.detenteurId}` (égalité simple, jamais
 * `= any(...)`, voir `service-vehicule.ts::construireConditionsFiltresVehicules`). Plusieurs
 * clients distincts trouvés exigent donc toujours un appel `GET /vehicules?detenteurId=` PAR
 * client — une requête par détenteur, pas un batch. Seul le niveau 3 (dépôts de pneus par
 * véhicule) reste un N+1 réseau réel, et son second niveau exige un endpoint batché côté API qui
 * n'existe pas — hors périmètre ici, laissé au backlog (voir le GAP ci-dessus).
 */

const LIMITE_VEHICULES_PAR_CLIENT = 5;
const LIMITE_DEPOTS_PAR_VEHICULE = 10;
const STATUTS_ACTIFS_RECHERCHE = ['en_depot', 'monte', 'a_relancer'] as const;

export interface CandidatVehiculeTrouve {
  readonly vehiculeId: string;
  readonly plaque: string | null;
  readonly designation: string | null;
  readonly clientNom: string | null;
}

export interface JeuTrouve {
  readonly depot: ReponseDepotPneus;
  readonly candidat: CandidatVehiculeTrouve;
}

export interface EtatRechercheHangarPneus {
  readonly saisie: string;
  readonly onSaisieChange: (valeur: string) => void;
  /** `true` dès que la saisie n'est pas vide — bascule l'écran du plan du hangar vers les
   *  résultats de recherche. */
  readonly actif: boolean;
  readonly enChargement: boolean;
  readonly enErreur: boolean;
  readonly erreur: unknown;
  readonly jeux: readonly JeuTrouve[];
  readonly relancer: () => void;
}

function texteChaine(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() !== '' ? valeur : null;
}

function candidatDepuisResultatVehicule(resultat: ResultatRecherche): CandidatVehiculeTrouve {
  return {
    vehiculeId: resultat.id,
    plaque: texteChaine(resultat.resume.plaque),
    designation: texteChaine(resultat.resume.designation),
    clientNom: texteChaine(resultat.resume.detenteurNom),
  };
}

export function useRechercheHangarPneus(): EtatRechercheHangarPneus {
  const rechercheGlobale = useRechercheComptoir();
  const actif = rechercheGlobale.reponse !== null;

  const resultatsVehicule = (rechercheGlobale.reponse?.resultats ?? []).filter(
    (r) => r.type === 'vehicule',
  );
  const resultatsClient = (rechercheGlobale.reponse?.resultats ?? []).filter(
    (r) => r.type === 'client',
  );

  // Niveau 2 : véhicules de chaque client trouvé.
  const requetesVehiculesClient = useQueries({
    queries: resultatsClient.map((client) => ({
      queryKey: ['pneus', 'recherche', 'vehiculesClient', client.id] as const,
      queryFn: () =>
        listerVehicules(
          { detenteurId: client.id, tri: TRI_DEFAUT_CREATION },
          { limite: LIMITE_VEHICULES_PAR_CLIENT },
        ),
      enabled: actif,
    })),
  });

  const candidats: CandidatVehiculeTrouve[] = [];
  const idsDejaVus = new Set<string>();
  for (const resultat of resultatsVehicule) {
    const candidat = candidatDepuisResultatVehicule(resultat);
    if (!idsDejaVus.has(candidat.vehiculeId)) {
      idsDejaVus.add(candidat.vehiculeId);
      candidats.push(candidat);
    }
  }
  resultatsClient.forEach((client, index) => {
    const requete = requetesVehiculesClient[index];
    const clientNom = texteChaine(client.resume.nom);
    for (const vehicule of requete?.data?.donnees ?? []) {
      if (idsDejaVus.has(vehicule.id)) continue;
      idsDejaVus.add(vehicule.id);
      candidats.push({
        vehiculeId: vehicule.id,
        plaque: vehicule.plaque,
        designation: vehicule.designation,
        clientNom,
      });
    }
  });

  // Niveau 3 : dépôts actifs de chaque véhicule candidat.
  const requetesDepots = useQueries({
    queries: candidats.map((candidat) => ({
      queryKey: [
        'pneus',
        'recherche',
        'depotsVehicule',
        candidat.vehiculeId,
        STATUTS_ACTIFS_RECHERCHE,
      ] as const,
      queryFn: () =>
        listerDepotsPneusVehicule(
          candidat.vehiculeId,
          { statut: STATUTS_ACTIFS_RECHERCHE, tri: 'entreLe:desc' },
          { limite: LIMITE_DEPOTS_PAR_VEHICULE },
        ),
      enabled: actif,
    })),
  });

  const jeux: JeuTrouve[] = [];
  candidats.forEach((candidat, index) => {
    const requete = requetesDepots[index];
    for (const depot of requete?.data?.donnees ?? []) {
      jeux.push({ depot, candidat });
    }
  });

  const enChargementNiveau2 = requetesVehiculesClient.some(
    (r) => r.isPending && r.fetchStatus !== 'idle',
  );
  const enChargementNiveau3 = requetesDepots.some((r) => r.isPending && r.fetchStatus !== 'idle');
  const enErreurNiveau2 = requetesVehiculesClient.some((r) => r.isError);
  const enErreurNiveau3 = requetesDepots.some((r) => r.isError);
  const premiereErreur =
    requetesVehiculesClient.find((r) => r.isError)?.error ??
    requetesDepots.find((r) => r.isError)?.error ??
    rechercheGlobale.erreur;

  return {
    saisie: rechercheGlobale.saisie,
    onSaisieChange: rechercheGlobale.onSaisieChange,
    actif,
    enChargement: rechercheGlobale.enChargement || enChargementNiveau2 || enChargementNiveau3,
    enErreur: rechercheGlobale.enErreur || enErreurNiveau2 || enErreurNiveau3,
    erreur: premiereErreur,
    jeux,
    relancer: rechercheGlobale.relancer,
  };
}
