import { z } from 'zod';

import { LANGUES, type Langue } from '../enums';
import { schemaBooleenQuery, schemaListeQuery } from '../filtres';
import { schemaConfirmations } from './avertissement';
import {
  NATURES_NOTE,
  ROLES_CONTACT,
  STATUTS_CLIENT,
  TYPES_ADRESSE,
  TYPES_CLIENT,
  TYPES_CONSENTEMENT,
  type CritereDoublonClient,
  type NatureNote,
  type RoleContact,
  type StatutClient,
  type TypeAdresse,
  type TypeClient,
  type TypeConsentement,
} from './enums';
import {
  schemaCentimesPositif,
  schemaCodePays,
  schemaDateJour,
  schemaEmail,
  schemaHorodatage,
  schemaIde,
  schemaIdentifiant,
  schemaMotif,
  schemaPourmille,
  schemaTexteCourt,
  schemaTexteLong,
} from './primitives';

/**
 * Clients (contrats-api-etape-1.md §7.3).
 *
 * Aucune ressource ne porte `tenantId` : le tenant est résolu depuis la session, JAMAIS depuis un
 * paramètre ni un corps. Un `tenantId` dans un contrat exposé est un défaut de revue.
 *
 * Il n'existe AUCUN `DELETE` : un client se DÉSACTIVE (RM-12) ou se fusionne (RM-06).
 */

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

export interface ReponseClient {
  readonly id: string;
  /** Numéro CONTINU par tenant, jamais réutilisé (RM-11) — d'où l'`Idempotency-Key` à la création. */
  readonly numeroClient: string;
  readonly type: TypeClient;
  readonly statut: StatutClient;
  readonly civilite: string | null;
  readonly nom: string | null;
  readonly prenom: string | null;
  readonly raisonSociale: string | null;
  /**
   * Rendu d'affichage calculé par le serveur (`raisonSociale`, ou `nom prenom`). Existe pour que
   * deux clients de l'API n'inventent pas deux façons différentes de composer un nom.
   */
  readonly nomAffiche: string;
  readonly ide: string | null;
  readonly langueCorrespondance: Langue;
  readonly email: string | null;
  readonly telephone: string | null;
  readonly telephoneE164: string | null;
  /** RM-14 : impose `numeroCommandeInterne` sur les OR de ce client (`OR_PO_MANQUANT`). */
  readonly poObligatoire: boolean;
  /** RM-10 : rattachement à un groupe (auto-référence vers un autre client). */
  readonly groupeId: string | null;
  /**
   * RM-06 : renseigné sur la fiche ABSORBÉE. `GET /clients/{sourceId}` continue de répondre
   * `200` — un connecteur qui détient l'ancien identifiant doit pouvoir suivre la trace, pas
   * recevoir un 404.
   */
  readonly fusionneVersClientId: string | null;
  readonly referenceExterne: string | null;
  /**
   * RA-14 (`docs/specification-relances-automatiques.md` §5) : arrêt de tout contact demandé par
   * le client (litige, mandataire) — PAS un consentement marketing (voir `TypeConsentement`,
   * portée disjointe). Prime sur tout consentement, y compris pour une relance de facture impayée
   * où aucun consentement marketing n'est requis. Posé/levé par ses deux gestes dédiés
   * (`POST /clients/{id}/arreter-contact`, `.../reprendre-contact`) — jamais par `PATCH`.
   */
  readonly plusAucunContact: boolean;
  /** Motif de `plusAucunContact` — requis tant que le drapeau est posé, `null` sinon. */
  readonly motif: string | null;
  readonly dernierPassageLe: string | null;
  /**
   * Notes de nature `alerte` UNIQUEMENT (RM-13 : « affichée en rouge à l'ouverture de la fiche,
   * au RDV et à la réception »). Embarquées ici pour un affichage sans aller-retour réseau
   * supplémentaire — même principe que `ReponseContexteAtelierVehicule.alertesClient`
   * (`atelier/vehicule.ts`). Les notes `interne` ne sortent JAMAIS ici : uniquement via
   * `GET /clients/{clientId}/notes`.
   */
  readonly notesAlerte: readonly ReponseClientNote[];
  readonly creeLe: string;
  readonly modifieLe: string;
}

