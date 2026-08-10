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
  return [messageErreur(erreur, t)];
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
