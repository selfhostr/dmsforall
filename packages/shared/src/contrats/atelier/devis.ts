import { z } from 'zod';

import { CANAUX_DEVIS, DECISIONS_DEVIS, type CanalDevis, type DecisionDevis } from './enums';
import {
  schemaCentimesPositif,
  schemaHorodatage,
  schemaIdentifiant,
  schemaListeIdentifiants,
  schemaTexteCourt,
  schemaTexteLong,
} from './primitives';

/**
 * Devis complémentaires (contrats-api-etape-1.md §7.9, RM-79 -> RM-84).
 *
 * **Pas de `PATCH`, pas de `DELETE` : un devis répondu est IMMUABLE** (RM-79). Une réponse erronée
 * se corrige par un NOUVEAU devis, jamais par réécriture — c'est la pièce qui gagne le litige.
 * L'immuabilité est aussi garantie par trigger en base, pas seulement par le service.
 */

export interface ReponseDevisLigne {
  readonly ligneId: string;
  /** `null` tant que le devis n'a pas reçu de réponse `partiel` (CT-33). */
  readonly decision: DecisionDevis | null;
}

export interface ReponseDevisComplementaire {
  readonly id: string;
  readonly ordreReparationId: string;
  /** Rang du devis dans l'OR (1, 2, 3…). Tri par défaut de la sous-collection. */
  readonly numeroOrdre: number;
  readonly lignes: readonly ReponseDevisLigne[];
  /** Absents pour un rôle sans droit aux montants (`ROLES_SANS_MONTANT`). */
  readonly montantTtcCentimes?: number;
  readonly nouveauPlafondCentimes?: number;
  readonly impactRestitutionLe: string | null;
  readonly canal: CanalDevis;
  readonly destinataireContactId: string | null;
  readonly envoyeLe: string;
  readonly emetteur: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
  /** Le NOM DE LA PERSONNE qui a répondu (RM-81). Obligatoire dès qu'il y a une réponse. */
  readonly interlocuteurNom: string | null;
  readonly repondueLe: string | null;
  readonly decision: DecisionDevis | null;
  readonly retranscription: string | null;
}

export const TRIS_DEVIS = ['numeroOrdre:asc', 'numeroOrdre:desc'] as const;
export const TRI_DEFAUT_DEVIS = 'numeroOrdre:asc';

export const schemaFiltresDevis = z.object({
  decision: z.enum(DECISIONS_DEVIS).optional(),
  tri: z.enum(TRIS_DEVIS).default(TRI_DEFAUT_DEVIS),
});

/**
 * `POST /ordres-reparation/{orId}/devis-complementaires` — `Idempotency-Key` OBLIGATOIRE : c'est
 * une pièce à valeur probante.
 *
 * `montantTtcCentimes` n'est PAS entrant : il est calculé par le serveur depuis les lignes
 * référencées, avec leurs valeurs figées. Un montant fourni par le client serait un montant
 * contestable.
 */
export const schemaCreationDevisComplementaire = z
  .object({
    ligneIds: schemaListeIdentifiants,
    nouveauPlafondCentimes: schemaCentimesPositif,
    canal: z.enum(CANAUX_DEVIS),
    destinataireContactId: schemaIdentifiant.nullish(),
    impactRestitutionLe: schemaHorodatage.nullish(),
  })
  .strict();

/**
 * `POST /…/devis-complementaires/{devisId}/repondre` — `Idempotency-Key` OBLIGATOIRE :
 * **une double réponse est un litige** (RM-81).
 *
 * `interlocuteurNom` est OBLIGATOIRE au niveau du schéma, et son absence produit
 * `DEVIS_INTERLOCUTEUR_REQUIS` plutôt qu'un `VALIDATION_ECHOUEE` générique : la règle est métier
 * (« le nom de la personne qui a répondu »), et le code doit la nommer pour que le message traduit
 * soit juste.
 *
 * Effets de bord CONTRACTUELS, à documenter dans la description de l'endpoint parce qu'ils
 * dépassent la ressource et surprendraient un tiers :
 *  - `partiel` -> chaque ligne prend sa propre décision (CT-33), d'où `lignes[]` ;
 *  - les lignes refusées alimentent les TRAVAUX REPORTÉS du véhicule (RM-73), ensuite visibles
 *    dans `GET /vehicules/{id}/travaux-reportes` et dans le contexte-atelier ;
 *  - l'OR reprend son cours, il n'est **jamais** annulé (RM-84) ;
 *  - selon P-24, une ligne de démontage/remontage est **proposée** dans `avertissements` — jamais
 *    créée en silence (CT-36). Proposer n'est pas créer.
 */
export const schemaReponseDevisComplementaire = z
  .object({
    decision: z.enum(DECISIONS_DEVIS),
    canal: z.enum(CANAUX_DEVIS),
    interlocuteurNom: schemaTexteCourt,
    repondueLe: schemaHorodatage,
    retranscription: schemaTexteLong.nullish(),
    /** Requis et suffisant pour `partiel` ; ignoré pour `accepte` / `refuse`. */
    lignes: z
      .array(
        z.object({ ligneId: schemaIdentifiant, decision: z.enum(['accepte', 'refuse']) }).strict(),
      )
      .max(200)
      .optional(),
  })
  .strict()
  .refine((v) => v.decision !== 'partiel' || (v.lignes !== undefined && v.lignes.length > 0), {
    message: 'Une réponse `partiel` exige la décision de chaque ligne.',
    path: ['lignes'],
  });

export type EntreeCreationDevisComplementaire = z.infer<typeof schemaCreationDevisComplementaire>;
export type EntreeReponseDevisComplementaire = z.infer<typeof schemaReponseDevisComplementaire>;
export type FiltresDevis = z.infer<typeof schemaFiltresDevis>;