/**
 * Projection minimale d'un client, embarquée dans les autres ressources — et forme de
 * `GET /clients` (liste paginée). Les quatre champs suivants (`telephone`, `localite`,
 * `nombreVehicules`, `dernierPassageLe`) existent pour la DÉSAMBIGUÏSATION au comptoir : deux
 * homonymes dans le fichier client sont ordinaires, et sans un repère au-delà du nom le
 * réceptionniste choisit au hasard — l'erreur ne se découvre alors qu'à la facturation, quand
 * elle coûte le plus cher à corriger. Ce ne sont pas des colonnes de confort.
 */
export interface ClientResume {
  readonly id: string;
  readonly numeroClient: string;
  readonly nomAffiche: string;
  readonly type: TypeClient;
  readonly statut: StatutClient;
  readonly langueCorrespondance: Langue;
  readonly poObligatoire: boolean;
  /** Colonne directe de la fiche client. */
  readonly telephone: string | null;
  /** Courriel de la fiche. Renseigné quand le résumé est embarqué dans un OR ou un rendez-vous
   *  (`null` = aucun courriel) ; ABSENT sur `GET /clients` (additif, jamais requis). */
  readonly email?: string | null;
  /** Localité de l'adresse PRINCIPALE active du client. `null` si aucune adresse — cas normal (fiche fraîche). */
  readonly localite: string | null;
  /** Véhicules actuellement détenus par le client (détentions ouvertes, `vehicule_detention.au is null`). */
  readonly nombreVehicules: number;
  /** Même donnée que `ReponseClient.dernierPassageLe` (dérivée du dernier OR ouvert) — un seul calcul, jamais deux qui divergeraient. */
  readonly dernierPassageLe: string | null;
}

export interface ReponseClientAdresse {
  readonly id: string;
  readonly type: TypeAdresse;
  readonly rue: string;
  readonly complement: string | null;
  readonly npa: string;
  readonly localite: string;
  readonly pays: string;
  readonly actif: boolean;
}

export interface ReponseClientContact {
  readonly id: string;
  readonly nom: string;
  readonly prenom: string | null;
  readonly fonction: string | null;
  readonly telephone: string | null;
  readonly telephoneE164: string | null;
  readonly email: string | null;
  readonly langue: Langue | null;
  /** CUMULABLES (RM-04) : un même contact peut être conducteur ET signataire. */
  readonly roles: readonly RoleContact[];
  readonly actif: boolean;
}

/**
 * Conditions commerciales DATÉES (RM-07). La base garantit par contrainte d'exclusion qu'il
 * n'existe jamais deux jeux concurrents à une date donnée — c'est la condition de reproductibilité
 * de CT-03, et la raison pour laquelle un chevauchement produit `400 VALIDATION_ECHOUEE`.
 *
 * Ces valeurs sont FIGÉES sur l'OR à sa création (RM-50) : les modifier n'altère aucun OR existant.
 */
export interface ReponseClientCondition {
  readonly id: string;
  readonly rabaisMoPourmille: number;
  readonly rabaisPiecesPourmille: number;
  readonly rabaisPneusPourmille: number;
  readonly tauxHoraireCode: string | null;
  /**
   * Résolus depuis le référentiel `taux_horaire` À LA DATE `valideDuLe` de CETTE condition (#72) —
   * même mécanisme que la résolution RM-65 d'une ligne d'OR
   * (`apps/api/src/atelier/taux-horaire.ts::resoudreTauxHorairePourDate`), appliqué ici à la date de
   * la condition plutôt qu'à « aujourd'hui » : un taux modifié après coup dans le paramétrage ne
   * doit pas réécrire l'historique d'une condition déjà en vigueur. `null` quand `tauxHoraireCode`
   * est absent (rien à résoudre) ou que le code ne correspond à aucune période de validité couvrant
   * `valideDuLe` (référentiel modifié depuis). FACULTATIFS dans le TYPE (le serveur les peuple
   * TOUJOURS, `null` inclus) — additif pur, jamais une rupture de compatibilité (§11.1), même
   * arbitrage qu'`OrdreReparationResume.enRetard?`.
   */
  readonly tauxHoraireLibelle?: string | null;
  readonly tauxHoraireMontantCentimes?: number | null;
  readonly delaiPaiementJours: number | null;
  readonly modePaiement: string | null;
  readonly plafondCentimes: number | null;
  readonly valideDuLe: string;
  readonly valideAuLe: string | null;
}

