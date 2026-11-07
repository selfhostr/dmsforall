import { z } from 'zod';

import type { ReponseDocumentVente } from './document';
import type { ReponsePaiement } from './paiement';
import { schemaConfirmations } from '../atelier/avertissement';
import type { ReponseOrdreReparation } from '../atelier/ordre-reparation';

/**
 * `POST /ordres-reparation/{orId}/facturer-et-encaisser` — le comptoir en un appel : crée la facture
 * du groupe payeur `client` (même logique que `POST .../facturer`, groupe `{ payeur: 'client' }`),
 * l'ÉMET, puis encaisse son solde si `paiement` est fourni. `Idempotency-Key` obligatoire.
 *
 * Droits : `facturation.document.creer` + `facturation.document.emettre_facture` +
 * `facturation.paiement.creer` (le rôle doit tous les avoir, même si `paiement` est absent : on
 * n'a pas deux comportements de droit selon le corps).
 *
 * Atomicité : création + émission = UNE transaction (tout ou rien, aucun numéro consommé en cas de
 * refus). L'encaissement s'exécute dans un SAVEPOINT de cette transaction : s'il échoue, seul
 * l'encaissement est annulé, la facture RESTE émise et la réponse porte l'avertissement
 * `ENCAISSEMENT_ECHOUE` (`paiement` absent). Le solde de la facture est alors intact.
 *
 * Refus (409, identiques à ceux des étapes) : `OR_TRANSITION_INTERDITE`,
 * `FACTURATION_LIGNES_INDECISES`, `OR_FACTURATION_AUCUNE_LIGNE`, `CONFIRMATION_REQUISE`,
 * `IDEMPOTENCE_CONFLIT` ; les refus d'émission (`DOCUMENT_VERROUILLE`, période close…) annulent
 * tout, y compris la création.
 *
 * Arrondi au 5 centimes (espèces UNIQUEMENT, paramètre tenant actif, solde exact uniquement) : le
 * paiement = multiple de 5 ct le plus proche du solde (dans les deux sens), règlement = paiement,
 * imputation `arrondi` signée = solde - espèces (109.44 -> paiement 10945, arrondi -1). Carte et
 * TWINT au centime exact.
 */
export const MODES_ENCAISSEMENT_RAPIDE = ['especes', 'carte', 'twint'] as const;
export type ModeEncaissementRapide = (typeof MODES_ENCAISSEMENT_RAPIDE)[number];

export const schemaFacturerEtEncaisserOr = z
  .object({
    /** Absent = facturation différée : facture émise, rien encaissé. */
    paiement: z
      .object({
        mode: z.enum(MODES_ENCAISSEMENT_RAPIDE),
        /** Absent = le solde de la facture. Doit être > 0 et <= solde. */
        montantCentimes: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .extend(schemaConfirmations.shape)
  .strict();
export type EntreeFacturerEtEncaisserOr = z.infer<typeof schemaFacturerEtEncaisserOr>;

export interface ReponseFacturerEtEncaisserOr {
  /** La facture ÉMISE (numéro attribué, verrouillée), `montantRegle`/`solde` à jour si encaissée. */
  readonly facture: ReponseDocumentVente;
  /** Absent si aucun `paiement` demandé, ou si l'encaissement a échoué (voir avertissements). */
  readonly paiement?: ReponsePaiement;
  /** L'OR à jour (`facture` si plus aucun groupe à facturer, sinon `termine`). */
  readonly ordreReparation: ReponseOrdreReparation;
}
