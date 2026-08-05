import { Injectable } from '@nestjs/common';
import type {
  NomInterfaceConnecteur,
  ReponseEnvoiMessageClient,
  RequeteEnvoiMessageClient,
} from '@dfa/shared';

import type { AdaptateurNotificationSender } from '../adaptateur-notification-sender';

import { AdaptateurConnecteurFactice } from './adaptateur-connecteur-factice.base';

/**
 * Adaptateur factice de l'interface `NotificationSender` — même situation que
 * `AdaptateurAccountingExporterFactice` : aucun prestataire réel (SMS/e-mail) n'est câblé nulle
 * part aujourd'hui, cette classe modélise la présence/absence du connecteur au niveau du registre
 * générique et fournit une implémentation SÛRE de la méthode métier spécialisée `envoyer()` pour
 * les tests (et pour un futur environnement de développement du module de relances, avant qu'un
 * vrai prestataire ne soit branché).
 *
 * `executer()` hérité tel quel de `AdaptateurConnecteurFactice` (générique, déjà testé) —
 * `envoyer()` est la méthode ajoutée par `AdaptateurNotificationSender`.
 *
 * `envoyer()` NE FAIT JAMAIS d'appel réseau, NE LÈVE JAMAIS. Toujours-accepté par construction :
 * ce factice ne modélise volontairement AUCUN comportement conditionnel de rejet (canal non
 * supporté, destinataire invalide…) — un rejet réel dépend d'un prestataire précis (format de
 * numéro refusé, quota atteint), que ce module s'interdit de présumer (même doctrine que les cinq
 * autres factices : journaliser au lieu d'appeler quoi que ce soit, jamais simuler la logique
 * métier d'un tiers). Le comportement de rejet (`ReponseEnvoiMessageClientRejetee`) est un état
 * du TYPE de retour, prouvé au niveau du contrat et de la garde de journalisation dans le spec
 * associé, pas un chemin que ce factice emprunte lui-même.
 *
 * JOURNALISATION SANS PII (voir l'avertissement en tête de `notification-sender.ts`) : seuls
 * `typeConnecteurCode`, `nomInterface`, `requete.contenu.canal`, `requete.cleIdempotence` et
 * `requete.langue` sont journalisés — JAMAIS `requete.contenu.destinataire`, JAMAIS
 * `requete.contenu.texte`/`sujet`/`html`, JAMAIS `requete.referenceExterne` (qui pourrait porter du
 * sens client selon l'appelant, alors que rien ne le garantit ici).
 */
@Injectable()
export class AdaptateurNotificationSenderFactice
  extends AdaptateurConnecteurFactice
  implements AdaptateurNotificationSender
{
  readonly nomInterface: Extract<NomInterfaceConnecteur, 'NotificationSender'> =
    'NotificationSender';
  readonly typeConnecteurCode = 'factice_notification_sender';

  async envoyer(requete: RequeteEnvoiMessageClient): Promise<ReponseEnvoiMessageClient> {
    this.journal.info('connecteurs.adaptateur_factice.envoi_message', {
      typeConnecteurCode: this.typeConnecteurCode,
      nomInterface: this.nomInterface,
      canal: requete.contenu.canal,
      cleIdempotence: requete.cleIdempotence,
      langue: requete.langue,
    });
    return {
      statut: 'accepte',
      identifiantMessagePrestataire: `factice-${requete.cleIdempotence}`,
    };
  }
}
