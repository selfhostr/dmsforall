import type { ErrorEvent, EventHint } from '@sentry/nestjs';

/**
 * Nettoyage des événements avant envoi à Sentry — LA fonction critique de ce module (voir
 * commentaire de tête de `index.ts`). Un outil de supervision qui exfiltre des données de
 * garages suisses (soumis à la nLPD) est pire que pas de supervision du tout : mieux vaut
 * sur-nettoyer (perdre un peu de contexte de debug) que sous-nettoyer (fuiter une donnée
 * personnelle).
 *
 * Branchée sur TROIS points d'entrée du SDK (voir `initialiser-sentry.ts`) — pas un seul :
 * `beforeSend` ne couvre que les événements d'erreur/message. Dès que le tracing est actif
 * (`SENTRY_TAUX_ECHANTILLONNAGE_TRACES` > 0), une fraction des requêtes produit en plus une
 * TRANSACTION, qui ne passe JAMAIS par `beforeSend` (voir `@sentry/core` `client.js`) — sans
 * `beforeSendTransaction`, ces événements partaient nettoyés par rien du tout. Et chaque span
 * qu'elles contiennent porte des attributs (`http.url`, `db.statement`…) qui ont leur propre
 * point de nettoyage, `beforeSendSpan`.
 *
 * Mécanismes, du plus sûr au plus best-effort :
 *   1. Retrait CIBLÉ des emplacements connus (cookies, en-têtes d'autorisation, corps de
 *      requête des endpoints d'authentification, query string entière) — on sait exactement
 *      où chercher, donc on ne prend aucun risque : la query string d'un DMS ne porte QUE des
 *      filtres de recherche (nom, téléphone, plaque…), elle n'a aucune valeur de diagnostic qui
 *      justifie de la rédiger par motif plutôt que de la couper entièrement.
 *   2. ALLOW-LIST sur `extra` et `contexts` : seules des clés techniques connues survivent (voir
 *      `CLES_EXTRA_AUTORISEES` / `CLES_CONTEXTS_AUTORISEES` plus bas pour l'arbitrage deny-list
 *      vs allow-list).
 *   3. Nettoyage GÉNÉRIQUE en profondeur du reste (données déjà passées par l'allow-list,
 *      breadcrumbs, corps de requête hors authentification, messages d'exception, tags) :
 *      retrait par NOM DE CLÉ (mots de passe, jetons, noms, téléphone, IBAN, AVS…) + retrait par
 *      MOTIF dans les chaînes libres (email, VIN, plaque suisse, téléphone suisse, IBAN, AVS) —
 *      une donnée sensible peut apparaître dans un message d'erreur sans porter un nom de clé
 *      reconnaissable.
 */

const MASQUE = '[retiré]';

/**
 * Normalise un nom de clé pour la comparaison : minuscules, séparateurs retirés — `mot_de_passe`,
 * `MOT-DE-PASSE` et `motDePasse` sont ainsi tous reconnus par un seul motif `motdepasse`.
 */
