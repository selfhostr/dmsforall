import { z } from 'zod';

import {
  NATURES_ACTIVITE_POINTAGE,
  SOURCES_POINTAGE,
  STATUTS_POINTAGE,
  type NatureActivitePointage,
  type SourcePointage,
  type StatutPointage,
} from '../atelier/enums';
import {
  schemaHorodatage,
  schemaIdentifiant,
  schemaListeIdentifiants,
  schemaMotif,
} from '../atelier/primitives';
import { ACTIVITES_INDIRECTES, type ActiviteIndirecte, type MotifAnomaliePointage } from './enums';
import { schemaDecalageHorlogeMs, schemaIdAppareil } from './primitives';

/**
 * Ressource `pointage` (RM-87 → RM-99, RM-113 → RM-123 de `docs/specification-pointage.md`).
 *
 * Racine `/pointages`, PAS nichée sous `/ordres-reparation/{orId}` : RM-87 admet une cible
 * `indirect` qui ne porte AUCUN OR (nettoyage, formation, pause, absence…) — nicher la ressource
 * sous un OR rendrait cette cible inexprimable sans un chemin bâtard (`/ordres-reparation/aucun/
 * pointages`). C'est la même raison qui a déjà fait garder `GET /ordres-reparation/{orId}/lignes`
 * ET une lecture transverse dans ce dépôt (`recherche.ts`) : une ressource dont l'existence ne
 * dépend PAS structurellement du parent ne se niche pas dessous.
 */

/* ------------------------------------------------------------------ */
/* Anomalie et correction — sous-objets de lecture                     */
/* ------------------------------------------------------------------ */

/**
 * Anomalie posée sur un pointage (RM-91, RM-96, RM-123). PEUT exister sur un pointage encore
 * `en_cours` (RM-123 : la ligne annulée ne l'interrompt pas de force) — ne pas supposer que
 * `anomalie !== null` implique `statut === 'termine'`.
 */
export interface AnomaliePointage {
  readonly motif: MotifAnomaliePointage;
  readonly detecteeLe: string;
  /**
   * `null` tant que personne n'a traité l'anomalie. Se remet à une valeur non-nulle quand un
   * `POST /pointages/{id}/corriger` RÉUSSIT sur ce pointage (RM-123 : réaffecter la cible ou
   * classer en improductif sont TOUS DEUX des corrections ordinaires, pas une action séparée —
   * voir `schemaCorrectionPointage` plus bas pour pourquoi ce fichier n'introduit pas de second
   * endpoint `résoudre-anomalie`).
   */
  readonly traiteeLe: string | null;
}

/**
 * Dernière correction connue (RM-94 : « valeur d'origine conservée »). Ce champ n'expose QUE LA
 * DERNIÈRE — l'historique COMPLET (plusieurs corrections successives) vit dans le journal
 * d'audit générique, `entite_auditee = 'pointage'` déjà déclaré (`atelier/enums.ts`,
 * `ENTITES_AUDITEES`). Ce champ existe pour un affichage immédiat sans aller-retour
 * supplémentaire, pas pour remplacer l'audit trail.
 *
 * TROU DE LECTURE SIGNALÉ, pas comblé ici : le seul endpoint d'audit déclaré à ce jour est
 * `GET /ordres-reparation/{orId}/journal` (`atelier/ordre-reparation.ts`), nécessairement
 * inutilisable pour un pointage `nature = 'indirect'` (aucun `ordreReparationId`). Un pointage
 * indirect corrigé plusieurs fois n'a donc AUCUN moyen, dans les contrats existants, de faire
 * lire son historique complet au-delà de cette dernière correction. Deux issues possibles,
 * aucune tranchée ici (hors périmètre : ce fichier ne crée ni ne modifie de route d'audit) :
 * un `GET /pointages/{id}/journal` dédié, symétrique de celui de l'OR ; ou l'attente d'un
 * endpoint d'audit transverse (`GET /audit?entite=&id=`) qui n'existe pas encore. À trancher
 * avec quiconque possède la surface de lecture d'audit.
 */
export interface DerniereCorrectionPointage {
  readonly motif: string;
  readonly parUtilisateurId: string;
  readonly corrigeeLe: string;
  readonly debutLeOrigine: string;
  readonly finLeOrigine: string | null;
}

