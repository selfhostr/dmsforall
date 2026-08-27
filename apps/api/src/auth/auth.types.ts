/**
 * Interfaces publiques du module auth (contrat gelé étape 0, §2.10).
 *
 * Séparées des implémentations (comme `apps/api/src/db/db.types.ts` sépare `AccesBase` de son
 * implémentation `acces-base.service.ts`) : un consommateur externe au module (ex. le futur
 * module `socle` pour lire `PrincipalAuthentifie`) importe ce fichier sans tirer Argon2, Redis ou
 * quoi que ce soit d'autre dans son graphe de compilation.
 */

import type {
  EntreeConfirmationReinitialisationMotDePasse,
  EntreeConnexion,
  EntreeDemandeReinitialisationMotDePasse,
  SessionCourante,
} from '@dfa/shared';

import type { ContexteTenant, TransactionDfa, UtilisateurAmorcage } from '../db/db.types';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';

// ---------------------------------------------------------------------------------------------
// Mot de passe
// ---------------------------------------------------------------------------------------------

export interface ServiceMotDePasse {
  /** Argon2id, paramètres lus depuis `Config` (`ARGON2_*`). Rend un hash encodé PHC complet. */
  hacher(clair: string): Promise<string>;

  verifier(hash: string, clair: string): Promise<boolean>;

  /**
   * Vérification sur un hash constant, pré-calculé une seule fois au démarrage du service.
   * Appelée à la place de `verifier()` quand l'utilisateur n'existe pas : le coût CPU d'Argon2 est
   * ainsi payé dans les deux cas (email connu / inconnu), ce qui égalise le temps de réponse et
   * empêche l'énumération de comptes par chronométrage de `POST /auth/connexion`.
   */
  verifierLeurre(): Promise<void>;

  /**
   * `true` si `hash` a été produit avec des paramètres Argon2 différents de ceux actuellement
   * configurés (montée de version des coûts). Le rehachage effectif se fait après vérification
   * réussie du mot de passe en clair — jamais à partir du seul hash.
   */
  doitEtreRehache(hash: string): boolean;
}

// ---------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------

export interface SessionOuverte {
  /** 32 octets CSPRNG en base64url. N'existe QUE dans cette réponse et dans le cookie posé. */
  readonly tokenClair: string;
  readonly sessionId: string;
  readonly expireLe: Date;
}

export interface ServiceSession {
  ouvrir(u: UtilisateurAmorcage, ip: string | null, ua: string | null): Promise<SessionOuverte>;

  /**
   * Valide, dans l'ordre : empreinte connue, non révoquée, `now <= expireLe` (absolu) ET
   * `now <= vuLe + SESSION_INACTIVITE_MINUTES` (glissant), utilisateur `actif`, tenant `actif`.
   *
   * Ne rend PAS `null` en pratique : lève `ErreurSessionAbsente` (empreinte inconnue de la base —
   * `amorcage.session_par_empreinte` ne filtre délibérément rien, voir `session.service.ts`) ou
   * `ErreurSessionExpiree` (empreinte connue mais session invalide) selon le cas, pour que
   * `GardeSession` puisse propager le bon code HTTP sans avoir à ré-interroger l'état de la
   * session. Le `| null` du type de retour reste pour compatibilité d'appelants défensifs.
   */
  resoudre(tokenClair: string): Promise<PrincipalAuthentifie | null>;

  /** Révoque la session courante (`revoquee_le = now()`). Idempotent côté appelant. */
  fermer(principal: PrincipalAuthentifie): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------------------------

export interface ServiceAuthentification {
  connecter(
    entree: EntreeConnexion,
    ip: string | null,
    ua: string | null,
  ): Promise<{ session: SessionOuverte; corps: SessionCourante }>;

  deconnecter(principal: PrincipalAuthentifie): Promise<void>;

  sessionCourante(principal: PrincipalAuthentifie): Promise<SessionCourante>;
}

// ---------------------------------------------------------------------------------------------
// Réinitialisation de mot de passe en libre-service (« mot de passe oublié »)
// ---------------------------------------------------------------------------------------------

export interface ServiceReinitialisationMotDePasse {
  /**
   * `POST /auth/mot-de-passe/oubli`. Réponse toujours identique côté appelant, que l'email
   * corresponde ou non à un compte réel (anti-énumération) — cette méthode ne lève donc jamais
   * pour un email inconnu/inactif, elle journalise et rend silencieusement.
   */
  demander(
    entree: EntreeDemandeReinitialisationMotDePasse,
    ip: string | null,
    ua: string | null,
  ): Promise<void>;

  /**
   * `POST /auth/mot-de-passe/reinitialisation`. Lève `ErreurJetonReinitialisationInvalide` pour
   * toute issue liée au JETON (email inconnu, jeton inconnu/expiré/déjà utilisé/révoqué, compte ou
   * tenant non actif) — jamais distingué côté appelant, même doctrine anti-énumération que
   * `connecter()`. Distinct d'un `ErreurMetier VALIDATION_ECHOUEE` (mot de passe refusé par la
   * politique, `politique-mot-de-passe.ts`) : CE refus-là ne consomme pas le jeton — voir
   * l'implémentation pour le raisonnement (le jeton reste valide, l'employé peut réessayer avec un
   * meilleur mot de passe sans redemander de lien). Révoque toutes les sessions actives de
   * l'utilisateur en cas de succès.
   */
  confirmer(
    entree: EntreeConfirmationReinitialisationMotDePasse,
    ip: string | null,
    ua: string | null,
  ): Promise<void>;

  /**
   * Révoque (marque `revoque_le`) tout jeton de réinitialisation encore valide de cet
   * utilisateur. Prend la TRANSACTION en paramètre plutôt que d'ouvrir la sienne : appelée
   * DEPUIS la transaction d'un autre geste d'administration (`ServiceUtilisateur
   * .reinitialiserAcces`) pour rester atomique avec lui (voir CONTRIBUTING.md, « AccesBase.enTenant
   * depuis une transaction ouverte n'est pas atomique ») — sans quoi un jeton en libre-service
   * émis avant qu'un admin ne reprenne la main sur le compte resterait utilisable après coup.
   */
  revoquerJetonsActifsDansTransaction(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    utilisateurId: string,
  ): Promise<void>;
}
