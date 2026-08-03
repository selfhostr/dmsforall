import type { Breadcrumb, ErrorEvent } from '@sentry/react';

/**
 * Nettoyage des événements Sentry avant envoi — nLPD oblige (instance auto-hébergée en Suisse,
 * mais aucune donnée personnelle de client de garage ne doit jamais quitter le poste pour
 * autant, y compris vers notre propre instance).
 *
 * Deux lignes de défense, volontairement redondantes :
 * 1. `Sentry.init` (voir sentry.ts) coupe déjà la collecte à la source (`dataCollection` :
 *    aucune variable locale de stack frame, aucun header, aucun cookie, aucun paramètre de
 *    requête HTTP).
 * 2. Ce module rejoue un nettoyage explicite sur ce qui reste — `beforeSend` / `beforeBreadcrumb`
 *    — car la configuration de (1) peut changer d'une version de SDK à l'autre, alors que ce
 *    fichier, testé, reste le dernier filet.
 *
 * Rien ici ne dépend d'un client Sentry initialisé : les fonctions sont pures, donc testables
 * sans réseau ni instance Sentry.
 */

const MARQUEUR_RETIRE = '[retiré]';

/** Noms de champs jamais transmis, quelle que soit leur profondeur dans l'événement — comparés
 *  après normalisation (minuscules, séparateurs retirés), donc `motDePasse`, `mot_de_passe` et
 *  `MOT-DE-PASSE` sont tous reconnus. */
const CLES_SENSIBLES = [
  'motdepasse',
  'password',
  'mdp',
  'email',
  'courriel',
  'nom',
  'prenom',
  'client',
  'raisonsociale',
  'telephone',
  'tel',
  'mobile',
  'adresse',
  'rue',
  'npa',
  'localite',
  'ville',
  'plaque',
  'immatriculation',
  'vin',
  'numerochassis',
  'iban',
  'ahv',
  'avs',
  // Corps de réponse/requête API, quelle que soit la clé exacte utilisée par l'appelant pour le
  // porter (`body`, `reponse`, `reponseApi`, `responseData`…) : jamais transmis tel quel.
  'body',
  'reponse',
  'response',
  'corps',
];

// E-mail générique.
const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// VIN : 17 caractères alphanumériques, sans I/O/Q (norme ISO 3779).
const RE_VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
// Plaque suisse : 1-2 lettres de canton suivies d'espace optionnel et de 1-6 chiffres (ex. « VD
// 123456 », « GE1234 »).
const RE_PLAQUE_CH = /\b[A-Z]{2}[ -]?\d{1,6}\b/g;

function normaliserCle(cle: string): string {
  return cle.toLowerCase().replace(/[^a-z]/g, '');
}

function estCleSensible(cle: string): boolean {
  const normalisee = normaliserCle(cle);
  return CLES_SENSIBLES.some((sensible) => normalisee.includes(sensible));
}

/** Clés dont la valeur est bloquée intégralement et sans condition, y compris quand elle porte
 *  un objet ou un tableau : contrairement à un « client » ou une « adresse » (conteneurs dont on
 *  connaît la forme et dont chaque champ interne est individuellement passé au crible), un corps
 *  de requête/réponse API a une forme arbitraire côté client — le parcourir reviendrait à
 *  espérer que chacune de ses clés inconnues soit couverte par `CLES_SENSIBLES`, ce qu'on ne
 *  peut pas garantir. Principe de prudence : on ne le parcourt jamais, on le bloque en bloc. */
const CLES_BLOCAGE_TOTAL = ['body', 'reponse', 'response', 'corps'];

function estBlocageTotal(cle: string): boolean {
  const normalisee = normaliserCle(cle);
  return CLES_BLOCAGE_TOTAL.some((bloc) => normalisee.includes(bloc));
}

function estConteneur(valeur: unknown): valeur is Record<string, unknown> | unknown[] {
  return Array.isArray(valeur) || (valeur !== null && typeof valeur === 'object');
}