/**
 * Consentements APPEND-ONLY (RM-09, nLPD). Une révocation est une NOUVELLE ligne
 * `accorde: false`, jamais une mise à jour — c'est ce qui donne sa valeur de preuve.
 * D'où l'absence de `PATCH` et de `DELETE` sur cette sous-collection.
 */
export interface ReponseClientConsentement {
  readonly id: string;
  readonly type: TypeConsentement;
  readonly accorde: boolean;
  readonly recueilliLe: string;
  readonly canal: string | null;
}

export interface ReponseClientNote {
  readonly id: string;
  /** `alerte` remonte dans le contexte-atelier et à chaque ouverture de fiche (RM-13, RM-36). */
  readonly nature: NatureNote;
  readonly texte: string;
  readonly auteur: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
  readonly creeLe: string;
}

/* ------------------------------------------------------------------ */
/* Détection de doublons — AVANT création (RM-05)                      */
/* ------------------------------------------------------------------ */

export interface CandidatDoublonClient {
  readonly clientId: string;
  readonly numeroClient: string;
  readonly nom: string;
  readonly npa: string | null;
  readonly critere: CritereDoublonClient;
  /** Pertinence dans `[0,1]`, décroissante. Ordonne la liste, ne décide de rien. */
  readonly score: number;
}

/**
 * `GET /doublons-clients` — PROJECTION, consommée à la frappe, non paginée.
 *
 * Placée à la RACINE et non sous `/clients/…` : un segment littéral ne se met jamais là où un
 * identifiant est attendu. `/clients/doublons-probables` serait ambigu avec `/clients/{clientId}`
 * et se casserait le jour où un identifiant cesse d'être un uuid.
 *
 * La détection est un AVERTISSEMENT (`CLIENT_DOUBLON_PROBABLE`), jamais un blocage (CT-01) : deux
 * frères à la même adresse sont deux clients légitimes.
 */
export interface ReponseDoublonsClients {
  readonly candidats: readonly CandidatDoublonClient[];
}

/* ------------------------------------------------------------------ */
/* Filtres et tris (§6.2)                                              */
/* ------------------------------------------------------------------ */

/** Liste FERMÉE. Un tri non listé produit `400`, jamais un tri silencieusement ignoré. */
export const TRIS_CLIENTS = [
  'nom:asc',
  'nom:desc',
  'numeroClient:asc',
  'numeroClient:desc',
  'creeLe:desc',
  'dernierPassageLe:desc',
] as const;
export const TRI_DEFAUT_CLIENTS = 'nom:asc';

export const TRIS_VEHICULES_DU_CLIENT = ['plaque:asc', 'plaque:desc'] as const;
export const TRI_DEFAUT_VEHICULES_DU_CLIENT = 'plaque:asc';

export const TRIS_OR_DU_CLIENT = ['ouvertLe:desc', 'ouvertLe:asc'] as const;
export const TRI_DEFAUT_OR_DU_CLIENT = 'ouvertLe:desc';

/**
 * Un filtre multivalué se RÉPÈTE (`?statut=actif&statut=bloque`) — jamais de liste séparée par
 * virgules, qui casse dès qu'une valeur en contient une.
 *
 * Défaut de `statut` : `actif` + `bloque`. Un client bloqué reste visible au comptoir — c'est
 * précisément celui qu'il faut voir avant d'ouvrir un OR (RM-08).
 */
