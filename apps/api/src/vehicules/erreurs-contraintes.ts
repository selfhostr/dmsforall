import type { CodeErreur } from '@dfa/shared';

/**
 * Interprétation des violations de contrainte Postgres du module véhicules — SANS analyser le
 * texte du message, seulement `code` (SQLSTATE) et `constraint` (nom de la contrainte), à
 * l'identique de la doctrine de `common/avertissements/traducteur-erreur-transition-sql.ts`.
 *
 * Trois SQLSTATE concernés :
 *  - `23505` (unique_violation) — `vehicule_vin_actif_uk` (RM-15, index partiel `statut = 'actif'`).
 *  - `23P01` (exclusion_violation) — `vehicule_plaque_collision_excl` (RM-18) et
 *    `vehicule_detention_unicite_excl` (RM-20, CT-47).
 *  - `23514` (check_violation) — `vehicule_vin_format_chk` (RM-15, I/O/Q interdits sur un VIN de
 *    17 caractères) et `vehicule_detention_periode_chk` (`au is null or au > du` — ex. changement
 *    de détenteur à la même date que le début de la détention en cours).
 *
 * IMPORTANT : le pilote `pg` lève bien l'erreur brute avec `code`/`constraint` directement sur
 * l'objet, mais Drizzle (`pg-core/session.js`, `catch (e) { throw new DrizzleQueryError(query,
 * params, e) }`) l'enveloppe systématiquement dans une `DrizzleQueryError` qui porte la brute sous
 * `.cause` — jamais `code`/`constraint` en surface. Sans déballer `.cause`, cette fonction ne
 * reconnaît jamais rien et TOUT retombe en `ERREUR_INTERNE`/500 (constaté : les trois contraintes
 * ci-dessus, y compris `vehicule_plaque_collision_excl` déjà « câblée » ici, ressortaient en 500
 * avant ce correctif). `remonterCause` déballe donc la chaîne, bornée pour ne jamais boucler à
 * l'infini sur un `cause` cyclique pathologique.
 */

const SQLSTATE_UNICITE = '23505';
const SQLSTATE_EXCLUSION = '23P01';
const SQLSTATE_CHECK = '23514';

const SQLSTATES_RECONNUS: ReadonlySet<string> = new Set([
  SQLSTATE_UNICITE,
  SQLSTATE_EXCLUSION,
  SQLSTATE_CHECK,
]);

interface ErreurPgBrute {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly cause?: unknown;
}

/** Profondeur maximale de déballage de `.cause` — largement suffisant (Drizzle n'enveloppe qu'une
 *  seule fois), mais borné pour ne jamais risquer une boucle infinie sur une chaîne cyclique. */
const PROFONDEUR_MAX_CAUSE = 10;

/**
 * Contrat §7.4 : `vehicule_detention_unicite_excl` produit `VALIDATION_ECHOUEE` (« deux
 * détenteurs courants ») sur les deux endpoints atomiques (`POST /detentions`,
 * `POST /changer-detenteur`) — pas un `CONFLIT` générique, littéralement ce que dit la table du
 * contrat d'API pour `GET|POST /vehicules/{vehiculeId}/detentions`.
 *
 * `vehicule_detention_periode_chk` porte la même nature de défaut (une date fournie par
 * l'appelant qui rend la période incohérente, ex. `changerDetenteur` à la date même du début de
 * la détention courante) que `vehicule_detention_unicite_excl` sur la MÊME table — même code,
 * pour rester cohérent avec ce voisin déjà tranché plutôt que d'introduire un troisième
 * comportement pour la même famille de cas.
 */
const CONTRAINTES_VEHICULE: Readonly<Record<string, CodeErreur>> = {
  vehicule_vin_actif_uk: 'VEHICULE_VIN_EXISTANT',
  vehicule_vin_format_chk: 'VALIDATION_ECHOUEE',
  vehicule_plaque_collision_excl: 'VEHICULE_PLAQUE_COLLISION',
  vehicule_detention_unicite_excl: 'VALIDATION_ECHOUEE',
  vehicule_detention_periode_chk: 'VALIDATION_ECHOUEE',
};

export interface ContrainteVehiculeViolee {
  readonly code: CodeErreur;
  readonly contrainte: string;
}

/**
 * Rend la première erreur de la chaîne `.cause` (elle-même incluse) qui porte un SQLSTATE
 * reconnu de ce module, ou `null` si aucune n'en porte un — que la chaîne soit vide (erreur brute
 * du pilote `pg`, jamais enveloppée) ou qu'elle contienne une `DrizzleQueryError` (cas réel en
 * production, cf. commentaire de tête).
 */
function remonterCause(erreur: unknown): ErreurPgBrute | null {
  let courante: unknown = erreur;
  for (let profondeur = 0; profondeur < PROFONDEUR_MAX_CAUSE; profondeur += 1) {
    if (typeof courante !== 'object' || courante === null) {
      return null;
    }
    const brute = courante as ErreurPgBrute;
    if (typeof brute.code === 'string' && SQLSTATES_RECONNUS.has(brute.code)) {
      return brute;
    }
    courante = brute.cause;
  }
  return null;
}

/**
 * Rend `null` si l'exception n'est pas une violation de contrainte reconnue de ce module —
 * l'appelant retombe alors sur son traitement générique, jamais sur une supposition.
 */
export function interpreterContrainteVehicule(erreur: unknown): ContrainteVehiculeViolee | null {
  const brute = remonterCause(erreur);
  if (!brute) {
    return null;
  }
  if (typeof brute.constraint !== 'string') {
    return null;
  }
  const code = CONTRAINTES_VEHICULE[brute.constraint];
  if (!code) {
    return null;
  }
  return { code, contrainte: brute.constraint };
}
