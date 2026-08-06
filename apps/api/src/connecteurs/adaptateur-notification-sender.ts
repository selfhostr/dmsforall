import type {
  NomInterfaceConnecteur,
  ReponseEnvoiMessageClient,
  RequeteEnvoiMessageClient,
} from '@dfa/shared';

import type { AdaptateurConnecteur } from './adaptateur-connecteur';

/**
 * Port SPÉCIFIQUE de l'interface `NotificationSender` — SIXIÈME interface de connecteur
 * (`NOMS_INTERFACE_CONNECTEUR`, `@dfa/shared`), même situation qu'`AccountingExporter` : un
 * contrat métier déjà entièrement typé existe (`contrats/connecteurs/notification-sender.ts` —
 * lire son en-tête avant de toucher à ce fichier, les six décisions de design y sont justifiées),
 * mais aucun vrai prestataire n'est câblé nulle part aujourd'hui.
 *
 * POURQUOI CETTE INTERFACE ÉTEND `AdaptateurConnecteur` PLUTÔT QUE D'EN ÊTRE INDÉPENDANTE : elle
 * participe au MÊME registre générique que les cinq autres interfaces — `nomInterface` /
 * `typeConnecteurCode` / `executer()` sont hérités tels quels, sans rien réinventer côté
 * `RegistreConnecteursService.resoudre()` ni `ServiceExecuteurConnecteurResilient.executer()`, qui
 * restent tous deux typés sur le port générique `AdaptateurConnecteur` (voir leur code respectif).
 * Un adaptateur `NotificationSender` — factice aujourd'hui, réel demain — se déclare, s'active et
 * se résout exactement comme un `ListingPublisher` ou un `AccountingExporter` : même table
 * `connecteur_activation` (à venir), même disjoncteur par `(tenant, typeConnecteurCode)`, même
 * journalisation sans secret.
 *
 * CE QUI S'AJOUTE, ET POURQUOI : la vraie méthode métier typée `envoyer()`, que le module de
 * relances (`apps/api/src/relances/service-relances-facture.ts`, `envoyerPretes()`) appelle
 * DIRECTEMENT pour faire partir un rappel, plutôt que de passer par le mécanisme générique
 * `RequeteOperationConnecteur`/`ResultatOperationConnecteur` (pensé pour de l'import/export en
 * masse, pas pour l'envoi d'UN message à UN client). Même distinction que `AccountingExporter` /
 * `facturation/export/winbiz/winbiz-exporteur.service.ts` : le registre générique modélise la
 * PRÉSENCE du connecteur, le vrai travail métier passe par une méthode spécialisée exposée à côté.
 *
 * HORS PÉRIMÈTRE, DÉLIBÉRÉMENT : câbler `envoyer()` dans le chemin de résilience générique
 * (`ServiceExecuteurConnecteurResilient`, délai/réessais à espacement croissant/disjoncteur) n'est
 * TOUJOURS PAS fait. Ce service reste partagé par les cinq autres interfaces et ne connaît que
 * `RequeteOperationConnecteur`/`ResultatOperationConnecteur`. Le module de relances a tranché entre
 * les deux options documentées ici auparavant : il appelle `envoyer()` directement
 * (`traiterUneRelance()`) et réimplémente localement sa propre absorption d'échec transitoire (un
 * `catch` local qui journalise sans PII et marque la ligne `rejete`/`quota_depasse`, sans réessai
 * ni disjoncteur) — l'IDEMPOTENCE reste portée par `RequeteEnvoiMessageClient.cleIdempotence` (voir
 * décision 2 du contrat), pas par ce socle de résilience. `ServiceExecuteurConnecteurResilient`
 * n'a donc toujours aucun appelant pour `NotificationSender` ; le généraliser resterait à faire
 * si un besoin réel de réessai/disjoncteur partagé apparaît pour ce connecteur.
 */
export interface AdaptateurNotificationSender extends AdaptateurConnecteur {
  readonly nomInterface: Extract<NomInterfaceConnecteur, 'NotificationSender'>;
  envoyer(requete: RequeteEnvoiMessageClient): Promise<ReponseEnvoiMessageClient>;
}
