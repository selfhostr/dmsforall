/**
 * Interfaces publiques du module auth (contrat gelé étape 0, §2.10).
 *
 * Séparées des implémentations (comme `apps/api/src/db/db.types.ts` sépare `AccesBase` de son
 * implémentation `acces-base.service.ts`) : un consommateur externe au module (ex. le futur
 * module `socle` pour lire `PrincipalAuthentifie`) importe ce fichier sans tirer Argon2, Redis ou
 * quoi que ce soit d'autre dans son graphe de compilation.
 */

import type { EntreeConnexion, SessionCourante } from '@dfa/shared';

import type { UtilisateurAmorcage } from '../db/db.types';
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
  ouvrir(
    u: UtilisateurAmorcage,
    ip: string | null,
    ua: string | null,
  ): Promise<SessionOuverte>;

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
