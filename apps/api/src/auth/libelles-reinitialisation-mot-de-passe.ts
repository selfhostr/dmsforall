/**
 * Libellés du courriel de réinitialisation de mot de passe en libre-service — même doctrine que
 * `atelier/impression/libelles-impression-or.ts` (dictionnaire minimal LOCAL à ce module, pas le
 * mécanisme i18next du front, qui n'existe pas côté serveur). Langue = celle du COMPTE
 * (`utilisateur.langue`), jamais celle du navigateur qui a soumis la demande — ce champ est déjà
 * la source de vérité de la langue d'un employé partout ailleurs (`SessionCourante.utilisateur
 * .langue`).
 *
 * Texte SEUL (`corpsTexte`) : pas de HTML pour ce premier jet — un courriel de sécurité gagne à
 * rester simple et vérifiable visuellement (un lien HTML habillé masque plus facilement une
 * redirection). `MessageCourriel.corpsHtml` reste disponible si un futur habillage est demandé.
 */

import type { Langue } from '@dfa/shared';

export interface LibellesReinitialisationMotDePasse {
  readonly sujet: string;
  /** `lien` : URL complète vers l'écran front de confirmation. `dureeMinutes` : durée de
   *  validité du jeton, pour que l'employé sache combien de temps il a pour agir. */
  readonly corpsTexte: (lien: string, dureeMinutes: number) => string;
}

const FR: LibellesReinitialisationMotDePasse = {
  sujet: 'Réinitialisation de votre mot de passe dmsforall',
  corpsTexte: (lien, dureeMinutes) =>
    `Bonjour,\n\n` +
    `Une réinitialisation de mot de passe a été demandée pour votre compte dmsforall.\n\n` +
    `Pour choisir un nouveau mot de passe, ouvrez le lien ci-dessous dans les ${String(dureeMinutes)} minutes :\n` +
    `${lien}\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message — votre mot de passe ` +
    `actuel reste inchangé et ce lien expirera de lui-même.\n\n` +
    `— dmsforall`,
};

const DE: LibellesReinitialisationMotDePasse = {
  sujet: 'Zurücksetzen Ihres dmsforall-Passworts',
  corpsTexte: (lien, dureeMinutes) =>
    `Guten Tag,\n\n` +
    `Für Ihr dmsforall-Konto wurde eine Passwort-Zurücksetzung angefordert.\n\n` +
    `Öffnen Sie den folgenden Link innerhalb von ${String(dureeMinutes)} Minuten, um ein neues Passwort zu wählen:\n` +
    `${lien}\n\n` +
    `Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail — Ihr aktuelles ` +
    `Passwort bleibt unverändert, und der Link läuft von selbst ab.\n\n` +
    `— dmsforall`,
};

const IT: LibellesReinitialisationMotDePasse = {
  sujet: 'Reimpostazione della password dmsforall',
  corpsTexte: (lien, dureeMinutes) =>
    `Buongiorno,\n\n` +
    `È stata richiesta la reimpostazione della password per il vostro account dmsforall.\n\n` +
    `Per scegliere una nuova password, aprite il link seguente entro ${String(dureeMinutes)} minuti:\n` +
    `${lien}\n\n` +
    `Se non siete voi all'origine di questa richiesta, ignorate questo messaggio — la vostra ` +
    `password attuale resta invariata e il link scadrà automaticamente.\n\n` +
    `— dmsforall`,
};

const LIBELLES: Readonly<Record<Langue, LibellesReinitialisationMotDePasse>> = {
  fr: FR,
  de: DE,
  it: IT,
};

export function libellesReinitialisationMotDePasse(
  langue: Langue,
): LibellesReinitialisationMotDePasse {
  return LIBELLES[langue];
}
