import type { Langue } from '@dfa/shared';

/** Contenu de l'e-mail d'essai, dans la langue de la personne qui le déclenche. */
export function libellesCourrielEssai(
  langue: Langue,
  nomGarage: string,
): { sujet: string; texte: string } {
  switch (langue) {
    case 'de':
      return {
        sujet: `Testnachricht von ${nomGarage}`,
        texte: `Diese Nachricht bestätigt, dass der E-Mail-Versand von ${nomGarage} funktioniert. Sie müssen nichts weiter tun.`,
      };
    case 'it':
      return {
        sujet: `Messaggio di prova di ${nomGarage}`,
        texte: `Questo messaggio conferma che l'invio delle e-mail di ${nomGarage} funziona. Non deve fare altro.`,
      };
    default:
      return {
        sujet: `E-mail d'essai de ${nomGarage}`,
        texte: `Ce message confirme que l'envoi des e-mails de ${nomGarage} fonctionne. Vous n'avez rien d'autre à faire.`,
      };
  }
}
