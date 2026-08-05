import { z } from 'zod';

import { CANAUX_MESSAGE_CLIENT, type CanalMessageClient } from '../connecteurs/enums';
import { TYPES_RELANCE, type TypeRelance } from './enums';

/**
 * `regle_relance` — configuration par tenant, un rang par `type_relance` (§5 de la spec). Un
 * garage qui n'y touche jamais doit déjà avoir un comportement raisonnable (§4) : voir
 * `apps/api/src/relances/regles-planification.ts::PREREGLAGES_RELANCE` pour les valeurs
 * proposées par type — ce contrat ne les fige pas, il transporte ce qu'un tenant a choisi.
 */
export interface ReponseRegleRelance {
  readonly typeRelance: TypeRelance;
  readonly actif: boolean;
  /** Paliers en jours après l'échéance de référence (§4 : devis J+7 puis J+15). Ordre = ordre des
   *  paliers ; `delaisJours[0]` est le palier 1, jamais un tri implicite par valeur. */
  readonly delaisJours: readonly number[];
  /** Sous-ensemble de `CANAUX_MESSAGE_CLIENT` (`sms`/`email`) — jamais un canal hors de cette
   *  liste fermée (voir la CHECK/le type PG `canal_relance`, qui la restreint déjà en base). */
  readonly canaux: readonly CanalMessageClient[];
  /** Référence libre vers un futur gabarit de texte — aucune table de modèles n'existe encore
   *  (hors périmètre de ce lot) : `null` tant qu'aucune n'existe, jamais résolu ici. */
  readonly texteModeleId: string | null;
  /** Horodatage de la dernière application du préréglage recommandé (§4) — `null` si le tenant
   *  n'a jamais cliqué « Activer le préréglage » ou a modifié une valeur depuis sans la
   *  réappliquer. Informatif uniquement, ne conditionne aucun comportement. */
  readonly prereglageAppliqueLe: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/**
 * `PUT /relances/regles/{typeRelance}` — upsert idempotent, une ligne par
 * `(tenant_id, type_relance)` (contrainte unique en base). `canaux` non vide exigé UNIQUEMENT
 * quand `actif = true` : une règle désactivée peut légitimement n'avoir encore aucun canal
 * choisi (état de configuration initial).
 */
export const schemaUpsertRegleRelance = z
  .object({
    actif: z.boolean(),
    delaisJours: z.array(z.number().int().positive()).max(10),
    canaux: z.array(z.enum(CANAUX_MESSAGE_CLIENT)).max(CANAUX_MESSAGE_CLIENT.length),
  })
  .refine((valeurs) => !valeurs.actif || valeurs.canaux.length > 0, {
    message: 'Au moins un canal est requis pour activer une règle de relance.',
    path: ['canaux'],
  })
  .refine((valeurs) => !valeurs.actif || valeurs.delaisJours.length > 0, {
    message: 'Au moins un palier (délai en jours) est requis pour activer une règle de relance.',
    path: ['delaisJours'],
  })
  .refine((valeurs) => new Set(valeurs.canaux).size === valeurs.canaux.length, {
    message: 'Un canal ne peut pas être répété.',
    path: ['canaux'],
  });
export type EntreeUpsertRegleRelance = z.infer<typeof schemaUpsertRegleRelance>;

/** Validation du paramètre de chemin `{typeRelance}` — les 9 valeurs de §2, jamais une chaîne
 *  libre : un type inconnu doit rendre `400 VALIDATION_ECHOUEE`, pas atteindre le service. */
export const schemaTypeRelance = z.enum(TYPES_RELANCE);

/**
 * `POST /relances/facturation/planifier` — calcule les paliers dus (§6, l'« opération appelable »
 * en l'absence de tout ordonnanceur). Traite un LOT borné par appel (voir l'en-tête de
 * `service-relances-facture.ts` : jamais un balayage complet sans limite, même raisonnement que
 * la pagination par curseur) — `encoreATraiter` indique s'il reste des documents candidats
 * au-delà du lot traité, pour qu'un futur déclencheur périodique sache s'il doit rappeler
 * immédiatement ou attendre le prochain cycle.
 */
export interface ReponsePlanificationRelances {
  /** Nouvelles lignes `relance_planifiee` créées par cet appel. */
  readonly creees: number;
  /** Paliers dus mais déjà planifiés par un appel précédent (conflit ignoré, RA-05) — un nombre
   *  élevé et stable d'un appel à l'autre est le signe attendu d'un rejeu sans dommage, pas
   *  une anomalie. */
  readonly ignorees: number;
  readonly encoreATraiter: boolean;
}

/**
 * `POST /relances/facturation/envoyer` — fait passer à l'envoi les lignes `prete` (§6). Compte
 * les issues, jamais les tentatives brutes (`relance_envoi` porte le détail par tentative).
 */
export interface ReponseEnvoiRelances {
  readonly envoyees: number;
  /** Échecs DÉFINITIFS (tentatives épuisées) sur cet appel — un échec retentable (retour à
   *  `prete`) n'est pas compté ici, voir `relance_envoi` pour la trace complète. */
  readonly echouees: number;
  /** Annulations découvertes À L'EXÉCUTION (RA-07/08/09/14) — zéro tentative dans
   *  `relance_envoi` pour ces lignes, exactement ce que les cas de test §9 (#1, #4, #8) exigent. */
  readonly annulees: number;
  readonly encoreATraiter: boolean;
}
