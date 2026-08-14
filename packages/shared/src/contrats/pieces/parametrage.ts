import { z } from 'zod';

import { schemaDelaiJours } from './primitives';
import { schemaPourmille } from '../atelier/primitives';

/**
 * Paramétrage du domaine pièces (§10 de la spec, `PP-01` → `PP-08`) — même doctrine que
 * `atelier/parametrage.ts` : les numéros `PP-xx` sont un artefact de rédaction, jamais un nom de
 * champ. Portée tenant sauf `PP-08` (par article/site, déjà porté par
 * `stock.ts::ReponseStockArticle`, pas répété ici).
 *
 * TROIS paramètres restent SANS VALEUR PAR DÉFAUT PROPOSÉE, marqués `null` obligatoire côté
 * lecture tant qu'ils ne sont pas réglés — pas de valeur inventée faute de pratique connue
 * (`RP-33`/`QP-04`, `§7.6`/`QP-11`/`PP-05`, `RP-41`/`QP-07`/`PP-06`) : voir le rapport
 * d'accompagnement pour ce qui appartient à @laupernoe.
 */

export const METHODES_PRIX_ACHAT = ['dernier_prix', 'moyenne_ponderee'] as const;
export type MethodePrixAchat = (typeof METHODES_PRIX_ACHAT)[number];

export interface ReponseParametresPieces {
  /** `PP-01` — stock d'un site visible en LECTURE depuis les autres sites du même tenant.
   *  Défaut proposé par la spec : `true` (hypothèse `RP-10`, à confirmer `QP-01`). */
  readonly stockAutresSitesVisible: boolean;
  /** `PP-02` — une sortie qui dépasserait le disponible est bloquée par défaut ; le forçage reste
   *  réservé à un rôle habilité (non tranché ici, voir rapport d'accompagnement sur les droits). */
  readonly stockNegatifForcageAutorise: boolean;
  /** `PP-03` — `null` tant que la méthode n'est pas arbitrée avec @laupernoe (`QP-04`). */
  readonly methodePrixAchat: MethodePrixAchat | null;
  /** `PP-04` — un conditionnement différent EST un article distinct (hypothèse posée, `RP-05`) ;
   *  pas de bascule tenant vers un mécanisme unité de vente/unité de stock séparé dans ce contrat
   *  — la valeur reste `true`, non paramétrable tant que `QP-03` n'a pas remis en cause
   *  l'hypothèse elle-même (un paramètre à deux valeurs pour une hypothèse non confirmée
   *  inventerait une option qui n'existe peut-être pas). */
  readonly conditionnementArticleDistinct: true;
  /** `PP-05` — délai (en jours) avant qu'un ajustement d'inventaire significatif déclenche un
   *  avertissement (§7.6). `null` : aucune valeur avancée sans donnée réelle (`QP-11`). */
  readonly seuilValeurAjustementSignificatifCentimes: number | null;
  /** `PP-06` — délai avant qu'une consigne non retournée puisse être PROPOSÉE comme acquise
   *  (`RP-41`). `null` : dépend de `QP-07`, aucune action automatique n'existe tant qu'il l'est. */
  readonly delaiConsigneAcquisitionJours: number | null;
  /** `PP-07` — taux de TVA de la consigne (`RP-42`). Défaut proposé : `81` (8.1 %), hérité de
   *  l'hypothèse `RF-100` — à confirmer fiscalement (`QP-06`). */
  readonly tauxTvaConsignePourmille: number;
}

/** `PATCH /parametrage/pieces` — tous les champs facultatifs (mise à jour partielle, même patron
 *  que `atelier/parametrage.ts`). `conditionnementArticleDistinct` ABSENT de ce schéma : ce n'est
 *  pas un réglage tenant tant que l'hypothèse `RP-05` n'est pas remise en cause (voir le
 *  commentaire du champ ci-dessus). */
export const schemaModificationParametresPieces = z
  .object({
    stockAutresSitesVisible: z.boolean().optional(),
    stockNegatifForcageAutorise: z.boolean().optional(),
    methodePrixAchat: z.enum(METHODES_PRIX_ACHAT).nullish(),
    seuilValeurAjustementSignificatifCentimes: z.number().int().min(0).nullish(),
    delaiConsigneAcquisitionJours: schemaDelaiJours.nullish(),
    tauxTvaConsignePourmille: schemaPourmille.optional(),
  })
  .strict();
export type EntreeModificationParametresPieces = z.infer<typeof schemaModificationParametresPieces>;
