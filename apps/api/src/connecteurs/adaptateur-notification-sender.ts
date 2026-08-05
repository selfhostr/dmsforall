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
 * CE QUI S'AJOUTE, ET POURQUOI : la vraie méthode métier typée `envoyer()`, que le futur module de
 * relances (`apps/api/src/facturation/relances/`, hors périmètre de cette tâche — un autre agent)
 * appellera DIRECTEMENT pour faire partir un rappel, plutôt que de passer par le mécanisme
 * générique `RequeteOperationConnecteur`/`ResultatOperationConnecteur` (pensé pour de l'import/
 * export en masse, pas pour l'envoi d'UN message à UN client). Même distinction que
 * `AccountingExporter` / `facturation/export/winbiz/winbiz-exporteur.service.ts` : le registre
 * générique modélise la PRÉSENCE du connecteur, le vrai travail métier passe par une méthode
 * spécialisée exposée à côté.
 *
 * HORS PÉRIMÈTRE, DÉLIBÉRÉMENT : câbler `envoyer()` dans le chemin de résilience générique
 * (`ServiceExecuteurConnecteurResilient`, délai/réessais à espacement croissant/disjoncteur) n'est
 * PAS fait ici. Ce service est partagé par les cinq autres interfaces et ne connaît aujourd'hui que
 * `RequeteOperationConnecteur`/`ResultatOperationConnecteur` — le généraliser pour qu'il enveloppe
 * aussi `envoyer()` toucherait un service commun sans appelant réel aujourd'hui (zéro module
 * n'invoque encore cette interface). Point d'extension futur documenté ici pour l'agent qui
 * câblera le module de relances : soit ce module appelle `envoyer()` directement et réimplémente
 * localement une politique de réessai adaptée à l'IDEMPOTENCE déjà portée par
 * `RequeteEnvoiMessageClient.cleIdempotence` (voir décision 2 du contrat), soit
 * `ServiceExecuteurConnecteurResilient` est généralisé à ce moment-là avec un besoin réel pour le
 * justifier.
 */
export interface AdaptateurNotificationSender extends AdaptateurConnecteur {
  readonly nomInterface: Extract<NomInterfaceConnecteur, 'NotificationSender'>;
  envoyer(requete: RequeteEnvoiMessageClient): Promise<ReponseEnvoiMessageClient>;
}