function normaliserCle(cle: string): string {
  return cle.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Sous-chaînes de nom de clé (après normalisation) dont la VALEUR est toujours masquée.
 *
 * Alignée sur `apps/web/src/observabilite/nettoyageDonnees.ts` (deny-list front, seule ligne de
 * défense équivalente côté navigateur) — l'audit a trouvé les deux listes en dérive : le front
 * connaissait `telephone`, `iban`, `avs`… que l'API ignorait entièrement. Les deux listes DOIVENT
 * rester alignées : toute clé ajoutée d'un côté doit l'être de l'autre.
 */
const CLES_SENSIBLES = [
  // Secrets techniques.
  'password',
  'motdepasse',
  'mdp',
  'token',
  'jeton',
  'session',
  'cookie',
  'authorization',
  'secret',
  // Identité.
  'email',
  'courriel',
  'mail',
  'nom',
  'prenom',
  'client',
  'raisonsociale',
  // Coordonnées.
  'telephone',
  'tel',
  'mobile',
  'adresse',
  'rue',
  'npa',
  'localite',
  'ville',
  // Identifiants suisses sensibles.
  'iban',
  'ahv',
  'avs',
  // Véhicule (identifie indirectement le détenteur).
  'plaque',
  'immatriculation',
  'vin',
  'numerochassis',
] as const;

/** Adresse e-mail — retirée quelle que soit sa position (champ nommé ou texte libre). */
const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * VIN (numéro d'identification du véhicule) — 17 caractères alphanumériques, sans I/O/Q
 * (norme ISO 3779, utilisée mondialement y compris en Suisse). Volontairement large (accepte
 * un faux positif occasionnel sur une chaîne technique de 17 caractères) : en matière de
 * données personnelles, sur-masquer est le bon défaut.
 */
const RE_VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

/**
 * Plaque d'immatriculation suisse — code de canton (2 lettres) suivi de 1 à 6 chiffres, avec
 * ou sans espace (ex. « VD 123456 », « GE1 »). Liste des 26 cantons.
 */
const RE_PLAQUE_CH =
  /\b(AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH)[ ]?\d{1,6}\b/gi;

/**
 * Numéro de téléphone suisse — indicatif `+41`/`0041`/`0` local suivi de 9 chiffres, avec ou
 * sans séparateurs (espace, point, tiret) groupés en 2-3-2-2 (ex. « 079 123 45 67 »,
 * « +41791234567 », « 0791234567 »).
 */
const RE_TEL_CH = /\b(?:\+41|0041|0)[ .-]?\d{2}[ .-]?\d{3}[ .-]?\d{2}[ .-]?\d{2}\b/g;

/**
 * IBAN — 2 lettres de pays + 2 chiffres de contrôle + jusqu'à 30 caractères alphanumériques,
 * avec ou sans espaces tous les 4 caractères (format d'affichage usuel). Pas restreint à `CH`
 * (un client peut avoir un IBAN étranger) — l'IBAN reste une donnée personnelle quelle que soit
 * sa nationalité.
 */
const RE_IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){2,7}\b/g;

/**
 * Numéro AVS (assurance-vieillesse et survivants) suisse — format normé `756.XXXX.XXXX.XX`
 * (756 = préfixe pays ISO 3166-1 numérique de la Suisse, obligatoire dans le format).
 */
const RE_AVS = /\b756\.\d{4}\.\d{4}\.\d{2}\b/g;

/** `true` si le nom de clé (quelle que soit sa forme) doit systématiquement être masqué. */
function estCleSensible(cle: string): boolean {
  const normalisee = normaliserCle(cle);
  return CLES_SENSIBLES.some((motif) => normalisee.includes(motif));
}

/** Retire les motifs reconnus (email, VIN, plaque, téléphone, IBAN, AVS) d'une chaîne libre. */
function assainirChaine(valeur: string): string {
  return valeur
    .replace(RE_EMAIL, MASQUE)
    .replace(RE_AVS, MASQUE)
    .replace(RE_IBAN, MASQUE)
    .replace(RE_TEL_CH, MASQUE)
    .replace(RE_VIN, MASQUE)
    .replace(RE_PLAQUE_CH, MASQUE);
}

const PROFONDEUR_MAX = 8;

/** Nettoyage récursif générique : masque les clés sensibles, assainit les chaînes restantes. */
function assainirValeur(valeur: unknown, profondeur = 0): unknown {
  if (profondeur > PROFONDEUR_MAX) {
    return MASQUE;
  }
  if (typeof valeur === 'string') {
    return assainirChaine(valeur);
  }
  if (Array.isArray(valeur)) {
    return valeur.map((element) => assainirValeur(element, profondeur + 1));
  }
  if (valeur !== null && typeof valeur === 'object') {
    const source = valeur as Record<string, unknown>;
    const resultat: Record<string, unknown> = {};
    for (const [cle, val] of Object.entries(source)) {
      resultat[cle] = estCleSensible(cle) ? MASQUE : assainirValeur(val, profondeur + 1);
    }
    return resultat;
  }
  return valeur;
}

/**
 * Clés top-niveau autorisées dans `extra` : celles posées par notre propre code
 * (`ContexteErreurSentry`, voir `capturer-erreur-inattendue.ts`) — des identifiants techniques,
 * jamais une donnée personnelle.
 *
 * ALLOW-LIST plutôt que deny-list (recommandation de l'audit, tranchée ici) : aucun appel de ce
 * dépôt ne renseigne `extra` aujourd'hui (`FiltreProbleme` pose des TAGS, jamais d'`extra`), donc
 * une allow-list ne coûte rien en fonctionnalité perdue. Elle a en revanche une propriété qu'une
 * deny-list n'a pas : une deny-list doit deviner À L'AVANCE chaque nom de champ qu'un futur appel
 * `Sentry.setExtra` ou `scope.setContext` pourrait y mettre par erreur (c'est exactement ce qui a
 * fuité en H1 — `recherche`, `libelle`, aucun des deux dans l'ancienne liste) ; une allow-list
 * borne l'inverse : quoi qu'un futur appel y mette, seules ces clés-là sortiront. Le coût est
 * qu'ajouter un nouveau champ de diagnostic légitime à `extra` demande d'étendre cette liste —
 * un coût qu'on accepte volontiers pour des données de garages soumises à la nLPD.
 */
const CLES_EXTRA_AUTORISEES = new Set(['requeteId', 'tenantId', 'role', 'endpoint', 'methode']);

/**
 * Namespaces top-niveau autorisés dans `contexts` : ceux que le SDK peuple lui-même
 * automatiquement (runtime Node, OS, version de l'app, ressource cloud, contexte de trace…) —
 * strictement techniques, jamais alimentés par du code applicatif dans ce dépôt.
 *
 * Même arbitrage allow-list que `CLES_EXTRA_AUTORISEES` ci-dessus : un namespace `contexts`
 * inconnu (qu'un futur `scope.setContext('client', {...})` créerait par exemple) est DROPPÉ
 * entièrement plutôt que parcouru en espérant que le deny-list générique rattrape chacun de ses
 * champs. `trace` reste néanmoins repassé par le nettoyage générique ci-dessous (défense en
 * profondeur : son `data` peut porter des attributs de span, voir `assainirAttributsSpan`).
 */
const CLES_CONTEXTS_AUTORISEES = new Set([
  'app',
  'runtime',
  'os',
  'culture',
  'device',
  'cloud_resource',
  'missing_instrumentation',
  'trace',
]);

/**
 * Filtre `valeur` (un objet plat, ex. `event.extra` ou `event.contexts`) pour ne garder que les
 * clés top-niveau listées dans `clesAutorisees` — chaque valeur conservée repasse ensuite par
 * `assainirValeur` (défense en profondeur : une clé autorisée à exister ne garantit pas que son
 * contenu soit propre).
 */
function filtrerParAllowList(valeur: unknown, clesAutorisees: ReadonlySet<string>): unknown {
  if (valeur === null || typeof valeur !== 'object' || Array.isArray(valeur)) {
    return undefined;
  }
  const source = valeur as Record<string, unknown>;
  const resultat: Record<string, unknown> = {};
  for (const [cle, val] of Object.entries(source)) {
    if (clesAutorisees.has(cle)) {
      resultat[cle] = assainirValeur(val);
    }
  }
  return resultat;
}

/** Un chemin de requête relève-t-il de l'authentification (login, changement de mot de passe…) ? */
function estCheminAuthentification(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return /\/auth(\/|$|\?)/i.test(url);
}

function nettoyerEnTetes(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return headers;
  }
  const EN_TETES_RETIRES = new Set(['authorization', 'cookie', 'x-forwarded-authorization', 'proxy-authorization']);
  const resultat: Record<string, string> = {};
  for (const [nom, valeur] of Object.entries(headers)) {
    resultat[nom] = EN_TETES_RETIRES.has(nom.toLowerCase()) ? MASQUE : assainirChaine(valeur);
  }
  return resultat;
}