export const schemaFiltresClients = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  type: z.enum(TYPES_CLIENT).optional(),
  statut: schemaListeQuery(z.enum(STATUTS_CLIENT)).optional(),
  groupeId: schemaIdentifiant.optional(),
  poObligatoire: schemaBooleenQuery().optional(),
  /** Utile seulement si P-30 = cloisonné. Ignoré sinon. */
  siteId: schemaIdentifiant.optional(),
  tri: z.enum(TRIS_CLIENTS).default(TRI_DEFAUT_CLIENTS),
});

/** RM-20 : les détentions closes ne sont visibles que sur demande explicite. */
export const schemaFiltresVehiculesDuClient = z.object({
  inclureAnciennesDetentions: schemaBooleenQuery(false),
  tri: z.enum(TRIS_VEHICULES_DU_CLIENT).default(TRI_DEFAUT_VEHICULES_DU_CLIENT),
});

export const schemaParametresDoublonsClients = z
  .object({
    nom: z.string().trim().min(2).max(200).optional(),
    npa: z.string().trim().max(10).optional(),
    email: schemaEmail.optional(),
    telephoneMobile: z.string().trim().max(30).optional(),
    ide: schemaIde.optional(),
    /** Exclut la fiche en cours d'édition, pour ne pas se signaler soi-même. */
    exclureClientId: schemaIdentifiant.optional(),
  })
  .refine(
    (v) => Boolean(v.nom ?? v.npa ?? v.email ?? v.telephoneMobile ?? v.ide),
    'Au moins un critère de recherche est requis.',
  );

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * RÈGLE DE NPA RETENUE (défaut constaté : « ABCDE » et « 19201920 » acceptés sur une adresse
 * `pays: 'CH'`) — seule la Suisse est validée STRICTEMENT ici, parce que c'est le seul format que
 * dmsforall connaît avec certitude : la Poste suisse n'émet que des NPA à EXACTEMENT 4 chiffres
 * (`^\d{4}$`). Pour tout autre `pays`, AUCUNE contrainte de forme supplémentaire n'est ajoutée —
 * la borne `min(4).max(10)` déjà en place suffit à couvrir un NPA français ou allemand (5
 * chiffres) sans les refuser à tort, et un futur NPA à lettres (Royaume-Uni, Pays-Bas, Canada…)
 * resterait accepté. Une table de formats par pays serait plus complète mais dépasse le périmètre
 * d'un correctif ciblé — signalé plutôt que deviné.
 *
 * Appliquée par `.superRefine(...)`, PAS par un simple `.regex()` sur le champ `npa` seul : la
 * règle dépend de DEUX champs (`npa` ET `pays`), donc elle ne peut être exprimée qu'au niveau de
 * l'objet entier.
 *
 * `npaSuisseValide` est exportée pour rester l'UNIQUE source de vérité du format : réutilisée par
 * `ServiceClientSousCollections.modifierAdresse` (`apps/api/src/clients/service-client-sous-collections.ts`)
 * pour revalider l'état EFFECTIF (base + corps `PATCH` fusionnés) — voir la doc de
 * `schemaModificationAdresseClient` plus bas pour le trou que ce partage ferme.
 */
const NPA_SUISSE_REGEX = /^\d{4}$/;

export function npaSuisseValide(npa: string): boolean {
  return NPA_SUISSE_REGEX.test(npa);
}

function validerNpaSelonPays(
  valeurs: { readonly npa?: string; readonly pays?: string },
  ctx: z.RefinementCtx,
): void {
  if (valeurs.pays === 'CH' && valeurs.npa !== undefined && !npaSuisseValide(valeurs.npa)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Le NPA suisse comporte exactement 4 chiffres (ex. 1950).',
      path: ['npa'],
    });
  }
}

/**
 * Base STRUCTURELLE (sans `.superRefine`) : conservée en `ZodObject` nu pour rester composable —
 * `.omit(...)` (ci-dessous, `schemaCreationClient.adressePrincipale`) et `.partial()`
 * (`schemaModificationAdresseClient`) n'existent que sur un `ZodObject`, pas sur le `ZodEffects`
 * qu'un `.superRefine()` produirait. La validation NPA×pays est donc appliquée séparément à
 * CHAQUE forme finale ci-dessous plutôt qu'une seule fois ici.
 */
