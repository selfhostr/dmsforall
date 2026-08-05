import {
  type CanalMessageClient,
  type RaisonRejetMessageClient,
  type StatutEnvoiMessageClient,
} from './enums';
import type { Langue } from '../enums';

/**
 * `NotificationSender` — sixième interface de connecteur, `docs/specification-relances-
 * automatiques.md` §6.3 : « Il manque une sixième interface de connecteur (…) même doctrine —
 * port générique, aucun nom de fournisseur en dur, adaptateur factice pour les tests. Préalable
 * au lot d'envoi. » Elle transporte l'envoi d'UN message (SMS ou e-mail) à UN client — le
 * mécanisme générique par lequel le module de relances (`apps/api/src/facturation/relances/`,
 * lot 1 de cette spécification) fait effectivement partir un rappel.
 *
 * CE QUE CE FICHIER N'EST PAS : un contrat HTTP. Contrairement à `import.ts`/`export.ts`
 * (`POST /connecteurs/activations/{id}/imports|exports`), aucune route publique n'est posée ici,
 * délibérément. L'appelant de cette interface est TOUJOURS le serveur lui-même (le worker de
 * relances), jamais un tenant via l'API : exposer un `POST .../messages` générique laisserait
 * contourner les règles de consentement/ciblage qui vivent dans le module appelant (RA-01, RA-02,
 * RA-14 — un interrupteur « ne plus jamais contacter » qui prime sur tout). Un futur besoin de
 * renvoi manuel par un garagiste passe par une action du module de relances lui-même
 * (`POST /relances/{id}/renvoyer`, hors périmètre de ce fichier), pas par un accès direct à ce
 * connecteur. C'est pourquoi les types ci-dessous sont des interfaces TypeScript simples, sans
 * schéma `zod` — même doctrine que `LigneEcritureExport`/`EcritureExport`
 * (`contrats/facturation/export.ts`) : un objet assemblé et consommé côté serveur, jamais un
 * corps de requête HTTP à valider contre une entrée non fiable.
 *
 * SIX DÉCISIONS DE DESIGN (justifiées en détail dans le rapport d'accompagnement de l'agent qui a
 * posé ce fichier) :
 *
 *  1. ASYNCHRONIE — `envoyer()` (port réel, `apps/api`, hors périmètre de ce fichier) rend un
 *     ACCUSÉ D'ACCEPTATION (`ReponseEnvoiMessageClient`), jamais un résultat de remise finale : le
 *     prestataire accepte le message, la remise arrive plus tard. `identifiantMessagePrestataire`
 *     est la seule poignée conservée pour une réconciliation FUTURE (webhook entrant ou sondage,
 *     NI L'UN NI L'AUTRE modélisé ici) — `relance_envoi.statut_envoi` (§5 de la spécification) ne
 *     connaît lui-même que `envoye`/`echoue`, aucun état « livré » n'existe encore dans le modèle
 *     de données appelant : ne pas inventer un mécanisme de réconciliation que rien en aval ne
 *     consomme aujourd'hui.
 *  2. IDEMPOTENCE — portée par CE contrat (`cleIdempotence`, obligatoire), pas seulement par le
 *     module de relances. La contrainte unique `(tenant_id, type_relance, objet_id, palier)` sur
 *     `relance_planifiee` (RA-05, §6.1) empêche une DOUBLE PLANIFICATION, et la mise à jour
 *     conditionnelle `WHERE statut = 'prete'` empêche un DOUBLE PASSAGE À L'ENVOI côté worker —
 *     mais le socle de résilience générique (`ServiceExecuteurConnecteurResilient`) réessaie tout
 *     rejet de promesse jusqu'à `nombreMaxTentatives`, y compris un `delai_depasse` où le message a
 *     PEUT-ÊTRE déjà été transmis avant que la réponse ne se perde. Sans clé transmise à
 *     l'adaptateur, un réessai de résilience peut produire un second SMS réel, facturé et reçu deux
 *     fois — exactement ce que RA-05 interdit. `cleIdempotence` est donc un champ OBLIGATOIRE de ce
 *     contrat ; sa valeur est produite et possédée par l'appelant (probable candidat :
 *     `${relancePlanifieeId}:${tentative}`, ou un UUID stocké dans `relance_envoi` — décision du
 *     module de relances, hors périmètre).
 *  3. COÛT — DÉLIBÉRÉMENT ABSENT de ce contrat. Écarté pour deux raisons : (a) aucun modèle de
 *     coût générique ne tient à la fois pour SMS (tarif par segment, variable par pays) et e-mail
 *     (souvent gratuit ou forfaitaire) sans déjà présumer la forme d'un prestataire précis — ce
 *     que ce module s'interdit ; (b) rien dans la spécification des relances automatiques
 *     n'exige un suivi de coût — §7 discute une CORRÉLATION de valeur, jamais une dépense, et
 *     avertit explicitement contre les chiffres non vérifiables. Si un suivi de coût devient
 *     nécessaire, c'est un champ optionnel additif sur `ReponseEnvoiMessageClientAcceptee`, pas une
 *     rupture de ce contrat.
 *  4. CANAUX — `CanalMessageClient` (`enums.ts`), extensible, aujourd'hui `sms`/`email`
 *     uniquement (seuls canaux mentionnés par §5 de la spécification). Modélisé comme le
 *     discriminant d'une union (`ContenuMessageClient` ci-dessous) plutôt qu'un champ plat, pour
 *     qu'un canal et son contenu (et son format de destinataire) ne puissent jamais diverger à la
 *     compilation — ajouter un canal, c'est ajouter un membre d'union, jamais retoucher les deux
 *     existants.
 *  5. LANGUE — transportée en paramètre EXPLICITE (`RequeteEnvoiMessageClient.langue`), jamais
 *     déduite par cette interface. RA-11 : la langue est lue par l'APPELANT au moment de l'envoi
 *     (`client.langue`, pas figée à la planification) ; RA-12 : le contenu réellement envoyé est
 *     déjà FIGÉ par l'appelant avant l'appel (« jamais recalculé après coup »). Cette interface ne
 *     résout donc AUCUN gabarit — `contenu` porte un texte déjà rendu, jamais une clé de gabarit —
 *     `langue` n'est ici qu'une MÉTADONNÉE transmise au prestataire (ex. jeu de caractères SMS,
 *     en-tête `Content-Language` d'un e-mail), informative, jamais décisionnelle côté connecteur.
 *  6. AUCUN NOM DE PRESTATAIRE — comme les cinq autres interfaces (`enums.ts`, en-tête), ce
 *     fichier ne connaît qu'un canal (`sms`/`email`) et un slug de type de connecteur
 *     (`ReponseTypeConnecteur.code`), jamais une marque.
 *
 * DONNÉES PERSONNELLES — AVERTISSEMENT pour l'agent qui câblera l'adaptateur réel
 * (`apps/api/src/connecteurs/`) : `ContenuMessageClient.destinataire` (numéro/adresse),
 * `ContenuMessageClient.texte`/`sujet`/`html` (contenu du rappel — peut nommer le client, le
 * véhicule, un montant dû) sont des DONNÉES PERSONNELLES. Le socle de résilience existant
 * (`resilience/service-executeur-connecteur-resilient.ts`) journalise déjà une liste FERMÉE de
 * champs (tenant, type de connecteur, interface, opération, nature, tentative, raison, nom/message
 * d'erreur techniques) et n'envoie JAMAIS `requete.donnees` au journal — ce contrat doit rester
 * COMPATIBLE avec cette garde-fou : `ContenuMessageClient` ne doit jamais être promu vers un champ
 * nommément journalisé (`nature`, `objetId` ou équivalent), et un futur adaptateur ne doit jamais
 * loguer littéralement `ReponseEnvoiMessageClientRejetee.message` — de nombreux prestataires y
 * échouent le destinataire en clair (« numéro invalide : +41791234567 »).
 */

