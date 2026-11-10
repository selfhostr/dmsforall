/** Jeton et types de l'accès base propre à l'installation (rôle propriétaire, voir le service). */
import type { ExecuteurSql } from '../cli/creer-garage.service';

export const JETON_CONNEXION_INSTALLATION = Symbol('JETON_CONNEXION_INSTALLATION');

/** Connexion dédiée, empruntée le temps d'une opération puis rendue. */
export interface ConnexionInstallation extends ExecuteurSql {
  /** `detruire: true` ferme la connexion au lieu de la rendre au pool (état douteux). */
  liberer(detruire: boolean): void;
}

export interface FournisseurConnexionInstallation {
  emprunter(): Promise<ConnexionInstallation>;
  fermer(): Promise<void>;
}
