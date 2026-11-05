import { z } from 'zod';

import { schemaCodePays } from '../atelier/primitives';

/**
 * Bloc créancier du QR-facture (`RF-54`, `RF-55`, `RF-60`, `PF-03`) — adresse structurée du
 * garage et ses comptes IBAN/QR-IBAN. `GET|PATCH /parametres-facturation/creancier`
 * (`apps/api/src/parametrage/bloc-creancier/`).
 *
 * SOURCE DE VÉRITÉ UNIQUE de cette forme : consommé tel quel côté API (le schéma zod local
 * dérive de `schemaModificationBlocCreancier`, le DTO Swagger `implements ReponseBlocCreancier`)
 * et côté web (`apps/web/src/hooks/parametrage/bloc-creancier.api.ts`). Avant ce fichier, les
 * deux côtés redéclaraient la même forme séparément — un écart signalé par le lot qui a livré
 * l'écran, refermé ici.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * SINGLETON PAR TENANT, jamais une collection
 * ────────────────────────────────────────────────────────────────────────────────────────
 * Au plus une ligne (`tenant_bloc_creancier_tenant_id_uk`, unique sur `tenant_id` seul). `GET`
 * avant toute écriture rend `200` avec TOUS les champs `null`, `pays: 'CH'`, `version: 0` —
 * c'est l'état initial de tout tenant après la migration 0014, jamais un `404` (voir
 * `versDtoBlocCreancier`, `apps/api/src/parametrage/bloc-creancier/mappeur-bloc-creancier.ts`).
 * Un client de cette API ne doit donc jamais traiter une réponse vide comme une erreur.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * `iban` et `qrIban` : deux comptes distincts, jamais interchangeables (`RF-55`)
 * ────────────────────────────────────────────────────────────────────────────────────────
 * `iban` est un compte ORDINAIRE (IID hors de la plage 30000–31999) : il n'admet qu'une
 * référence SCOR ou aucune référence, jamais QRR. `qrIban` est un QR-IBAN (IID dans cette
 * plage) : lui seul admet une référence QRR. Le serveur valide la clé de contrôle modulo 97
 * (ISO 7064) ET refuse un IBAN posé dans le mauvais champ (`facturation/qr/iban.ts`,
 * `validerIbanCreancier`/`estQrIban`) — jamais dupliqué dans ce schéma, qui ne valide que la
 * FORME (longueur). Codes d'erreur DE CHAMP émis par le serveur sur `PATCH`, vérifiés dans le
 * code réel (`apps/api/src/parametrage/bloc-creancier/mappeur-bloc-creancier.ts`) :
 *   - `IBAN_INVALIDE` — mal formé, pays hors CH/LI, longueur fausse, ou clé de contrôle modulo
 *     97 fausse (`iban` OU `qrIban`) ;
 *   - `IBAN_EST_UN_QR_IBAN` — un QR-IBAN a été saisi dans le champ `iban` ;
 *   - `QR_IBAN_SANS_IID_RESERVE` — un IBAN ordinaire a été saisi dans le champ `qrIban`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * `numero` : facultatif à la SAISIE, requis à l'ÉMISSION — deux règles, pas une
 * ────────────────────────────────────────────────────────────────────────────────────────
 * Ce contrat le laisse absent (`null`) à la saisie comme à la lecture : une case postale, un
 * lieu-dit ou un hameau (courant en Suisse rurale) n'a pas de numéro de rue, et un garage doit
 * pouvoir enregistrer son IBAN avant de connaître son adresse complète. C'est différent du bloc
 * DÉBITEUR (le client, `packages/shared/src/contrats/facturation/document.ts`), où `numero`
 * peut légitimement manquer en PERMANENCE.
 * Pour le bloc CRÉANCIER (le garage), `numero` fait partie des six champs que `RF-54` exige au
 * moment d'ÉMETTRE une facture (`CHAMPS_REQUIS_BLOC_CREANCIER`,
 * `apps/api/src/facturation/qr/adresse.ts`) : une émission avec un créancier incomplet échoue en
 * `409 QR_CREANCIER_INCOMPLET`, jamais silencieusement. Ce contrat ne rend donc PAS `numero`
 * obligatoire ici (ce serait mentir sur la SAISIE) et ne le laisse pas non plus croire facultatif
 * dans l'absolu (ce serait mentir sur l'ÉMISSION) — la nuance vit dans ce commentaire et dans le
 * bandeau de complétude de l'écran, pas dans le type.
 */
export interface ReponseBlocCreancier {
  readonly nom: string | null;
  readonly rue: string | null;
  /** Absent pour une case postale, un lieu-dit ou un hameau à la SAISIE. Un des six champs
   *  requis à l'ÉMISSION (`RF-54`) — voir le commentaire de tête de fichier. */
  readonly numero: string | null;
  readonly npa: string | null;
  readonly localite: string | null;
  /** Code ISO 3166-1 alpha-2. `CH` ou `LI` uniquement pour un compte de QR-facture suisse. Non
   *  nullable (colonne `not null default 'CH'`). */
  readonly pays: string;
  /** Compte ORDINAIRE — jamais un QR-IBAN, colonne distincte de `qrIban`. Forme compacte (21
   *  caractères, sans espaces). */
  readonly iban: string | null;
  /** QR-IBAN (IID 30000–31999) — jamais un IBAN ordinaire. Forme compacte (21 caractères, sans
   *  espaces). */
  readonly qrIban: string | null;
  /** Sert l'ETag (`W/"<version>"`) et la revalidation conditionnelle (`If-None-Match`). Dérivé
   *  de `modifie_le` ; `0` si aucun bloc créancier n'a encore été enregistré pour ce tenant —
   *  sentinel sûr, jamais atteignable par un `modifie_le` réel. */
  readonly version: number;
}