/* ------------------------------------------------------------------ */
/* Déclaration (ce qu'un adaptateur sait faire — même rôle que         */
/* `CapacitesExport`/`CapacitesListingPublisher`)                      */
/* ------------------------------------------------------------------ */

export interface CapacitesNotificationSender {
  /** Sous-ensemble de `CANAUX_MESSAGE_CLIENT` réellement supporté par CET adaptateur — permet à
   *  l'écran de paramétrage de désactiver un canal qu'un prestataire donné ne sait pas envoyer,
   *  plutôt que d'échouer à l'envoi (même doctrine que `CapacitesListingPublisher.photos`). */
  readonly canaux: readonly CanalMessageClient[];
  /**
   * `true` si le prestataire notifie DFA d'un échec de remise SURVENU APRÈS l'acceptation (bounce,
   * plainte spam, numéro invalide détecté a posteriori) par un mécanisme non modélisé dans ce
   * fichier (webhook entrant — symétrique inverse des abonnements sortants de `webhook.ts` — ou
   * sondage). `false` : seule l'acceptation/le rejet synchrones font foi, aucune réconciliation
   * n'est possible avec cet adaptateur. Champ purement DÉCLARATIF aujourd'hui — voir la décision 1
   * en tête de fichier : rien en aval (`relance_envoi.statut_envoi`) ne consomme encore une
   * confirmation de remise, ce booléen documente seulement la CAPACITÉ, pas un flux câblé.
   */
  readonly confirmationLivraisonAsynchrone: boolean;
}

