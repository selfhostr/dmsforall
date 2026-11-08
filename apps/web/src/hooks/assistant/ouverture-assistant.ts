export interface EntreesOuvertureAssistant {
  /** La personne détient le droit de gérer les paramètres du garage. */
  readonly autorise: boolean;
  /** L'état de démarrage a répondu (jamais d'ouverture sur un état inconnu). */
  readonly etatConnu: boolean;
  /** Toutes les étapes obligatoires sont réglées : le garage n'est plus « neuf ». */
  readonly garageConfigure: boolean;
  /** La personne a déjà fermé l'assistant sur ce poste (par utilisateur et garage). */
  readonly ferme: boolean;
}

/**
 * L'assistant s'ouvre tout seul UNIQUEMENT pour la personne qui gère les paramètres d'un garage
 * pas encore configuré, une seule fois : une fermeture est mémorisée et ne se rouvre que par le
 * lien de reprise de l'accueil.
 */
export function doitOuvrirAutomatiquement(e: EntreesOuvertureAssistant): boolean {
  return e.autorise && e.etatConnu && !e.garageConfigure && !e.ferme;
}