/**
 * Longueurs maximales des champs d'ADRESSE du bloc créancier — bornes du Swiss QR Code
 * (Implementation Guidelines, champs `Name`/`StrtNmOrAdrLine1`/`BldgNbOrAdrLine2`/`PstCd`/
 * `TwnNm`). Reprises À L'IDENTIQUE de `LONGUEURS_MAX` (`apps/api/src/facturation/qr/structure.ts`),
 * qui reste la source de vérité de l'encodeur QR : ce module pur ne peut pas être importé depuis
 * `packages/shared` (mauvais sens de dépendance, `apps/api` → `packages/shared` uniquement), donc
 * ces cinq chiffres sont dupliqués ici. ce sont des constantes d'un standard externe (pas un choix
 * produit) : leur dérive n'est pas un risque réaliste, mais un changement de l'un des deux
 * fichiers sans l'autre doit être traité comme un bug.
 *
 * `iban` N'EST DÉLIBÉRÉMENT PAS ICI : voir le commentaire sur `iban`/`qrIban` ci-dessous — la
 * borne de ces deux champs n'est pas la longueur compacte du standard QR.
 */
const LONGUEURS_MAX_ADRESSE_CREANCIER = {
  nom: 70,
  rue: 70,
  numero: 16,
  npa: 16,
  localite: 35,
} as const;

/**
 * Borne de SAISIE de `iban`/`qrIban` — délibérément PLUS LARGE que `LONGUEURS_MAX.iban` (21,
 * forme compacte sans espaces du standard QR). La forme saisie tolère les espaces groupés par
 * paquets de 4 (ex. `"CH93 0076 2011 6238 5295 7"`, 26 caractères) : la normalisation (majuscules,
 * suppression des espaces) est faite par le SERVEUR (`facturation/qr/iban.ts`, `normaliserIban`),
 * APRÈS cette validation de forme, jamais avant. Un `max` à 21 rejetterait donc un IBAN valide et
 * correctement saisi au clavier — 34 couvre 21 caractères + 5 séparateurs + marge, cohérent avec
 * le `max` d'origine de ce schéma avant unification.
 */
const LONGUEUR_MAX_SAISIE_IBAN = 34;

/**
 * `PATCH /parametres-facturation/creancier` — mise à jour PARTIELLE d'un singleton (upsert,
 * aucune ligne préexistante requise). Chaque champ est `.nullish()` (sauf `pays`) : `undefined`
 * = ne pas toucher ce champ, `null` = l'effacer explicitement (un garage qui change de banque
 * doit pouvoir faire disparaître l'ancien IBAN sans qu'on lui substitue une valeur bidon). Même
 * sémantique que `schemaModificationParametresSite` pour les champs nullables.
 *
 * `numero` est nullish comme les autres — jamais rendu obligatoire ICI. `RF-54`/`RF-60` (bloc
 * créancier complet requis pour ÉMETTRE une facture) est une règle d'ÉMISSION, pas de SAISIE :
 * voir `CHAMPS_REQUIS_BLOC_CREANCIER` (`apps/api/src/facturation/qr/adresse.ts`) et le
 * commentaire de tête de fichier — un créancier incomplet doit pouvoir être enregistré tel quel.
 *
 * Validation de FORME uniquement (longueur, non-vide) : la clé de contrôle modulo 97, la
 * cohérence pays (CH/LI) et la distinction IBAN/QR-IBAN sont des règles MÉTIER vérifiées côté
 * serveur (`apps/api/src/facturation/qr/iban.ts`), jamais dupliquées dans ce schéma — la forme
 * libre saisie (espaces tolérés, ex. `"CH93 0076 2011 6238 5295 7"`) part telle quelle, c'est le
 * serveur qui normalise.
 */
export const schemaModificationBlocCreancier = z
  .object({
    nom: z.string().trim().min(1).max(LONGUEURS_MAX_ADRESSE_CREANCIER.nom).nullish(),
    rue: z.string().trim().min(1).max(LONGUEURS_MAX_ADRESSE_CREANCIER.rue).nullish(),
    numero: z.string().trim().min(1).max(LONGUEURS_MAX_ADRESSE_CREANCIER.numero).nullish(),
    npa: z.string().trim().min(1).max(LONGUEURS_MAX_ADRESSE_CREANCIER.npa).nullish(),
    localite: z.string().trim().min(1).max(LONGUEURS_MAX_ADRESSE_CREANCIER.localite).nullish(),
    /** Non nullable (colonne `not null default 'CH'`) : absent du corps = ne pas toucher (garde
     *  la valeur en base, `CH` par défaut sur une ligne neuve), jamais effaçable à `null` — un
     *  créancier sans pays n'a pas de sens pour un compte CH/LI. Même primitive que
     *  `pays: schemaCodePays.default('CH')` de `atelier/vehicule.ts`, `atelier/client.ts` et
     *  `facturation/document.ts` — cohérente avec le reste de l'API plutôt qu'un motif
     *  `^[A-Z]{2}$` local : la borne stricte reste portée par la contrainte `CHECK` en base
     *  (`tenant_bloc_creancier_pays_chk`), qui refuse de toute façon un code non alphabétique.
     */
    pays: schemaCodePays.optional(),
    iban: z.string().trim().min(1).max(LONGUEUR_MAX_SAISIE_IBAN).nullish(),
    qrIban: z.string().trim().min(1).max(LONGUEUR_MAX_SAISIE_IBAN).nullish(),
  })
  .strict();
export type EntreeModificationBlocCreancier = z.infer<typeof schemaModificationBlocCreancier>;
