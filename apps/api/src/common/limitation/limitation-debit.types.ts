/**
 * Surface publique du service de limitation de débit (contrat gelé étape 0).
 *
 * L'interface est déclarée ICI et non dérivée de la classe concrète, pour une raison qui n'est
 * pas cosmétique : une classe expose ses champs privés dans son type. Dépendre de la classe
 * rendrait le service de connexion impossible à tester sans un vrai client Redis, alors que
 * `authentification.service` doit pouvoir être testé unitairement avec une doublure — et c'est
 * précisément sur ce service que portent les tests de non-énumération de comptes et de
 * verrouillage progressif.
 */

export interface ResultatLimitationDebit {
  readonly autorise: boolean;
  /** Secondes à attendre avant de pouvoir retenter, 0 si `autorise`. */
  readonly resteSecondes: number;
}

export interface ServiceLimitationDebit {
  /**
   * Consomme une tentative sur `cle` dans une fenêtre glissante.
   * N'échoue jamais par exception : le refus est une valeur de retour, pas une erreur.
   */
  consommer(cle: string, limite: number, fenetreSecondes: number): Promise<ResultatLimitationDebit>;
}
