import { z } from 'zod';
import { schemaModificationParametresAtelier, type EntreeModificationParametresAtelier } from '@dfa/shared';

/**
 * `RF-117` (`db/migrations/0018_plafond_avoir_receptionnaire.sql`) : plafond d'émission d'avoir
 * par un `receptionnaire` seul — au-delà, `direction`/`comptable` prennent le relais
 * (`auth/matrice-droits.ts`, §EMISSION_AVOIR). La colonne existe en base
 * (`parametre_atelier.plafond_avoir_receptionnaire_centimes`) depuis 0018, mais AUCUN endpoint ne
 * la renseignait avant ce module — le contrôle posé côté service d'émission d'avoir restait
 * inerte tant que la valeur ne peut jamais être écrite que `NULL`.
 *
 * ÉCART DE CONTRAT SIGNALÉ — même nature que celui déjà documenté dans
 * `mappeur-parametres-atelier.ts` pour `reception.plafondDefautCentimes` (nullabilité) :
 * `packages/shared` est HORS du périmètre de ce module (consigne de tâche explicite), et son
 * `schemaModificationParametresAtelier`/`ReponseParametresAtelier` gelés n'exposent PAS encore ce
 * champ. Plutôt que de laisser le champ injoignable via l'API (zod `z.object` sans `.strict()`
 * strippe silencieusement toute clé qu'il ne connaît pas — un `PATCH` l'envoyant serait accepté
 * `200` sans jamais atteindre la colonne), ce module étend LOCALEMENT le schéma gelé pour ce seul
 * endpoint. Ce n'est PAS un contournement furtif : c'est le même geste que le mappeur fait déjà
 * pour `plafondDefautCentimes`, documenté au même endroit pour la même raison. `packages/shared`
 * devrait être élargi pour absorber ce champ (le geste redeviendrait alors une pure suppression
 * de ce fichier) — signalé dans la réponse de tâche RF-117, à traiter par expert-api, hors du
 * périmètre d'écriture de ce module.
 *
 * Bornes IDENTIQUES au `CHECK` SQL posé par 0018
 * (`parametre_atelier_plafond_avoir_receptionnaire_chk`) : `null` = aucun plafond convenu (défaut,
 * dégradé documenté préservé), 0 à 100'000'000 centimes sinon (CHF 0.- à CHF 1'000'000.-). Refuser
 * une valeur hors bornes ICI, dans le pipe de validation zod, évite qu'un `PATCH` mal formé
 * n'atteigne la base pour se voir répondre une violation `CHECK` brute — cohérence avec
 * `schemaCentimesPositif` (`@dfa/shared`, `z.number().int().min(0)`, SANS borne haute : cette
 * dernière est une lacune préexistante distincte, propre à `plafondDefautCentimes`, non corrigée
 * ici — hors du périmètre de cette tâche).
 */
const schemaReceptionEtendu = schemaModificationParametresAtelier.shape.reception.unwrap().extend({
  plafondAvoirReceptionnaireCentimes: z.number().int().min(0).max(100_000_000).nullish(),
});

export const schemaModificationParametresAtelierEtendu = schemaModificationParametresAtelier.extend({
  reception: schemaReceptionEtendu.optional(),
});

export type EntreeModificationParametresAtelierEtendue = z.infer<typeof schemaModificationParametresAtelierEtendu>;

/**
 * Filet de type : toute valeur produite par `schemaModificationParametresAtelierEtendu` doit
 * rester assignable au type gelé de `@dfa/shared` (le champ ajouté est une extension pure, jamais
 * un remplacement d'un champ existant) — si ça cesse un jour d'être vrai, cette ligne rougit à la
 * compilation plutôt que de laisser le service recevoir un type silencieusement incompatible.
 */
type _VerificationCompatibiliteAvecContratGele = EntreeModificationParametresAtelierEtendue extends EntreeModificationParametresAtelier
  ? true
  : never;
const _verification: _VerificationCompatibiliteAvecContratGele = true;
void _verification;