/**
 * Retire la query string d'une URL — jamais rédigée par motif, COUPÉE (voir commentaire de tête
 * de fichier) : une query string de DMS ne porte que des filtres de recherche (nom, téléphone,
 * plaque…), qui n'ont aucune valeur de diagnostic justifiant ce risque. Le chemin restant est
 * quand même passé par `assainirChaine` (défense en profondeur : un VIN ou une plaque peut
 * apparaître dans le chemin lui-même, ex. `/vehicules/WVWZZZ1KZAW123456`).
 */
function nettoyerUrl(url: string): string {
  const [chemin] = url.split('?');
  return assainirChaine(chemin ?? url);
}

/**
 * Attributs de span (OpenTelemetry) toujours masqués intégralement, quelle que soit leur forme :
 * un texte SQL peut embarquer des valeurs littérales (paramètres non liés), une query string
 * d'URL porte les mêmes filtres de recherche que `request.query_string`.
 */
const CLES_SPAN_MASQUAGE_TOTAL = new Set(['db.statement', 'db.query.text', 'url.query', 'http.target']);

/** Attributs de span porteurs d'une URL complète — la query string en est coupée, pas rédigée. */
const CLES_SPAN_URL = new Set(['http.url', 'url.full']);

/**
 * Nettoyage des attributs (`data`) d'un span — utilisé à la fois par `beforeSendSpan`
 * (branché en ligne dans `initialiser-sentry.ts`, voir le commentaire qui l'accompagne pour
 * pourquoi ce fichier ne nomme pas explicitement le type SDK `SpanJSON`/`SpanAttributes`) et, en
 * défense en profondeur, sur `event.spans` ci-dessous (les transactions embarquent aussi leurs
 * spans enfants directement dans l'événement).
 *
 * Générique plutôt que typé contre `SpanAttributes` : ce type n'est pas re-exporté par
 * `@sentry/nestjs` de façon fiable pour cette version du SDK (seul `@sentry/core`, une
 * dépendance transitive non déclarée, le porte) — dépendre de son nom exact aurait rendu ce
 * fichier fragile à une future montée de version du SDK. `Record<string, unknown>` capture
 * exactement la même forme utile ici (un objet plat clé → valeur), et TypeScript infère le type
 * concret au point d'appel (inférence contextuelle sur `beforeSendSpan`), sans que ce module ait
 * besoin de le nommer.
 */
