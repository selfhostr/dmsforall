import { z } from 'zod';

import { schemaDateJour, schemaIdentifiant, schemaMotif } from '../atelier/primitives';

/**
 * Verrouillage de période (RM-95). `POST /pointages/verrouiller-periode` et son inverse
 * `POST /pointages/deverrouiller-periode` — DEUX ACTIONS, PAS UNE RESSOURCE.
 *
 * HYPOTHÈSE DE MODÈLE, À CONFIRMER avec quiconque possède `contrats/atelier/parametrage.ts` et le
 * schéma de base (expert-database) — hors périmètre d'écriture de ce fichier : le verrouillage
 * est modélisé ici comme un SIMPLE SEUIL par site (« tout pointage dont `debutLe` précède cette
 * date est verrouillé »), PAS comme une collection de ressources `periode-pointage` avec son
 * propre cycle de vie. Raisons :
 *  1. RM-95 ne précise AUCUNE granularité (mensuelle, hebdomadaire, à la carte) — inventer une
 *     granularité serait une décision de modèle de données non demandée ici.
 *  2. `ENTITES_AUDITEES` (`atelier/enums.ts`) ne connaît qu'une entité `pointage`, pas de
 *     `periode_pointage` : ajouter une seconde entité auditée EST un changement de schéma, hors
 *     du périmètre d'écriture de ce fichier (`packages/shared/src/contrats/pointage/` uniquement).
 *  3. Une action avec un rapport d'exécution suffit à RM-95 tel qu'écrit ; elle n'exige pas de
 *     `GET /periodes-pointage` — d'où l'absence volontaire de toute ressource `GET` dans ce
 *     fichier. Le statut « verrouillé » de CHAQUE pointage reste lisible via
 *     `ReponsePointage.statut === 'verrouille'` (`pointage.ts`), qui est la vraie source de
 *     vérité par pointage — ce fichier ne fait que la FAIRE PASSER de `valide`/`termine` à
 *     `verrouille` en lot.
 * Si le terrain a besoin d'un découpage plus fin (verrouiller février sans jamais pouvoir
 * verrouiller janvier a posteriori, ou l'inverse), ce contrat devra migrer vers une collection —
 * migration ADDITIVE (nouveau champ `periodeId` sur le pointage), pas une rupture au sens §11.4.
 *
 * `verrouiller-periode` transitionne EN LOT tout pointage `statut IN ('termine', 'valide')` avec
 * `debutLe <= jusquauLe` du site donné vers `verrouille`. Un pointage `en_cours` dans la plage
 * BLOQUE l'opération entière plutôt que d'être clos de force (fermer un pointage sans que le
 * technicien ait lui-même arrêté son chronomètre falsifierait la donnée, exactement ce que RM-113
 * cherche à éviter) : `409 CONFLIT` avec `blocages: [{ type: 'pointage', id, libelle: … }]`,
 * réutilisant `ElementBloquant`/`TYPES_ELEMENT_BLOQUANT` (`contrats/probleme.ts`, qui liste déjà
 * `'pointage'` comme type de blocage possible) — AUCUN nouveau code d'erreur nécessaire pour ce
 * cas, contrairement à l'identification par PIN.
 *
 * Pas d'`Idempotency-Key` : verrouiller une période déjà verrouillée (ou re-verrouiller après un
 * appel dont la réponse s'est perdue) est un NO-OP naturel — les pointages déjà `verrouille`
 * restent `verrouille`, `pointagesVerrouilles` compte alors 0 sur le rejeu. Même patron que les
 * transitions gardées par état ailleurs dans l'API.
 */
export const schemaVerrouillagePeriodePointage = z
  .object({
    siteId: schemaIdentifiant,
    /** Borne INCLUSE. */
    jusquauLe: schemaDateJour,
    motif: schemaMotif.optional(),
  })
  .strict();
export type EntreeVerrouillagePeriodePointage = z.infer<typeof schemaVerrouillagePeriodePointage>;

/**
 * RM-95 : contre-passation. `motif` OBLIGATOIRE (contrairement au verrouillage) — rouvrir une
 * période déjà verrouillée est un geste rare et sensible : les pointages qu'elle contient ont pu
 * être déjà exportés vers une fiduciaire (même logique que `DOCUMENT_PERIODE_CLOSE` côté
 * facturation, `contrats/facturation`). Ne transitionne QUE les pointages actuellement
 * `verrouille` du site vers `valide` (jamais `en_cours` : un pointage déverrouillé redevient
 * corrigeable, pas réouvrable).
 */
export const schemaDeverrouillagePeriodePointage = z
  .object({
    siteId: schemaIdentifiant,
    jusquauLe: schemaDateJour,
    motif: schemaMotif,
  })
  .strict();
export type EntreeDeverrouillagePeriodePointage = z.infer<
  typeof schemaDeverrouillagePeriodePointage
>;

/** Rapport d'exécution de l'une ou l'autre action — pas une ressource, voir plus haut. */
export interface ReponseVerrouillagePeriodePointage {
  readonly siteId: string;
  readonly jusquauLe: string;
  readonly pointagesVerrouilles: number;
}

export interface ReponseDeverrouillagePeriodePointage {
  readonly siteId: string;
  readonly jusquauLe: string;
  readonly pointagesDeverrouilles: number;
}
