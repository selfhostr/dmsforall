import type { z } from 'zod';

import { schemaCreationOrdreReparation, type ReponseOrdreReparation } from '../atelier';
import type { StatutDocumentVente } from './enums';

/**
 * `POST /documents-vente/{id}/creer-ordre-reparation` — devis -> ordre de réparation.
 *
 * Le client, le véhicule et le site viennent du DEVIS (jamais du corps) : le corps ne porte que ce
 * que la réception de l'OR demande en plus (`type`, kilométrage, demandes, plafond, statut initial,
 * `confirmations`…). Mêmes règles que `POST /ordres-reparation` (RM-49/RM-50/RM-51, confirmations
 * `CLIENT_BLOQUE` / `VEHICULE_DEUX_OR_OUVERTS` / `OR_SANS_RDV`), plus :
 *
 *  - `409 CONFLIT` (`erreurs[0].code`) : `vehicule_requis` (le devis n'a pas de véhicule — un OR en
 *    exige un), `etat_devis_incompatible` (seul un devis `emis`, accepté par cette action, ou déjà
 *    `accepte` peut devenir un OR), `ligne_non_reprenable` (une ligne sans équivalent d'OR :
 *    `acompte_deduit`, `ecart_reprise`, `repartition`) ;
 *  - `409 DOCUMENT_SOURCE_DEJA_TRANSFORME` : ce devis a déjà créé un OR (un devis ne crée qu'UN OR).
 *
 * `Idempotency-Key` obligatoire.
 */
export const schemaCreationOrdreDepuisDevis = schemaCreationOrdreReparation
  .omit({
    vehiculeId: true,
    clientId: true,
    ordreReparationParentId: true,
    motifLien: true,
  })
  .partial({ siteId: true, type: true });

export type EntreeCreationOrdreDepuisDevis = z.infer<typeof schemaCreationOrdreDepuisDevis>;

export interface ReponseCreationOrdreDepuisDevis {
  /** L'OR créé, document complet (même forme que `GET /ordres-reparation/{orId}`). */
  readonly ordreReparation: ReponseOrdreReparation;
  readonly devisId: string;
  /** Statut du devis après l'action (`accepte`). */
  readonly devisStatut: StatutDocumentVente;
  /** Nombre de lignes du devis reprises en lignes d'OR (texte compris). */
  readonly nombreLignesReprises: number;
}