export interface DeclarationNotificationSender {
  /** Slug du TYPE de connecteur (`ReponseTypeConnecteur.code`, `connecteur.ts`) — jamais un nom de
   *  partenaire en dur, même règle que `DeclarationListingPublisher.typeConnecteurCode`. */
  readonly typeConnecteurCode: string;
  readonly capacites: CapacitesNotificationSender;
}

/* ------------------------------------------------------------------ */
/* Contenu — union discriminée par canal (décision 4)                  */
/* ------------------------------------------------------------------ */

/** DONNÉE PERSONNELLE (voir l'avertissement en tête de fichier). Format E.164 attendu, même
 *  convention que `schemaTelephoneE164` (`contrats/atelier/primitives.ts`) — non ré-exporté ici
 *  pour ne pas transformer un objet interne en frontière `zod` (voir l'en-tête). */
export interface ContenuMessageSms {
  readonly canal: 'sms';
  readonly destinataire: string;
  /** Texte déjà rendu et localisé par l'appelant (RA-11/RA-12) — jamais une clé de gabarit ni un
   *  identifiant de `texte_modele_id`. La segmentation multi-SMS est un détail de sérialisation
   *  propre à chaque prestataire, non modélisé ici. */
  readonly texte: string;
}

/** DONNÉE PERSONNELLE (voir l'avertissement en tête de fichier). Format RFC 5322 attendu, même
 *  convention que `schemaEmail` (`contrats/atelier/primitives.ts`). */
export interface ContenuMessageEmail {
  readonly canal: 'email';
  readonly destinataire: string;
  readonly sujet: string;
  /** Corps texte brut, toujours renseigné (repli garanti pour un client de messagerie qui refuse
   *  le HTML). */
  readonly texte: string;
  /** Corps HTML, facultatif — `null` pour un envoi texte seul. */
  readonly html: string | null;
}

/** Le canal ET le format de destinataire voyagent TOUJOURS ensemble (décision 4) : impossible de
 *  construire un `canal: 'sms'` avec un contenu `email` à la compilation. */
export type ContenuMessageClient = ContenuMessageSms | ContenuMessageEmail;

/* ------------------------------------------------------------------ */
/* Requête d'envoi                                                     */
/* ------------------------------------------------------------------ */

