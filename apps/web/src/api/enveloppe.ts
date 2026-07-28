/**
 * Helpers pour les deux enveloppes de réponse de l'étape 1 (contrats-api-etape-1.md §7.1, §6) :
 *  - écritures (`POST`/`PATCH`/`PUT` d'une ressource métier) : `{donnees, avertissements}`,
 *    typé `ReponseAvecAvertissements<T>` ;
 *  - collections (`GET` de liste) : `{donnees, curseurSuivant, limite}`, typé `PageCurseur<T>`.
 *
 * Les deux types viennent de `@dfa/shared` (générés/gelés) — on ne les redéfinit JAMAIS ici, on
 * les consomme et on fournit les quelques fonctions utilitaires que les hooks de domaine
 * réécriraient sinon chacun à leur façon.
 *
 * Les `GET` unitaires renvoient la ressource nue (pas d'enveloppe) : rien à faire ici pour eux.
 */

import type { Avertissement, PageCurseur, ReponseAvecAvertissements } from '@dfa/shared';

export type { Avertissement, PageCurseur, ReponseAvecAvertissements } from '@dfa/shared';

/**
 * Extrait les avertissements d'une réponse d'écriture réussie — le point d'entrée pour brancher
 * `AvertissementConfirmable` sur un **succès** (contrats-api-etape-1.md §4.4). Toujours un
 * tableau, jamais `undefined` : le contrat garantit `avertissements: []` même sur un endpoint qui
 * n'avertira jamais (§7.1), donc appeler cette fonction ne demande aucune garde côté hook.
 *
 * Une réponse 2xx qui porte des `avertissements` n'est et ne sera JAMAIS une erreur : elle
 * traverse `requeteApi` comme n'importe quel succès (voir client.ts), `avertissementsDe` ne fait
 * que la lire une fois arrivée.
 */
export function avertissementsDe<T>(reponse: ReponseAvecAvertissements<T>): readonly Avertissement[] {
  return reponse.avertissements;
}

/**
 * Extrait la ressource d'une enveloppe d'écriture. Symétrique de `avertissementsDe` : les deux
 * couvrent `ReponseAvecAvertissements<T>` sans qu'un hook de domaine ait à déstructurer
 * `.donnees` à la main à chaque appel.
 */
export function donneesEcriture<T>(reponse: ReponseAvecAvertissements<T>): T {
  return reponse.donnees;
}

/**
 * Extrait la page (le tableau `donnees`) d'une enveloppe de collection. Symétrique de
 * `donneesEcriture` pour l'autre forme d'enveloppe.
 */
export function donneesPage<T>(page: PageCurseur<T>): readonly T[] {
  return page.donnees;
}

/** `true` si la page reçue est la dernière (aucun curseur suivant) — évite à chaque hook de
 *  domaine de réécrire `curseurSuivant === null`. */
export function estDernierePage<T>(page: PageCurseur<T>): boolean {
  return page.curseurSuivant === null;
}