const schemaAdresseClientBase = z
  .object({
    type: z.enum(TYPES_ADRESSE),
    rue: schemaTexteCourt,
    complement: schemaTexteCourt.nullish(),
    npa: z.string().trim().min(4).max(10),
    localite: schemaTexteCourt,
    pays: schemaCodePays.default('CH'),
  })
  .strict();

export const schemaAdresseClient = schemaAdresseClientBase.superRefine(validerNpaSelonPays);

/**
 * `PATCH` (partiel) : ce schéma seul NE PEUT PAS garantir la règle NPA×pays sur l'état résultant
 * — si le corps ne modifie QUE `npa` (ou QUE `pays`), il ne voit jamais la ligne existante en
 * base, donc `.superRefine(validerNpaSelonPays)` ci-dessous ne s'applique qu'aux champs
 * effectivement présents dans CE corps. Le trou (créer une adresse CH valide, puis la corrompre
 * via `PATCH { npa: 'ABCDE' }` sans `pays`) est fermé, mais PAS ici : c'est
 * `ServiceClientSousCollections.modifierAdresse`
 * (`apps/api/src/clients/service-client-sous-collections.ts`) qui en est le propriétaire réel.
 * Mécanisme : si `npa` ou `pays` figure dans le corps, le service charge l'adresse existante
 * AVANT d'écrire, fusionne (champ envoyé sinon valeur en base) pour obtenir l'état EFFECTIF, et
 * revalide cet état avec `npaSuisseValide` (même prédicat que `validerNpaSelonPays` ci-dessus,
 * exporté précisément pour que les deux couches ne divergent jamais). Un corps qui ne touche ni
 * `npa` ni `pays` ne déclenche aucune lecture supplémentaire — la règle ne peut pas être violée
 * par une telle requête.
 */
export const schemaModificationAdresseClient = schemaAdresseClientBase
  .partial()
  .extend({ actif: z.boolean().optional() })
  .superRefine(validerNpaSelonPays);

export const schemaContactClient = z
  .object({
    nom: schemaTexteCourt,
    prenom: schemaTexteCourt.nullish(),
    fonction: schemaTexteCourt.nullish(),
    telephone: z.string().trim().max(30).nullish(),
    email: schemaEmail.nullish(),
    langue: z.enum(LANGUES).nullish(),
    /** Non vide : un contact sans rôle n'a aucun usage métier (`cardinality(roles) > 0` en base). */
    roles: z.array(z.enum(ROLES_CONTACT)).min(1),
  })
  .strict();

export const schemaModificationContactClient = schemaContactClient
  .partial()
  .extend({ actif: z.boolean().optional() });

export const schemaConditionClient = z
  .object({
    rabaisMoPourmille: schemaPourmille.default(0),
    rabaisPiecesPourmille: schemaPourmille.default(0),
    rabaisPneusPourmille: schemaPourmille.default(0),
    tauxHoraireCode: z.string().trim().max(40).nullish(),
    delaiPaiementJours: z.number().int().min(0).max(365).nullish(),
    modePaiement: z.string().trim().max(40).nullish(),
    plafondCentimes: schemaCentimesPositif.nullish(),
    valideDuLe: schemaDateJour,
    /** `null` = ouvert. Un chevauchement produit `400 VALIDATION_ECHOUEE`. */
    valideAuLe: schemaDateJour.nullish(),
  })
  .strict();

export const schemaConsentementClient = z
  .object({
    type: z.enum(TYPES_CONSENTEMENT),
    accorde: z.boolean(),
    recueilliLe: schemaHorodatage,
    canal: z.string().trim().max(40).nullish(),
  })
  .strict();

export const schemaNoteClient = z
  .object({
    nature: z.enum(NATURES_NOTE),
    texte: schemaTexteLong,
  })
  .strict();