/** Nettoie un champ nommé `cle` portant `valeur`, à l'intérieur d'un objet en cours de parcours.
 *  Trois cas :
 *  - clé de blocage total (`body`, `reponse`…) : la valeur entière est retirée, quelle que soit
 *    sa forme — voir `CLES_BLOCAGE_TOTAL`.
 *  - clé sensible (`nom`, `client`, `adresse`…) portant un objet ou un tableau : on NE remplace
 *    PAS le conteneur en bloc — on le parcourt, pour que ses champs non sensibles restent
 *    visibles à côté de ceux retirés individuellement (ex. `client: { nom, prenom }` reste un
 *    objet avec `nom`/`prenom` retirés, plutôt que `client` devenant la chaîne `'[retiré]'`).
 *  - clé sensible portant une valeur simple (chaîne, nombre…) : retirée intégralement.
 *  - clé non sensible : nettoyage récursif normal. */
function nettoyerChampObjet(cle: string, valeur: unknown, profondeurParente: number): unknown {
  if (estBlocageTotal(cle)) return MARQUEUR_RETIRE;
  if (estCleSensible(cle) && !estConteneur(valeur)) return MARQUEUR_RETIRE;
  return nettoyerValeur(valeur, profondeurParente + 1);
}

/** Rédige, à l'intérieur d'une chaîne, les motifs reconnus comme des données personnelles
 *  (e-mail, VIN, plaque suisse) — utile pour les messages d'erreur ou les URL qui embarquent
 *  ces valeurs sans que la clé porteuse ne soit elle-même signalée comme sensible. */
export function rediger(texte: string): string {
  return texte
    .replace(RE_EMAIL, MARQUEUR_RETIRE)
    .replace(RE_VIN, MARQUEUR_RETIRE)
    .replace(RE_PLAQUE_CH, MARQUEUR_RETIRE);
}

/** Retire la chaîne de requête d'une URL (souvent des filtres de recherche : nom de client,
 *  plaque…), puis rédige ce qui reste dans le chemin. */
function nettoyerUrl(url: string): string {
  const [chemin] = url.split('?');
  return rediger(chemin ?? url);
}

const PROFONDEUR_MAX = 6;

/** Parcourt récursivement une valeur arbitraire (extra, contexts, données de breadcrumb…) : les
 *  champs de chaque objet traversé passent par `nettoyerChampObjet` (blocage total, retrait de
 *  la feuille sensible, ou traversée du conteneur), toute chaîne restante est rédigée. */
function nettoyerValeur(valeur: unknown, profondeur = 0): unknown {
  if (profondeur > PROFONDEUR_MAX) return MARQUEUR_RETIRE;
  if (typeof valeur === 'string') return rediger(valeur);
  if (Array.isArray(valeur))
    return valeur.map((element) => nettoyerValeur(element, profondeur + 1));
  if (valeur !== null && typeof valeur === 'object') {
    const resultat: Record<string, unknown> = {};
    for (const [cle, sousValeur] of Object.entries(valeur)) {
      resultat[cle] = nettoyerChampObjet(cle, sousValeur, profondeur);
    }
    return resultat;
  }
  return valeur;
}

/** Champs de breadcrumb qui, par construction, peuvent porter un corps de réponse/requête API
 *  même si nos intégrations par défaut ne le peuplent pas aujourd'hui — retirés sans condition
 *  plutôt que redigés, par principe de prudence sur des corps JSON entiers (même logique que
 *  `CLES_BLOCAGE_TOTAL`, avec quelques alias propres au format des breadcrumbs réseau). */
const CLES_CORPS_HTTP = ['body', 'requestbody', 'responsebody', 'response', 'data', 'input'];

function nettoyerDonneesBreadcrumb(
  donnees: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!donnees) return donnees;
  const resultat: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(donnees)) {
    const normalisee = normaliserCle(cle);
    if (CLES_CORPS_HTTP.includes(normalisee)) {
      resultat[cle] = MARQUEUR_RETIRE;
      continue;
    }
    if (normalisee === 'url' && typeof valeur === 'string') {
      resultat[cle] = nettoyerUrl(valeur);
      continue;
    }
    resultat[cle] = nettoyerChampObjet(cle, valeur, 0);
  }
  return resultat;
}

