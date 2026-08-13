import type { TFunction } from 'i18next';

import { ErreurApi, messageErreur, messageErreurChamp } from '@/api/erreurs';

/**
 * Message(s) à afficher pour l'échec d'une mutation dans un dialogue de CE module SANS
 * `react-hook-form` (état local contrôlé — `DialogueLigneDocumentVente`) — mirroir délibéré de
 * `ecrans/atelier/messages-erreur-mutation.ts` (même doctrine, même code, commentaire adapté au
 * module) : dupliqué plutôt qu'importé depuis `atelier/` (hors périmètre d'écriture de cet agent,
 * et ce petit utilitaire n'a aucune raison de dépendre d'un autre domaine métier).
 *
 * §3.5 règle 5 du contrat : `ProblemeDetail.erreurs[]` est RÉSERVÉ à la validation de saisie et
 * porte, pour chaque champ fautif, soit un message métier écrit à la main en français par le
 * serveur (affichable tel quel — `messageErreurChamp`), soit un code natif zod (traduit
 * génériquement via `erreurs:codes.<CODE>`). Un `messageErreur(erreur, t)` brut ne lit QUE
 * `probleme.code` : pour un `VALIDATION_ECHOUEE`, ça retombe systématiquement sur le même
 * générique (« Certaines informations sont incorrectes. »), quel que soit le contenu réel
 * d'`erreurs[]`.
 *
 * Premier consommateur RÉEL (issue #125) : le refus d'émission d'un document SANS AUCUNE LIGNE
 * (`ServiceEmissionDocument.emettre`, `apps/api/.../service-emission.ts`) réutilise le code
 * générique `VALIDATION_ECHOUEE` (aucun code dédié dans `CODES_ERREUR`, contrat gelé — signalé au
 * rapport de livraison) MAIS porte le VRAI message dans `erreurs[0].message` — ce générateur est
 * ce qui rend ce message visible dans le dialogue d'émission au lieu du bandeau générique. Second
 * consommateur : les échecs du dialogue d'ajout/modification de ligne lui-même.
 *
 * Convention FR-only assumée, alignée sur `messageErreurChamp` (déjà en production) : un message
 * métier écrit à la main par le serveur est affiché tel quel, même en interface DE/IT. Un code
 * natif zod, lui, passe par la clé i18n existante et suit la langue de l'écran.
 */
export function messagesErreurMutation(erreur: unknown, t: TFunction): readonly string[] {
  if (erreur instanceof ErreurApi && erreur.erreursChamp.length > 0) {
    return erreur.erreursChamp.map((champErreur) => messageErreurChamp(champErreur, t));
  }
  return [messageErreur(erreur, t)];
}