/**
 * `POST /clients` — `Idempotency-Key` OBLIGATOIRE (RM-11 : un rejeu ne doit pas brûler un numéro
 * de client). `numeroClient` et `statut` ne sont JAMAIS entrants.
 *
 * La contrainte « particulier ⇒ nom, entreprise ⇒ raisonSociale » est portée ici ET par un CHECK
 * en base : le schéma donne un message utilisable au comptoir, la base garantit l'invariant même
 * pour un import ou une migration.
 */
export const schemaCreationClient = z
  .object({
    type: z.enum(TYPES_CLIENT),
    civilite: z.string().trim().max(20).nullish(),
    nom: schemaTexteCourt.nullish(),
    prenom: schemaTexteCourt.nullish(),
    raisonSociale: schemaTexteCourt.nullish(),
    ide: schemaIde.nullish(),
    langueCorrespondance: z.enum(LANGUES),
    /**
     * FACULTATIVE (RF-59) : un client au comptoir sans rendez-vous n'a souvent qu'un nom à donner
     * — l'adresse suivra, ou pas, s'il paie comptant en repartant. Exiger `rue`/`npa`/`localite`
     * dès la création bloquait précisément ce cas, constaté en testant l'ouverture d'un OR au
     * comptoir. L'aval gère déjà l'absence : un client `particulier` sans aucune ligne
     * `client_adresse` a été prouvé EN EXÉCUTION capable d'aller jusqu'à l'émission d'une facture
     * (`QRFacture` avec `debiteur: null`, créancier intact) — ce n'est pas une régression tolérée,
     * c'est le comportement voulu. Ne PAS « corriger » ce champ en le rendant à nouveau requis sans
     * revérifier ce chemin.
     *
     * Reste validée à l'identique QUAND elle est fournie : `.optional()` change seulement si le
     * champ peut être absent, pas ce qui est exigé une fois présent — une adresse partielle ou un
     * NPA suisse mal formé est toujours refusé par `schemaAdresseClientBase` + `validerNpaSelonPays`.
     */
    adressePrincipale: schemaAdresseClientBase
      .omit({ type: true })
      .superRefine(validerNpaSelonPays)
      .optional(),
    telephones: z
      .array(
        z
          .object({
            valeur: z.string().trim().min(4).max(30),
            principal: z.boolean().default(false),
          })
          .strict(),
      )
      .max(5)
      .default([]),
    email: schemaEmail.nullish(),
    conditions: schemaConditionClient.omit({ valideDuLe: true, valideAuLe: true }).optional(),
    poObligatoire: z.boolean().default(false),
    groupeId: schemaIdentifiant.nullish(),
    referenceExterne: z.string().trim().max(80).nullish(),
  })
  .extend(schemaConfirmations.shape)
  .strict()
  .refine((v) => (v.type === 'particulier' ? Boolean(v.nom) : Boolean(v.raisonSociale)), {
    message: 'Un particulier exige `nom`, une entreprise exige `raisonSociale`.',
    path: ['nom'],
  });

/**
 * `PATCH /clients/{clientId}`. **`type` n'est PAS modifiable** (RM-01) : l'envoyer produit
 * `409 CLIENT_TYPE_IMMUABLE`, et non un `VALIDATION_ECHOUEE` — la règle est métier, le code doit
 * la nommer pour que le message traduit soit juste. Le champ est donc absent de ce schéma, et le
 * refus est levé par le service quand la propriété est présente dans le corps brut.
 *
 * `statut` est en lecture seule : la désactivation passe par son action nommée.
 */
export const schemaModificationClient = z
  .object({
    civilite: z.string().trim().max(20).nullish(),
    nom: schemaTexteCourt.nullish(),
    prenom: schemaTexteCourt.nullish(),
    raisonSociale: schemaTexteCourt.nullish(),
    ide: schemaIde.nullish(),
    langueCorrespondance: z.enum(LANGUES).optional(),
    email: schemaEmail.nullish(),
    telephone: z.string().trim().max(30).nullish(),
    poObligatoire: z.boolean().optional(),
    groupeId: schemaIdentifiant.nullish(),
    referenceExterne: z.string().trim().max(80).nullish(),
  })
  .strict();

