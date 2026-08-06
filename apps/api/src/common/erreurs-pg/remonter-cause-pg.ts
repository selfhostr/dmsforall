/**
 * Déballage partagé de la chaîne `.cause` pour retrouver l'erreur brute du pilote `pg` derrière
 * l'enveloppe systématique de Drizzle.
 *
 * Le pilote `pg` lève ses erreurs de contrainte (violation unique `23505`, exclusion `23P01`,
 * check `23514`, ou un SQLSTATE personnalisé levé par un trigger PL/pgSQL — ex. `ZDFA4` pour
 * `imputation_paiement_verifier_invariants`) avec `code`/`constraint`/`detail` directement sur
 * l'objet. Mais Drizzle (`drizzle-orm/pg-core/session.js`) attrape SYSTÉMATIQUEMENT cette erreur et
 * la relève enveloppée dans une `DrizzleQueryError` :
 *
 *   catch (e) { throw new DrizzleQueryError(query, params, e); }
 *
 * `DrizzleQueryError` ne porte NI `code` NI `constraint` NI `detail` en surface — seulement
 * `.cause`, qui est l'erreur `pg` brute (vérifié sur `drizzle-orm@0.45.2/errors.js` : le
 * constructeur ne pose que `query`, `params`, `cause`). Un test du type `erreur.code === '23505'`
 * sur l'exception attrapée après un `tx.insert(...)`/`tx.update(...)` échoue donc TOUJOURS en
 * production — même s'il passe dans un test unitaire naïf qui construit l'erreur brute à la main
 * sans jamais passer par Drizzle. C'est exactement le défaut constaté sur quatre helpers du dépôt
 * (`ventes/service-vehicule-stock.ts`, `ventes/service-dossier-vente.ts`,
 * `ventes/service-reprise.ts`, `facturation/paiements/imputations.ts`) : l'erreur métier écrite
 * juste à côté (409, `IMPUTATION_MONTANT_EXCEDENTAIRE`, …) n'était jamais atteinte, et retombait en
 * `ERREUR_INTERNE`/500.
 *
 * Patron de référence : `vehicules/erreurs-contraintes.ts::remonterCause` (implémentation jumelle
 * antérieure, non touchée par ce module pour rester dans le périmètre du correctif d'origine — le
 * module `vehicules/` reste hors périmètre de la factorisation qui suit). Ce module-ci est le point
 * de factorisation pour tout code qui a seulement besoin de retrouver l'erreur `pg` brute — sans la
 * logique de table de contraintes propre au module véhicules. Factorisation achevée pour les
 * modules `facturation/`, `atelier/` et `common/` : `atelier/service-ligne-or.ts`,
 * `facturation/paiements/imputations.ts`, `facturation/documents/erreurs-sql-document.ts`,
 * `facturation/paiements/service-paiement.ts` et `common/avertissements/traducteur-erreur-
 * transition-sql.ts` importent tous `remonterCausePg`/`remonterCauseParCode` d'ici, aucun n'a plus
 * sa propre copie du déballage.
 */

/** Forme minimale d'une erreur `pg` brute utile aux appelants — `code` (SQLSTATE standard ou
 *  personnalisé via un trigger), `constraint` (nom de contrainte ; absent sur un SQLSTATE
 *  personnalisé comme `ZDFA4`, qui n'est pas une violation de contrainte nommée) et `detail`
 *  (message additionnel du serveur, utile pour le `detail` d'une `ErreurMetier`). */
export interface ErreurPgBrute {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly detail?: unknown;
  readonly cause?: unknown;
}

/** Profondeur maximale de déballage — Drizzle n'enveloppe qu'une seule fois en pratique, mais
 *  bornée pour ne jamais boucler indéfiniment sur une chaîne `.cause` cyclique pathologique. */
const PROFONDEUR_MAX_CAUSE = 10;

/**
 * Rend le premier maillon de la chaîne `erreur` → `.cause` → `.cause.cause` → … (l'erreur reçue
 * elle-même incluse) qui porte un `code` de type `string`, ou `null` si aucun maillon des
 * `PROFONDEUR_MAX_CAUSE` premiers n'en porte un — que la chaîne soit vide (erreur `pg` brute,
 * jamais enveloppée : le cas d'un test unitaire qui construit l'erreur à la main sans passer par
 * Drizzle) ou qu'elle contienne une `DrizzleQueryError` (le cas réel en production).
 *
 * Ne filtre PAS par SQLSTATE et ne connaît aucune règle métier : c'est à l'appelant de comparer le
 * `code`/`constraint` rendu au(x) code(s) qu'il reconnaît (une contrainte homonyme portée par un
 * SQLSTATE différent, ou un SQLSTATE identique porté par une autre contrainte, doivent rester des
 * cas distincts tranchés par l'appelant — ce module se contente de déballer).
 */
export function remonterCausePg(erreur: unknown): ErreurPgBrute | null {
  let courante: unknown = erreur;
  for (let profondeur = 0; profondeur < PROFONDEUR_MAX_CAUSE; profondeur += 1) {
    if (typeof courante !== 'object' || courante === null) {
      return null;
    }
    const brute = courante as ErreurPgBrute;
    if (typeof brute.code === 'string') {
      return brute;
    }
    courante = brute.cause;
  }
  return null;
}

/**
 * Variante de `remonterCausePg` pour l'appelant qui connaît DÉJÀ le SQLSTATE exact recherché (ex.
 * `ZDFA4`, `23505`) — walk identique de la chaîne `.cause`, mais le critère d'arrêt est
 * `code === code` plutôt que « premier `code` de type `string` rencontré ». Différence
 * observable UNIQUEMENT si la chaîne porte, à un niveau intermédiaire, un `code` de type `string`
 * qui N'EST PAS celui recherché (Drizzle n'enveloppe qu'une fois en pratique — voir l'en-tête de ce
 * fichier — donc ce cas ne survient pas en production ; cette variante existe pour ne jamais avoir
 * à en faire l'hypothèse) : `remonterCausePg` s'arrêterait à ce niveau intermédiaire, celle-ci
 * continue jusqu'à trouver EXACTEMENT `code`, ou `null` si aucun maillon ne le porte.
 */
export function remonterCauseParCode(erreur: unknown, code: string): ErreurPgBrute | null {
  let courante: unknown = erreur;
  for (let profondeur = 0; profondeur < PROFONDEUR_MAX_CAUSE; profondeur += 1) {
    if (typeof courante !== 'object' || courante === null) {
      return null;
    }
    const brute = courante as ErreurPgBrute;
    if (brute.code === code) {
      return brute;
    }
    courante = brute.cause;
  }
  return null;
}