/* ------------------------------------------------------------------ */
/* Ressource — lecture                                                 */
/* ------------------------------------------------------------------ */

/**
 * `nature`, `ordreReparationId`, `ligneOrId`, `activiteIndirecte` forment ENSEMBLE les trois
 * cibles de RM-87 : exactement UN des couples suivants est renseigné, selon `nature` —
 *  - `productif_ligne` → `ordreReparationId` ET `ligneOrId` non nuls, `activiteIndirecte` nul ;
 *  - `productif_or`    → `ordreReparationId` non nul, `ligneOrId` ET `activiteIndirecte` nuls ;
 *  - `indirect`        → `activiteIndirecte` non nul, `ordreReparationId` ET `ligneOrId` nuls.
 *
 * Ce n'est PAS imposé par le type TypeScript (`ReponsePointage` reste un objet plat à champs
 * nullables, pas une union discriminée) : une réponse HTTP n'a pas besoin de la rigueur d'un
 * schéma d'entrée, et un objet plat reste plus simple à consommer pour un connecteur qui ignore
 * les champs qu'il ne comprend pas (§11.1). L'invariant est GARANTI CÔTÉ SERVEUR, à l'écriture
 * (voir `schemaDemarragePointage`, qui LUI est une union discriminée — c'est là que l'invariant
 * doit mordre, à l'entrée, pas à la sortie).
 */