/**
 * `POST /clients/{clientId}/desactiver` — refusée s'il reste des OR, RDV ou détentions ouverts
 * (`409 CLIENT_DESACTIVATION_IMPOSSIBLE`, `blocages` nommant chacun d'eux).
 */
export const schemaDesactivationClient = z.object({ motif: schemaMotif }).strict();

/**
 * `POST /clients/{clientId}/arreter-contact` — RA-14 : pose l'arrêt de tout contact. `motif`
 * OBLIGATOIRE, miroir exact du CHECK base `client_plus_aucun_contact_motif_chk` (migration 0045) :
 * la validation applicative donne un message utilisable au comptoir, la base garantit l'invariant
 * même pour un correctif direct en base. Idempotent en pratique : reposer le drapeau alors qu'il
 * l'est déjà REMPLACE `motif` par la valeur envoyée plutôt que d'échouer — un garagiste qui affine
 * la raison ne doit pas être bloqué par un faux conflit, la trace des deux motifs successifs reste
 * de toute façon dans `audit_atelier` (trigger générique posé sur `client` depuis la migration
 * 0006) — PAS encore exposée par une route API à ce jour, GAP DE CONTRAT signalé au même
 * titre que ceux déjà notés ailleurs dans ce fichier.
 */
export const schemaArreterContactClient = z.object({ motif: schemaMotif }).strict();

/**
 * `POST /clients/{clientId}/reprendre-contact` — RA-14 : lève l'arrêt de tout contact. `motif`
 * OBLIGATOIRE ici aussi (arbitrage DÉLIBÉRÉ, non forcé par la base — le CHECK `client_plus_aucun_
 * contact_motif_chk` n'exige `motif` que quand le drapeau est VRAI) : un geste qui réautorise à
 * recontacter un client qui avait explicitement demandé l'inverse mérite la même traçabilité « qui,
 * quand, pourquoi » que la pose, pas moins. Efface `client.motif` en base (voir le service) : ce
 * champ documente la raison COURANTE du drapeau, qui devient `null` une fois celui-ci levé — donc
 * PAS l'emplacement où persister la raison de la levée elle-même. Même situation que `client.statut`
 * (`schemaDesactivationClient` ci-dessus) : le service conserve ce motif sous forme de `client_note`
 * (nature `interne`) plutôt que de le perdre.
 */
export const schemaReprendreContactClient = z.object({ motif: schemaMotif }).strict();

/**
 * `POST /clients/{clientId}/fusionner` (RM-06, CT-02) — droit `direction` seul.
 *
 * `confirmationNom` reprend le NOM EXACT de la fiche absorbée : une garde SAISIE, pas une case à
 * cocher. La fusion est irréversible côté utilisateur et déplace véhicules, OR, RDV et documents.
 */
export const schemaFusionClient = z
  .object({
    clientSourceId: schemaIdentifiant,
    confirmationNom: schemaTexteCourt,
  })
  .extend(schemaConfirmations.shape)
  .strict();

export type EntreeCreationClient = z.infer<typeof schemaCreationClient>;
export type EntreeModificationClient = z.infer<typeof schemaModificationClient>;
export type EntreeDesactivationClient = z.infer<typeof schemaDesactivationClient>;
export type EntreeArreterContactClient = z.infer<typeof schemaArreterContactClient>;
export type EntreeReprendreContactClient = z.infer<typeof schemaReprendreContactClient>;
export type EntreeFusionClient = z.infer<typeof schemaFusionClient>;
export type EntreeAdresseClient = z.infer<typeof schemaAdresseClient>;
export type EntreeContactClient = z.infer<typeof schemaContactClient>;
export type EntreeConditionClient = z.infer<typeof schemaConditionClient>;
export type EntreeConsentementClient = z.infer<typeof schemaConsentementClient>;
export type EntreeNoteClient = z.infer<typeof schemaNoteClient>;
export type FiltresClients = z.infer<typeof schemaFiltresClients>;
export type ParametresDoublonsClients = z.infer<typeof schemaParametresDoublonsClients>;
