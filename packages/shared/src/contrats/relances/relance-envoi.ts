import type { CanalMessageClient, RaisonRejetMessageClient } from '../connecteurs/enums';
import type { StatutEnvoiRelance } from './enums';

/**
 * `GET /relances/facturation/historique` (issue #136) — historique d'envoi des relances de
 * facture, une LIGNE PAR TENTATIVE réellement tracée dans `relance_envoi` (append-only,
 * `apps/api/src/db/migrations/0045_relances_socle.sql`). Jamais reconstruite depuis
 * `relance_planifiee` seule, qui ne porte pas le résultat par tentative.
 *
 * Pièce de dossier pour le comptable (« prouver à un client qu'il a bien été relancé, et à quelle
 * date ») — décision de @laupernoe, 14.08.2026 :
 *   - `envoyeLe` : horodatage réel de l'envoi (jamais celui de la planification).
 *   - `palier` : le numéro de palier au sens de `regle_relance.delaisJours` (1 = premier rappel,
 *     2 = deuxième, etc.) — même vocabulaire que `relances:regles.paliers.libelle` côté écran,
 *     jamais un libellé métier réinventé ici (« mise en demeure » reste un CHOIX de préréglage du
 *     tenant sur le dernier palier, pas une valeur d'enum).
 *   - `destinataire` : l'adresse/le numéro RÉELLEMENT utilisé à l'envoi, figé (RA-12,
 *     `relance_envoi.destinataire_fige`) — jamais recalculé depuis la fiche client actuelle : un
 *     client qui change d'adresse ne doit pas réécrire l'histoire.
 *   - `statutEnvoi`/`raisonEchec` : le résultat, et pourquoi en cas d'échec — `raisonEchec` est le
 *     code FERMÉ déjà porté par `RaisonRejetMessageClient` (`contrats/connecteurs/enums.ts`), à
 *     traduire côté écran, jamais un texte technique brut affiché tel quel à un comptable.
 *
 * ÉCARTÉ EXPLICITEMENT (même décision) : le contenu du message envoyé
 * (`relance_envoi.contenu_fige`) N'EST PAS exposé ici — question de conservation nLPD non
 * tranchée. Cette réponse ne porte que la MÉTADONNÉE d'un envoi, jamais son contenu.
 */
export interface ReponseRelanceEnvoi {
  readonly id: string;
  /** Facture concernée (`relance_planifiee.objet_id` pour `objet_type = 'document_vente'`). */
  readonly factureId: string;
  /** Numéro de facture — vocabulaire garagiste, jamais l'UUID affiché à l'écran. `null`
   *  uniquement si le document a disparu (jamais en pratique : `on delete restrict`), garde
   *  défensive plutôt qu'un plantage d'affichage. */
  readonly factureNumero: string | null;
  /** 1, 2, 3… — voir la doc d'en-tête. */
  readonly palier: number;
  readonly canal: CanalMessageClient;
  readonly destinataire: string;
  readonly statutEnvoi: StatutEnvoiRelance;
  /** Code fermé, `null` si `statutEnvoi === 'envoye'` — jamais renseigné sinon (miroir de la
   *  contrainte CHECK `relance_envoi_echoue_erreur_chk`). */
  readonly raisonEchec: RaisonRejetMessageClient | null;
  readonly envoyeLe: string;
}
