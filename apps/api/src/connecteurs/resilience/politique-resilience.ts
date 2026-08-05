import type { PolitiqueNouvellesTentativesConnecteur } from '@dfa/shared';

/**
 * Politique de résilience appliquée à CHAQUE appel sortant vers un adaptateur — item C du socle
 * (étape 5) : « délai maximal, nombre de tentatives et attente croissante entre elles, coupure
 * après échecs répétés ».
 *
 * Étend `PolitiqueNouvellesTentativesConnecteur` (`@dfa/shared`, `RC-04`/`PC-01`) plutôt que de
 * la dupliquer : c'est déjà le contrat gelé pour `nombreMaxTentatives` /
 * `espacementInitialSecondes` / `facteurCroissance`, porté par
 * `ReponseConnecteurActivation.politiqueNouvellesTentatives`. Les deux champs supplémentaires
 * (`delaiMaxMs`, disjoncteur) n'ont pas d'équivalent dans le contrat partagé — c'est un détail
 * d'exécution du socle, pas une donnée qu'un client HTTP a besoin de lire aujourd'hui.
 */
export interface PolitiqueResilienceConnecteur extends PolitiqueNouvellesTentativesConnecteur {
  /** Délai maximal accordé à UNE tentative avant abandon (`ErreurDelaiDepasseConnecteur`). Un
   *  partenaire muet ne doit jamais bloquer la requête d'un garagiste au-delà de cette borne. */
  readonly delaiMaxMs: number;
  /** Nombre d'ÉCHECS COMPLETS consécutifs (une exécution entière, tentatives internes épuisées)
   *  au-delà duquel le disjoncteur s'ouvre pour ce `(tenant, typeConnecteurCode)`. */
  readonly seuilCoupureEchecsConsecutifs: number;
  /** Durée pendant laquelle le disjoncteur reste ouvert (aucun appel sortant tenté) une fois le
   *  seuil atteint. */
  readonly dureeCoupureMs: number;
}

/**
 * Défaut d'EXPLOITATION appliqué quand une activation ne porte aucune
 * `politiqueNouvellesTentatives` (`null`, cas normal tant qu'aucune pratique n'est mesurée —
 * voir `ReponseConnecteurActivation`, `connecteur.ts`). PAS un choix métier documenté par un
 * `RC-xx` : une valeur honnête de démarrage, à réviser au premier adaptateur réel.
 */
export const POLITIQUE_RESILIENCE_CONNECTEUR_DEFAUT: PolitiqueResilienceConnecteur = {
  nombreMaxTentatives: 3,
  espacementInitialSecondes: 1,
  facteurCroissance: 2,
  delaiMaxMs: 10_000,
  seuilCoupureEchecsConsecutifs: 5,
  dureeCoupureMs: 60_000,
};