export interface ReponsePointage {
  readonly id: string;
  readonly siteId: string;
  readonly technicienId: string;
  readonly statut: StatutPointage;
  readonly nature: NatureActivitePointage;
  readonly ordreReparationId: string | null;
  readonly ligneOrId: string | null;
  readonly activiteIndirecte: ActiviteIndirecte | null;
  readonly source: SourcePointage;
  readonly appareilId: string | null;
  readonly debutLe: string;
  /** `null` tant que `statut === 'en_cours'`. */
  readonly finLe: string | null;
  /** Dérivé par le serveur dès que `finLe` est posé. `null` tant que le pointage est ouvert. */
  readonly dureeBruteSecondes: number | null;
  /** Dérivé par le serveur, arrondi selon P-19 (`travaux.arrondiPointage`). `null` tant que le
   *  pointage est ouvert. Voir `pointage/primitives.ts` pour la distinction avec la seconde brute. */
  readonly dureeArrondieCentiemes: number | null;
  /** `true` si CE pointage a été refermé automatiquement — par RM-89 (chevauchement, un nouveau
   *  pointage a été démarré) ou par RM-91/RM-119 (clôture de fin de journée). Distinct de
   *  `avertissements[].code === 'POINTAGE_CLOTURE_AUTOMATIQUE'`, qui apparaît sur la réponse du
   *  pointage QUI A PROVOQUÉ la clôture (RM-89), pas sur le pointage clos lui-même — les deux
   *  informations sont nécessaires : l'un pour prévenir l'auteur du geste, l'autre pour que la
   *  lecture ultérieure du pointage clos explique pourquoi il n'a pas de fin saisie par un humain. */
  readonly clotureAutomatique: boolean;
  readonly anomalie: AnomaliePointage | null;
  readonly derniereCorrection: DerniereCorrectionPointage | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/* ------------------------------------------------------------------ */
/* Filtres et tri — `GET /pointages`                                   */
/* ------------------------------------------------------------------ */

/**
 * `statut=en_cours` couvre « qui est pointé en ce moment » — PAS de route `/pointages/ouverts`
 * dédiée (arbitrage D-f déjà pris à `atelier/enums.ts` sur `STATUTS_POINTAGE` : « un filtre, pas
 * une route »), et PAS de sucre `?vue=` non plus, même logique (`VUES_ORDRE_REPARATION` réserve
 * ce sucre aux cas qui combinent plusieurs filtres primitifs — aucun besoin identifié ici).
 */
export const TRIS_POINTAGES = ['debutLe:asc', 'debutLe:desc'] as const;
export const TRI_DEFAUT_POINTAGES = 'debutLe:desc';

export const schemaFiltresPointages = z.object({
  siteId: schemaIdentifiant.optional(),
  technicienId: schemaIdentifiant.optional(),
  ordreReparationId: schemaIdentifiant.optional(),
  ligneOrId: schemaIdentifiant.optional(),
  statut: z.array(z.enum(STATUTS_POINTAGE)).optional(),
  nature: z.array(z.enum(NATURES_ACTIVITE_POINTAGE)).optional(),
  source: z.enum(SOURCES_POINTAGE).optional(),
  /** `true` = corbeille d'anomalies (`anomalie !== null`) ; `false` = seulement les pointages
   *  sains ; absent = tous. */
  anomalie: z.coerce.boolean().optional(),
  /** Bornes INCLUSES sur `debutLe`, convention `xDu` / `xAu` de toute l'API. */
  debutDu: schemaHorodatage.optional(),
  debutAu: schemaHorodatage.optional(),
  tri: z.enum(TRIS_POINTAGES).default(TRI_DEFAUT_POINTAGES),
});
export type FiltresPointages = z.infer<typeof schemaFiltresPointages>;

/* ------------------------------------------------------------------ */
/* Entrée d'écriture — démarrage (`POST /pointages`)                   */
/* ------------------------------------------------------------------ */

/**
 * `POST /pointages` — DEUX identifiants voyagent sur cet appel, et les confondre casse le
 * hors-ligne. C'est la décision de contrat la plus importante de ce fichier, donc documentée en
 * entier ici plutôt que renvoyée à un commentaire d'une ligne :
 *
 *  1. **En-tête `Idempotency-Key`** (`EN_TETE_IDEMPOTENCE`, `atelier/avertissement.ts`) —
 *     OBLIGATOIRE, comme sur toute création sensible de cette API. Porte l'identité de
 *     L'ÉVÉNEMENT (le geste « démarrer », au sens de `plan-etape-1-frontend.md` §4.3 point 1 :
 *     `{ id: uuidv4, type: 'debut', … }`). Un rejeu réseau du MÊME événement (timeout, tablette
 *     qui retente) rejoue la même réponse — c'est le mécanisme standard.
 *  2. **`id` du CORPS** — OBLIGATOIRE, généré CÔTÉ CLIENT (uuid v4), porte l'identité DU
 *     POINTAGE lui-même, celle qui survivra sur `GET /pointages/{id}`, sur
 *     `POST /pointages/{id}/arreter`, sur `POST /pointages/{id}/corriger`. C'est une DÉVIATION
 *     assumée du reste de cette API (partout ailleurs, `id` est attribué par le serveur et
 *     n'apparaît jamais dans un corps d'entrée) — nécessaire, pas un oubli.
 *
 * POURQUOI la déviation (`plan-etape-1-frontend.md` §4.3 point 5, repris ici avec le raisonnement
 * complet) : le journal hors ligne écrit l'événement « début » PUIS, plus tard, l'événement
 * « fin » — potentiellement des heures après, sur un appareil qui n'a toujours pas pu joindre le
 * serveur pour le premier événement. Si `id` était attribué par le serveur à la synchronisation
 * du « début », l'événement « fin », écrit AVANT que cette synchronisation ait eu lieu, n'aurait
 * AUCUN identifiant serveur vers lequel pointer — il faudrait soit bloquer la saisie de « fin »
 * tant que « début » n'est pas confirmé (contraire à R4, l'optimisme est obligatoire), soit
 * inventer une résolution différée fragile. Le client fixe l'identité du pointage AU MOMENT DU
 * GESTE, une fois pour toutes ; le serveur l'accepte tel quel, sous réserve d'unicité (`409
 * CONFLIT` si cet `id` est déjà pris par un AUTRE pointage — collision distincte d'un conflit
 * d'idempotence : celui-ci porte sur le COUPLE `(tenant, méthode, chemin, Idempotency-Key)`,
 * celui-là sur `id` seul seul, qui est une clé primaire au sens ordinaire).
 *
 * `debutLe` est un CHAMP D'ENTRÉE (pas un horodatage serveur), pour la même raison hors-ligne :
 * le geste a eu lieu au moment où le technicien a appuyé, pas au moment où le réseau a permis de
 * l'envoyer. `decalageHorlogeMs` accompagne cette valeur pour que le serveur sache si elle est
 * fiable (voir `pointage/primitives.ts`).
 *
 * `nature` n'a AUCUNE valeur par défaut ni restriction : les trois branches de l'union sont
 * TOUTES légitimes en tout temps (voir `enums.ts` pour pourquoi P-33 ne change que l'écran, pas
 * l'API).
 *
 * Pas de `confirmations` (`schemaConfirmations`, `atelier/avertissement.ts`) sur cet endpoint :
 * aucune des conditions bloquantes du démarrage (RM-92, RM-93) n'est confirmable — un OR
 * facturé reste facturé, une ligne refusée reste refusée, il n'y a rien à forcer. Le SEUL cas où
 * la spécification aurait pu appeler une confirmation — le chevauchement RM-88/89/90 — est
 * délibérément un SUCCÈS avec avertissement (`POINTAGE_CLOTURE_AUTOMATIQUE`,
 * `contrats/probleme.ts`), jamais un refus à confirmer : re-décider à chaque pointage si on
 * accepte la clôture automatique casserait l'optimisme hors ligne (R4).
 */
const champsCommunsDemarragePointage = {
  id: schemaIdentifiant,
  siteId: schemaIdentifiant,
  technicienId: schemaIdentifiant,
  debutLe: schemaHorodatage,
  source: z.enum(SOURCES_POINTAGE).default('ecran_atelier'),
  decalageHorlogeMs: schemaDecalageHorlogeMs.optional(),
  appareilId: schemaIdAppareil.optional(),
};

export const schemaDemarragePointage = z.discriminatedUnion('nature', [
  z.object({
    nature: z.literal('productif_ligne'),
    ordreReparationId: schemaIdentifiant,
    ligneOrId: schemaIdentifiant,
    ...champsCommunsDemarragePointage,
  }),
  z.object({
    nature: z.literal('productif_or'),
    ordreReparationId: schemaIdentifiant,
    ...champsCommunsDemarragePointage,
  }),
  z.object({
    nature: z.literal('indirect'),
    activiteIndirecte: z.enum(ACTIVITES_INDIRECTES),
    ...champsCommunsDemarragePointage,
  }),
]);
export type EntreeDemarragePointage = z.infer<typeof schemaDemarragePointage>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — actions (§10 de la spécification)              */
/* ------------------------------------------------------------------ */

/**
 * `POST /pointages/{id}/arreter` — `en_cours → termine` (RM-116 : c'est aussi le mécanisme d'une
 * « pause », qui n'est qu'un arrêt ordinaire suivi d'un nouveau démarrage sur l'activité `pause`).
 *
 * `Idempotency-Key` OBLIGATOIRE ICI AUSSI — DÉVIATION du reste de l'API, où une action de
 * transition gardée par son état de départ n'en a normalement pas besoin (voir
 * `schemaActionDemarrer` dans `atelier/ordre-reparation.ts` : « action gardée par l'état de
 * départ »). Cette règle générale suppose un client CONNECTÉ qui sait immédiatement si son appel
 * a abouti. Hors ligne, ce n'est pas vrai : un « arrêter » envoyé sur un réseau instable peut
 * réussir CÔTÉ SERVEUR sans que la tablette reçoive l'accusé de réception ; sans `Idempotency-Key`,
 * le rejeu automatique tomberait sur un pointage déjà `termine` et renverrait
 * `409 POINTAGE_TRANSITION_INTERDITE` — un FAUX échec pour une action qui a réellement réussi.
 * `plan-etape-1-frontend.md` §4.3 point 4 le dit de façon générique pour « chaque événement » ;
 * ce fichier l'applique nommément aux trois actions d'écriture du pointage.
 */
export const schemaArretPointage = z.object({
  finLe: schemaHorodatage,
  decalageHorlogeMs: schemaDecalageHorlogeMs.optional(),
});
export type EntreeArretPointage = z.infer<typeof schemaArretPointage>;

/**
 * `POST /pointages/{id}/corriger` — RM-94 : rôle habilité + motif conditionnellement obligatoire
 * + valeur d'origine conservée + journalisée. UN SEUL endpoint pour TOUS les cas de correction de
 * la spécification, plutôt qu'un par cas :
 *  - corriger une heure de début/fin oubliée ou fausse (RM-94 littéral) ;
 *  - réaffecter la cible d'un pointage en anomalie `ligne_non_pointable` vers une autre ligne, un
 *    autre OR ou une activité indirecte (RM-123, option « réaffecter ») — en changeant `nature` +
 *    le champ cible correspondant ;
 *  - classer un pointage en anomalie comme improductif, sans réaffectation (RM-123, option
 *    « classer en improductif ») — en passant `nature: 'indirect'` avec l'`activiteIndirecte`
 *    appropriée.
 * Un seul mécanisme, une seule ligne d'audit par correction, cohérent avec RM-94.
 *
 * `motif` est `.optional()` AU NIVEAU DU SCHÉMA — PAS parce que RM-94 le rendrait facultatif
 * (RM-94 dit « obligatoire »), mais parce que son caractère obligatoire dépend de L'ÉTAT ACTUEL
 * DU POINTAGE EN BASE, pas seulement du corps de la requête : le serveur compare `debutLe` /
 * `finLe` / `nature` / la cible envoyés à leurs valeurs COURANTES et exige `motif` UNIQUEMENT si
 * au moins une diffère (`400 POINTAGE_MOTIF_REQUIS`) — un appel qui ne change RIEN (par exemple,
 * un chef d'atelier qui rouvre l'écran d'un pointage anormal et referme sans modification) n'a
 * rien à motiver. C'est le même patron que `ARTICLE_REMPLACANT_REQUIS` / `DEVIS_INTERLOCUTEUR_REQUIS`
 * (`contrats/probleme.ts`) : une exigence conditionnelle à l'ÉTAT, pas exprimable par un champ
 * `required` statique, donc portée par un code dédié plutôt que par la validation `zod`.
 *
 * `Idempotency-Key` OBLIGATOIRE — même raisonnement que `schemaArretPointage`, et d'autant plus
 * critique ici qu'un DOUBLE rejeu non idempotent d'une correction pourrait, dans le pire cas,
 * appliquer deux fois un ajustement destiné à n'être appliqué qu'une fois.
 *
 * Sur un pointage `statut = 'verrouille'` : `409 POINTAGE_PERIODE_VERROUILLEE`, jamais
 * `POINTAGE_TRANSITION_INTERDITE` — RM-95 est explicite (« aucune modification, contre-passation
 * uniquement ») et le code dédié permet à un client de proposer directement l'action de sortie
 * pertinente (`actionsProposees` → contre-passation par un rôle habilité), alors que
 * `POINTAGE_TRANSITION_INTERDITE` ne dirait qu'« interdit », sans dire pourquoi.
 */
export const schemaCorrectionPointage = z.object({
  debutLe: schemaHorodatage.optional(),
  finLe: schemaHorodatage.optional(),
  nature: z.enum(NATURES_ACTIVITE_POINTAGE).optional(),
  ordreReparationId: schemaIdentifiant.nullish(),
  ligneOrId: schemaIdentifiant.nullish(),
  activiteIndirecte: z.enum(ACTIVITES_INDIRECTES).nullish(),
  motif: schemaMotif.optional(),
});
export type EntreeCorrectionPointage = z.infer<typeof schemaCorrectionPointage>;

/**
 * `POST /pointages/{id}/valider` et sa variante groupée `POST /pointages/valider` — `termine →
 * valide`.
 *
 * HYPOTHÈSE, PAS UNE CERTITUDE — signalé explicitement plutôt que codé en silence : le diagramme
 * §10 de la spécification montre cette transition sans dire QUI la déclenche ni POURQUOI. Ce
 * fichier propose une lecture cohérente avec le reste (un point de contrôle de visibilité — le
 * chef d'atelier ou le comptable relit et pré-valide les pointages du jour AVANT le verrouillage
 * de fin de mois, `POST /pointages/verrouiller-periode` dans `periode.ts`) mais ne bloque PAS le
 * verrouillage sur cette validation : `verrouiller-periode` peut verrouiller des pointages encore
 * `termine`, jamais validés individuellement — sans quoi un garage qui n'utilise jamais l'action
 * `valider` ne pourrait plus jamais clôturer de période. À confirmer avec expert-metier avant
 * l'implémentation ; si la réponse est « cette étape n'existe dans aucun garage réel », retirer
 * `valider` de `ACTIONS_POINTAGE` reste un changement ADDITIF côté client (une action en moins
 * dans une liste extensible), pas une rupture.
 */
export const schemaValidationPointage = z.object({});
export const schemaValidationPointages = z.object({ pointageIds: schemaListeIdentifiants });
export type EntreeValidationPointages = z.infer<typeof schemaValidationPointages>;