/** `beforeBreadcrumb` : nettoie chaque miette du fil de navigation avant qu'elle ne rejoigne
 *  l'événement (clics, requêtes réseau, logs console…). Ne retourne jamais `null` — on préfère
 *  une miette appauvrie à une miette manquante qui casserait la chronologie ; c'est le contenu,
 *  jamais la présence, qui est filtré. */
export function nettoyerMigette(migette: Breadcrumb): Breadcrumb {
  return {
    ...migette,
    message: migette.message ? rediger(migette.message) : migette.message,
    data: nettoyerDonneesBreadcrumb(migette.data),
  };
}

/** `beforeSend` : dernier filet avant l'envoi d'un événement (exception ou message capturé).
 *  Nettoie le message et les valeurs d'exception, la requête (URL sans query string, ni
 *  cookies/headers/corps), les contextes, les extra, les tags, et retire tout `user` — on
 *  n'appelle jamais `Sentry.setUser` avec une donnée personnelle, mais on le garantit ici aussi. */
export function nettoyerEvenement(evenement: ErrorEvent): ErrorEvent {
  const nettoye: ErrorEvent = { ...evenement };

  if (nettoye.message) {
    nettoye.message = rediger(nettoye.message);
  }

  if (nettoye.exception?.values) {
    nettoye.exception = {
      values: nettoye.exception.values.map((valeur) => ({
        ...valeur,
        value: valeur.value ? rediger(valeur.value) : valeur.value,
        // Défense en profondeur : `dataCollection.stackFrameVariables` est désactivé côté
        // Sentry.init (sentry.ts), donc ce champ ne devrait déjà contenir aucune variable
        // locale — mais si une future config le réactivait par erreur, on ne laisse rien
        // passer ici.
        stacktrace: valeur.stacktrace
          ? {
              ...valeur.stacktrace,
              frames: valeur.stacktrace.frames?.map((frame) => ({ ...frame, vars: undefined })),
            }
          : valeur.stacktrace,
      })),
    };
  }

  if (nettoye.request) {
    nettoye.request = {
      method: nettoye.request.method,
      url: nettoye.request.url ? nettoyerUrl(nettoye.request.url) : nettoye.request.url,
      // Headers/cookies/corps/query string retirés sans condition : `Sentry.init` (sentry.ts)
      // en désactive déjà la collecte via `dataCollection`, ceci n'est qu'un second filet.
      headers: undefined,
      cookies: undefined,
      data: undefined,
      query_string: undefined,
      env: undefined,
    };
  }

  if (nettoye.breadcrumbs) {
    nettoye.breadcrumbs = nettoye.breadcrumbs.map((migette) => nettoyerMigette(migette));
  }

  if (nettoye.contexts) {
    nettoye.contexts = nettoyerValeur(nettoye.contexts, 1) as ErrorEvent['contexts'];
  }

  if (nettoye.extra) {
    nettoye.extra = nettoyerValeur(nettoye.extra, 1) as ErrorEvent['extra'];
  }

  if (nettoye.tags) {
    const tagsNettoyes: Record<string, unknown> = {};
    for (const [cle, valeur] of Object.entries(nettoye.tags)) {
      tagsNettoyes[cle] = estCleSensible(cle)
        ? MARQUEUR_RETIRE
        : typeof valeur === 'string'
          ? rediger(valeur)
          : valeur;
    }
    nettoye.tags = tagsNettoyes as ErrorEvent['tags'];
  }

  // On n'appelle jamais Sentry.setUser() avec une donnée réelle dans ce dépôt, mais on retire
  // le champ par contrat plutôt que par confiance dans le reste du code.
  nettoye.user = undefined;

  return nettoye;
}