export function assainirAttributsSpan<D extends Record<string, unknown>>(data: D): D {
  const resultat: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(data)) {
    const cleNormalisee = cle.toLowerCase();
    if (CLES_SPAN_MASQUAGE_TOTAL.has(cleNormalisee) || estCleSensible(cle)) {
      resultat[cle] = MASQUE;
    } else if (CLES_SPAN_URL.has(cleNormalisee) && typeof valeur === 'string') {
      resultat[cle] = nettoyerUrl(valeur);
    } else if (typeof valeur === 'string') {
      resultat[cle] = assainirChaine(valeur);
    } else {
      resultat[cle] = valeur;
    }
  }
  return resultat as D;
}

/**
 * Forme commune à `ErrorEvent` et `TransactionEvent` : les deux interfaces du SDK étendent
 * exactement le même `Event` de base (`request`, `user`, `extra`, `contexts`, `breadcrumbs`,
 * `message`, `exception`, `tags`, `spans`…), seul le champ discriminant `type` diffère
 * (`undefined` vs `'transaction'`). On dérive cette forme de `ErrorEvent` (qui, lui, s'importe
 * sans problème depuis `@sentry/nestjs`) plutôt que d'importer `TransactionEvent` par son nom —
 * même motif que `assainirAttributsSpan` ci-dessus. `assainirEvenement` reste ainsi utilisable
 * aussi bien pour `beforeSend` (ErrorEvent) que pour `beforeSendTransaction` (TransactionEvent,
 * branché en ligne dans `initialiser-sentry.ts`, où l'inférence contextuelle de
 * `Sentry.init(...)` fournit le type réel sans qu'on ait à l'importer).
 */
type FormeEvenementCommune = Omit<ErrorEvent, 'type'>;

/**
 * Nettoyage commun à `ErrorEvent` et `TransactionEvent` — voir `FormeEvenementCommune`.
 */