export interface RequeteEnvoiMessageClient {
  /**
   * OBLIGATOIRE (décision 2) — possédée et produite par l'appelant, jamais par ce connecteur.
   * Un adaptateur réel qui interroge un prestataire supportant une clé de déduplication native la
   * lui transmet telle quelle ; un adaptateur qui ne le supporte pas doit au minimum s'en servir
   * pour reconnaître LOCALEMENT un réessai de résilience et éviter un second appel réseau.
   */
  readonly cleIdempotence: string;
  /** Langue de correspondance du client, résolue par l'appelant au moment de l'envoi (RA-11) —
   *  MÉTADONNÉE informative pour le prestataire (jeu de caractères, en-tête `Content-Language`),
   *  jamais une clé de résolution de gabarit (décision 5). */
  readonly langue: Langue;
  /** Porte à la fois le canal, le destinataire et le texte déjà rendu (décision 4). DONNÉE
   *  PERSONNELLE — voir l'avertissement en tête de fichier. */
  readonly contenu: ContenuMessageClient;
  /**
   * Référence libre vers l'objet métier à l'origine de l'envoi (ex. `relance_planifiee.id`) —
   * UNIQUEMENT pour un lien de traçabilité côté prestataire si celui-ci le permet (ex. tag de
   * campagne dans son propre tableau de bord). Un identifiant technique, jamais une donnée
   * personnelle — sûr à transmettre à un champ journalisé si un futur besoin l'exige, contrairement
   * à `contenu`. `null` si l'appelant n'a rien de pertinent à transmettre.
   */
  readonly referenceExterne: string | null;
}

/* ------------------------------------------------------------------ */
/* Résultat — union discriminée par statut (décision 1)                */
/* ------------------------------------------------------------------ */

export interface ReponseEnvoiMessageClientAcceptee {
  readonly statut: Extract<StatutEnvoiMessageClient, 'accepte'>;
  /** Identifiant attribué par le prestataire — la SEULE poignée conservée pour une réconciliation
   *  future (voir décision 1). Jamais vide : un adaptateur sans identifiant natif doit au minimum y
   *  reporter `cleIdempotence`, jamais une chaîne vide silencieuse. */
  readonly identifiantMessagePrestataire: string;
}

export interface ReponseEnvoiMessageClientRejetee {
  readonly statut: Extract<StatutEnvoiMessageClient, 'rejete'>;
  readonly raison: RaisonRejetMessageClient;
  /**
   * Message diagnostique COURT, destiné à un journal d'exploitation INTERNE (jamais montré tel
   * quel à un garagiste — même doctrine que `ProblemeDetail.detail`, `probleme.ts`). AVERTISSEMENT
   * (voir l'en-tête de fichier) : de nombreux prestataires échouent le destinataire en clair dans
   * ce genre de message — ne JAMAIS le faire atteindre `ServiceJournal` ou tout champ nommément
   * journalisé sans l'avoir d'abord expurgé.
   */
  readonly message: string;
}

/**
 * Un REJET est un résultat NORMAL de la promesse, jamais une exception (décision 1/3, voir aussi
 * `enums.ts::RAISONS_REJET_MESSAGE_CLIENT`) — même doctrine que
 * `ReponseLancerImportConnecteur.dejaImporte` (`import.ts`) : un état métier attendu vit dans le
 * type de retour, pas dans un `throw`. Seul un échec TRANSITOIRE (réseau, délai dépassé, panne du
 * prestataire) doit rejeter la promesse, pour rester absorbé par
 * `ServiceExecuteurConnecteurResilient` (réessais à espacement croissant, disjoncteur) sans qu'un
 * futur adaptateur ait à réimplémenter cette distinction lui-même.
 */
export type ReponseEnvoiMessageClient =
  ReponseEnvoiMessageClientAcceptee | ReponseEnvoiMessageClientRejetee;
