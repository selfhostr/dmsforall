import { STATUTS_SANTE_CONNECTEUR, type StatutSanteConnecteur } from './enums';

/**
 * État de santé d'une activation de connecteur — `RC-03` : « un utilisateur du garage (souvent le
 * magasinier ou le vendeur, jamais un informaticien) doit pouvoir voir, sans ouvrir de log :
 * configuré ou non, dernier échange réussi et quand, en échec et depuis quand. »
 *
 * EMBARQUÉ dans `ReponseConnecteurActivation.sante` (`connecteur.ts`) pour l'écran de vue
 * d'ensemble — une liste de connecteurs sans un aller-retour par ligne — ET exposé seul via
 * `GET /connecteurs/activations/{id}/sante` pour un poll léger (ex. bandeau d'alerte qui se
 * rafraîchit sans recharger toute l'activation).
 */
export interface SanteConnecteurActivation {
  readonly statut: StatutSanteConnecteur;
  readonly dernierEchangeReussiLe: string | null;
  /** `RC-03` : « en échec et depuis quand ». `null` sauf `statut ∈ {en_echec, necessite_action}` —
   *  un connecteur `operationnel` n'a pas de « depuis quand » à montrer. */
  readonly enEchecDepuisLe: string | null;
  /** Résumé court, FR stable, destiné à l'écran (pas un message d'exception brut). `null` si aucun
   *  échange n'a encore eu lieu (`non_configure`). */
  readonly derniereErreurMessage: string | null;
  /** `RC-04` : nombre de tentatives consécutives en échec depuis le dernier succès, remis à zéro
   *  dès qu'un échange réussit. Alimente directement l'affichage « échoue depuis N tentatives »
   *  sans que le front recompte depuis le journal d'exécution. */
  readonly tentativesConsecutivesEnEchec: number;
}

/**
 * `GET /connecteurs/activations/{id}/sante` — lecture seule, aucune pagination (ressource
 * singleton par activation). Répond `404 RESSOURCE_INTROUVABLE` si l'activation n'existe pas ou
 * n'appartient pas au tenant courant (RLS + scoping applicatif, jamais un `tenantId` en paramètre —
 * règle n°1 du projet).
 */
export interface ReponseSanteConnecteurActivation extends SanteConnecteurActivation {
  readonly connecteurActivationId: string;
}