export function assainirEvenement<E extends FormeEvenementCommune>(event: E): E {
  if (event.request) {
    const { request } = event;

    // Jamais de cookies bruts (contiennent le jeton de session).
    delete request.cookies;

    // En-têtes : Authorization/Cookie retirés, le reste assaini par motif.
    request.headers = nettoyerEnTetes(request.headers);

    // Corps de requête des endpoints d'authentification : retiré intégralement (mot de passe
    // en clair à la connexion, jeton au rafraîchissement…), pas seulement masqué champ par
    // champ — un endpoint d'auth n'a de toute façon aucune valeur de diagnostic à conserver
    // dans son corps.
    if (estCheminAuthentification(request.url)) {
      delete request.data;
    } else if (request.data !== undefined) {
      request.data = assainirValeur(request.data);
    }

    if (typeof request.url === 'string') {
      request.url = nettoyerUrl(request.url);
    }
    // Query string : jamais transmise, voir `nettoyerUrl` et le commentaire de tête de fichier.
    delete request.query_string;
  }

  // Identité utilisateur : jamais d'email/nom d'utilisateur envoyés à Sentry, même si un
  // mécanisme du SDK les avait renseignés automatiquement (défense en profondeur — l'app ne
  // les renseigne jamais elle-même, voir `capturer-erreur-inattendue.ts`).
  if (event.user) {
    const { id } = event.user;
    event.user = id !== undefined ? { id } : undefined;
  }

  // Allow-list sur extra/contexts : voir CLES_EXTRA_AUTORISEES / CLES_CONTEXTS_AUTORISEES pour
  // l'arbitrage. `undefined` (rien d'autorisé trouvé) plutôt qu'un objet vide, pour rester
  // cohérent avec l'absence du champ dans un événement qui n'en portait pas.
  if (event.extra) {
    const filtre = filtrerParAllowList(event.extra, CLES_EXTRA_AUTORISEES) as typeof event.extra;
    event.extra = filtre && Object.keys(filtre).length > 0 ? filtre : undefined;
  }
  if (event.contexts) {
    const filtre = filtrerParAllowList(event.contexts, CLES_CONTEXTS_AUTORISEES) as typeof event.contexts;
    event.contexts = filtre && Object.keys(filtre).length > 0 ? filtre : undefined;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((miette) => ({
      ...miette,
      message: miette.message ? assainirChaine(miette.message) : miette.message,
      data: miette.data ? (assainirValeur(miette.data) as typeof miette.data) : miette.data,
    }));
  }
  if (event.message) {
    event.message = assainirChaine(event.message);
  }
  if (event.exception?.values) {
    event.exception = {
      ...event.exception,
      values: event.exception.values.map((valeur) => ({
        ...valeur,
        value: valeur.value ? assainirChaine(valeur.value) : valeur.value,
      })),
    };
  }
  if (event.tags) {
    const tagsNettoyes: Record<string, unknown> = {};
    for (const [cle, valeur] of Object.entries(event.tags)) {
      tagsNettoyes[cle] = estCleSensible(cle) ? MASQUE : typeof valeur === 'string' ? assainirChaine(valeur) : valeur;
    }
    event.tags = tagsNettoyes as typeof event.tags;
  }
  // Défense en profondeur : une transaction embarque ses spans enfants directement dans
  // l'événement (`event.spans`), en plus de ceux qui passent individuellement par
  // `beforeSendSpan` — les deux chemins doivent être nettoyés, l'ordre d'appel interne du SDK
  // n'étant pas un contrat qu'on veut avoir à vérifier à chaque montée de version.
  if (event.spans) {
    event.spans = event.spans.map((span) => ({ ...span, data: assainirAttributsSpan(span.data) }));
  }

  return event;
}

/**
 * `beforeSend` de `Sentry.init()`. Ne renvoie jamais `null` (n'annule pas l'envoi) : le but est
 * de nettoyer l'événement, pas de le supprimer — un événement moins riche mais nettoyé reste
 * utile au diagnostic.
 */
export function nettoyerEvenementSentry(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  return assainirEvenement(event);
}
