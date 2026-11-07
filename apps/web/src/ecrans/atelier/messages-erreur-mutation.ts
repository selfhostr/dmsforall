import type { TFunction } from 'i18next';

import { ErreurApi, messageErreur, messageErreurChamp } from '@/api/erreurs';

/**
 * Message(s) à afficher pour l'échec d'une mutation dans un dialogue de ce module SANS
 * `react-hook-form` (état local contrôlé — `DialogueAjoutLigneOr`, `ListeLignesOrdreReparation`,
 * `PanneauActionsOr`, `FormulaireNouvelOrdreReparation` : tous cousins, même doctrine).
 *
 * §3.5 règle 5 du contrat : `ProblemeDetail.erreurs[]` est RÉSERVÉ à la validation de saisie et
 * porte, pour chaque champ fautif, soit un message métier écrit à la main en français par le
 * serveur (affichable tel quel — `messageErreurChamp`), soit un code natif zod (traduit
 * génériquement via `erreurs:codes.<CODE>`). Un `messageErreur(erreur, t)` brut ne lit QUE
 * `probleme.code` : pour un `VALIDATION_ECHOUEE`, ça retombe systématiquement sur le même
 * générique (« Certaines informations sont incorrectes. »), quel que soit le contenu réel
 * d'`erreurs[]`.
 *
 * Défaut réel constaté en test navigateur (fiche OR, dialogue « Ajouter une ligne ») : un taux
 * horaire introuvable (RM-07), rédigé par le serveur avec l'action précise à mener
 * (« Renseigner les taux horaires dans le paramétrage »), disparaissait derrière ce générique — un
 * garagiste qui a bien rempli son formulaire ne pouvait pas savoir quoi faire. `messagesErreurMutation`
 * corrige le cas GÉNÉRAL : dès qu'`erreursChamp` porte au moins une entrée, on affiche CES messages
 * (un par champ fautif), jamais le générique — pour tout code métier présent ou futur, sans cas
 * particulier codé en dur.
 *
 * Un dialogue `react-hook-form` (`FormulaireNouveauClient`) route ces mêmes messages SOUS le champ
 * fautif via `form.setError(champ, { message: messageErreurChamp(...) })`. Les dialogues de ce
 * module n'ont pas de `register()` par champ (état contrôlé) : pas d'ancrage possible par champ,
 * donc affichage groupé dans le même bandeau qui affichait déjà `messageErreur` — avec le VRAI
 * message au lieu du générique.
 *
 * Convention FR-only assumée, alignée sur `messageErreurChamp` (déjà en production, voir
 * `FormulaireNouveauClient`) : un message métier écrit à la main par le serveur est affiché tel
 * quel, même en interface DE/IT. Un code natif zod, lui, passe par la clé i18n existante et suit
 * la langue de l'écran.
 */
export function messagesErreurMutation(erreur: unknown, t: TFunction): readonly string[] {
  if (erreur instanceof ErreurApi && erreur.erreursChamp.length > 0) {
    return erreur.erreursChamp.map((champErreur) => messageErreurChamp(champErreur, t));
  }
  if (erreur instanceof ErreurApi && CODES_TRANSITION_INTERDITE.has(erreur.probleme.code)) {
    return [messageTransitionInterdite(erreur, t)];
  }
  return [messageErreur(erreur, t)];
}

const CODES_TRANSITION_INTERDITE: ReadonlySet<string> = new Set([
  'OR_TRANSITION_INTERDITE',
  'LIGNE_TRANSITION_INTERDITE',
]);

/** `detail` produit par le traducteur SQL de transition : `entite=ordre_reparation;depuis=a;vers=b`
 *  — une trace pour le support, pas une phrase pour le garagiste. */
const DETAIL_MACHINE = /^[a-z_]+=[^;]*(;[a-z_]+=[^;]*)*$/;

/**
 * « Transition interdite » dit pourquoi et quoi faire. Ordre : (1) le `detail` du `problem+json`
 * quand c'est une vraie phrase (ex. « Le contrôle qualité est obligatoire pour ce garage avant de
 * terminer ») — jamais sa forme machine ; (2) sinon le statut actuel de l'OR s'il est connu
 * (`blocages[].donnees.statutActuel`) ; (3) sinon la consigne générique. Dans tous les cas la
 * dernière phrase dit quoi faire : recharger la page et choisir parmi les actions proposées.
 */
function messageTransitionInterdite(erreur: ErreurApi, t: TFunction): string {
  const detail = erreur.probleme.detail?.trim();
  if (detail && !DETAIL_MACHINE.test(detail)) return detail;

  const statutActuel = erreur.blocages
    .map((blocage) => blocage.donnees?.statutActuel)
    .find((statut): statut is string => typeof statut === 'string');
  if (statutActuel) {
    const cle = statutActuel.replace(/_([a-z])/g, (_, lettre: string) => lettre.toUpperCase());
    return t('or:erreurs.transitionInterdite.avecStatut', {
      statut: t(`or:statuts.${cle}`, { defaultValue: statutActuel }),
    });
  }
  return t('or:erreurs.transitionInterdite.sansStatut');
}

/**
 * Variante à chaîne unique de `messagesErreurMutation`, pour les emplacements qui n'acceptent
 * qu'une seule chaîne (ex. `description` de `AvertissementConfirmable`) plutôt qu'une liste de
 * paragraphes. Joint les messages avec un espace — n'affecte aucun cas déjà observé (les
 * emplacements qui l'utilisent sont tous mutuellement exclusifs avec `erreursChamp` non vide, voir
 * §4.4 CONFIRMATION_REQUISE contre §3.5 VALIDATION_ECHOUEE) ; sert de garde-fou si ça change.
 */
export function messageErreurMutation(erreur: unknown, t: TFunction): string {
  return messagesErreurMutation(erreur, t).join(' ');
}

/**
 * Message d'un échec « marquer réalisée » : un `409 LIGNE_TRANSITION_INTERDITE` porte, dans le
 * `detail` du `problem+json`, la raison exacte (ex. ligne de main-d'œuvre jamais pointée) que le
 * libellé générique du code ne sait pas dire — on l'affiche alors tel quel, sans l'avaler. Tout
 * autre échec suit la règle commune (`messageErreurMutation`).
 */
export function messageErreurMarquage(erreur: unknown, t: TFunction): string {
  if (
    erreur instanceof ErreurApi &&
    erreur.probleme.code === 'LIGNE_TRANSITION_INTERDITE' &&
    erreur.probleme.detail
  ) {
    return erreur.probleme.detail;
  }
  return messageErreurMutation(erreur, t);
}
