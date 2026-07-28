import { z } from 'zod';

import { CODES_CONFIRMATION, type CodeAvertissement } from '../probleme';

/**
 * Contrat TRANSVERSE des écritures de l'étape 1 : enveloppe de réponse, avertissements,
 * confirmations, en-têtes d'idempotence et de concurrence (contrats-api-etape-1.md §7.1, §5, §9).
 */

/**
 * Un succès AVEC RÉSERVE. Voyage dans `avertissements[]` d'une réponse 2xx, jamais dans un
 * `problem+json` : un avertissement n'a pas de statut HTTP, et `STATUT_PAR_CODE_ERREUR` ne doit
 * donc jamais en contenir.
 */
export interface Avertissement {
  readonly code: CodeAvertissement;
  /**
   * Libellé FR stable, pour le support et les logs. JAMAIS affiché par le front, qui rend
   * l'avertissement depuis `code` (traduit via `erreurs:codes.<CODE>`) et `donnees`.
   */
  readonly message: string;
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/**
 * Enveloppe de TOUTE création ou modification d'une ressource métier de l'étape 1.
 *
 * Présente même sur les endpoints qui n'avertiront jamais — `avertissements` vaut alors `[]`.
 * La raison est la seule qui compte : **ajouter une enveloppe plus tard est une RUPTURE**. Un
 * endpoint d'écriture qui répondrait nu s'interdirait d'avertir un jour, et un jour il faudra.
 *
 * Ne s'applique PAS aux `GET` : une lecture n'avertit de rien, et les collections gardent
 * l'enveloppe de pagination (`PageCurseur`, dont la clé `donnees` est justement celle réutilisée
 * ici). Exceptions : `204 No Content` et les endpoints d'authentification du socle, inchangés.
 */
export interface ReponseAvecAvertissements<T> {
  readonly donnees: T;
  readonly avertissements: readonly Avertissement[];
}

/**
 * Champ `confirmations` du CORPS des requêtes confirmables (§4.4) — jamais un en-tête, jamais une
 * query, et jamais un `?force=true` : un forçage se trace, et `confirmations` doit entrer dans
 * l'empreinte d'idempotence pour qu'un rejeu confirmé ne soit pas confondu avec la requête
 * initiale.
 *
 * À composer dans les schémas d'entrée concernés : `POST /clients`, `POST /ordres-reparation`,
 * `POST /clients/{id}/fusionner`, et toute écriture qui pourra devenir confirmable — l'ajouter
 * après coup serait additif, mais l'oublier oblige le client à un second aller-retour.
 */
export const schemaConfirmations = z.object({
  confirmations: z.array(z.enum(CODES_CONFIRMATION)).max(10).optional(),
});

/* ------------------------------------------------------------------ */
/* En-têtes HTTP contractuels                                          */
/* ------------------------------------------------------------------ */

/**
 * Identité de la REQUÊTE (uuid v4), obligatoire sur les créations qui consomment une ressource
 * rare et non réutilisable — un numéro d'OR (RM-49) ou de client (RM-11) ne doit jamais être
 * brûlé par un rejeu. Absence -> `400 VALIDATION_ECHOUEE` avec
 * `erreurs[0].champ = "Idempotency-Key"`.
 */
export const EN_TETE_IDEMPOTENCE = 'Idempotency-Key';

/** Présent (`true`) quand la réponse est le REJEU à l'identique d'une réponse mémorisée. */
export const EN_TETE_IDEMPOTENCE_REJEU = 'Idempotency-Rejeu';

/**
 * Rétention garantie d'une clé d'idempotence. **Engagement de contrat, pas un détail
 * d'exploitation** : un connecteur doit savoir combien de temps un rejeu reste sûr. Toute
 * réduction est une rupture (§11.4).
 */
export const RETENTION_IDEMPOTENCE_JOURS = 7;

/**
 * Portée d'une clé d'idempotence : `(tenant, méthode, chemin, clé)`. Une même clé sur deux
 * endpoints différents est valide et ne se recoupe pas.
 *
 * Sémantique, à documenter mot pour mot dans l'OpenAPI :
 *  - clé inconnue -> traitement normal, mémorisation de `(statut, corps)` ;
 *  - clé connue + empreinte du corps IDENTIQUE (SHA-256 du corps canonicalisé, clés triées, sans
 *    blancs) -> rejeu de la réponse mémorisée à l'identique, même statut, même corps,
 *    plus `Idempotency-Rejeu: true` ;
 *  - clé connue + empreinte DIFFÉRENTE -> `409 IDEMPOTENCE_CONFLIT` ;
 *  - clé connue + requête initiale encore en cours -> `409 IDEMPOTENCE_CONFLIT` + `Retry-After: 1`.
 */
export const EN_TETE_ETAG = 'ETag';

/**
 * Obligatoire sur `PATCH /ordres-reparation/{orId}` — là où les pertes de mise à jour sont
 * réelles (deux postes modifient le plafond). Absence -> `400 VALIDATION_ECHOUEE` avec
 * `erreurs[0].champ = "If-Match"`, et NON un `428` : on n'introduit pas un statut sans code
 * métier associé.
 *
 * FACULTATIF sur les actions (§7.7) : une transition est déjà gardée par son état de départ et
 * ses préconditions ; exiger l'ETag y ajouterait un aller-retour sans gain.
 *
 * Discordance -> **`409 CONFLIT`** et non `412 Precondition Failed`. Déviation délibérée : le
 * contrat d'erreur associe un code métier stable à un statut unique, et renvoyer 412 pour
 * `CONFLIT` créerait deux statuts pour un même code. C'est le seul endroit où l'API s'écarte
 * d'une convention HTTP courante ; la description OpenAPI de chaque `PATCH` doit le dire.
 */
export const EN_TETE_IF_MATCH = 'If-Match';

/** Corrélation, = `ProblemeDetail.instance`. Déjà en place depuis le socle. */
export const EN_TETE_REQUETE_ID = 'X-Requete-Id';

/** Schéma de validation d'une clé d'idempotence : uuid v4. */
export const schemaCleIdempotence = z.uuid();
