/**
 * Constantes du banc — identifiants de démo, tailles d'échantillon, et nombre de requêtes SQL
 * par endpoint COMPTÉ STATIQUEMENT DANS LE CODE (voir méthode ci-dessous), pas mesuré en
 * exécution : aucune extension d'instrumentation (`pg_stat_statements`) n'est chargée sur le
 * Postgres de dev (`shared_preload_libraries` ne la précharge pas dans `docker/postgres/`), et en
 * ajouter une exigerait soit de modifier `docker-compose*.yml`/la config Postgres (hors
 * périmètre, redémarrage du conteneur qui gênerait les autres agents), soit d'instrumenter
 * `apps/api/src/db/acces-base.service.ts` (hors périmètre — deux agents y travaillent).
 *
 * La méthode retenue à la place : chaque service de `apps/api/src/**` interroge Postgres UNIQUEMENT
 * via `tx.execute(sql\`…\`)` ou le query builder Drizzle, jamais dans une boucle sur les résultats
 * d'une requête précédente (vérifié à la lecture pour chaque endpoint listé ici) — le nombre
 * d'allers-retours SQL par requête HTTP est donc une propriété STATIQUE du code, pas un fait
 * d'exécution qui varierait avec la charge. Compter les appels `tx.execute`/`.select()` réellement
 * ATTEINTS pour un chemin donné donne un nombre exact, pas une estimation.
 */

export const IDENTIFIANTS_DEMO = {
  email: 'direction@garage-martin.ch',
  motDePasse: 'Demo1234!Garage',
};

/** Fragment garanti sans correspondance — déterministe, ne dépend d'aucune donnée réelle. */
export const FRAGMENT_SANS_CORRESPONDANCE = 'zzzqxjqxz999';

/**
 * Fragments COURTS choisis comme pire cas plausible (bigrammes fréquents dans les patronymes
 * français/suisses-romands et les marques automobiles courantes en Suisse) — PAS dérivés d'une
 * ligne réelle de la base : un fragment court « pire cas » doit matcher beaucoup de lignes, ce
 * qu'une valeur échantillonnée au hasard ne garantit pas.
 */
export const FRAGMENT_COURT_CLIENT = 'an'; // Jean, Anne, Martin, Fernand, Bernard, Leandre…
export const FRAGMENT_COURT_VEHICULE = 'vo'; // Volkswagen, Volvo — marques très représentées.

export const REQUETES_SQL = {
  'GET /clients (liste)': 1,
  'GET /clients?q=… (fragment)': 1,
  'GET /clients/{id} (fiche)': 3,
  'GET /clients/{id}/vehicules (projection)': 2,
  'GET /vehicules (liste)': 1,
  'GET /vehicules?q=… (fragment)': 1,
  'GET /tableau-bord/activite': 1,
  'GET /tableau-bord/financier': 1,
  'GET /recherche?q=… (comptoir unifié)': '≤7 (une par nature de résultat, selon droits/`types`)',
};

export const CONCURRENCE_STANDARD = 6;
export const N_STANDARD = 42; // 7 vagues à concurrence 6
export const N_ISOLE = 20; // concurrence 1, pour les scénarios de recherche par fragment
export const CONCURRENCE_RECHERCHE_UNIFIEE = 1; // GardeLimitationRecherche : 40 req/30s PAR UTILISATEUR
export const N_RECHERCHE_UNIFIEE = 15;
