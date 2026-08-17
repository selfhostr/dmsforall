/**
 * `POST /scan/permis-circulation` — reconnaissance automatique du permis de circulation suisse
 * (« carte grise »), OCR serveur (apps/api/src/vehicules/ocr/).
 *
 * CONTRAT CONVERGÉ avec l'écran mobile de scan (agent React, même livraison, périmètre
 * `apps/web/src/ecrans/scan/`) — forme et noms alignés sur son contrat temporaire
 * (`apps/web/src/ecrans/scan/contrat-ocr.temporaire.ts`, à supprimer une fois ce fichier généré
 * côté front via `pnpm api:openapi && pnpm web:types`). Arbitrage de l'orchestrateur : ce fichier
 * fait foi, `contrat-ocr.temporaire.ts` doit converger vers lui, pas l'inverse.
 *
 * DÉCISIONS DE @laupernoe, STRUCTURANTES POUR CE CONTRAT :
 *   1. Aucune création automatique — cet endpoint ne crée NI véhicule NI client. Il rend une
 *      DONNÉE EXTRAITE et des CORRESPONDANCES TROUVÉES ; la création reste `POST /vehicules` /
 *      `POST /clients`, inchangés.
 *   2. La photo n'est jamais conservée (ni disque, ni base) — ce contrat ne porte donc aucun
 *      identifiant de fichier, aucune URL d'image : la réponse est auto-suffisante.
 *   3. Absence de donnée ≠ valeur : `NiveauConfianceOcr` a TROIS états distincts
 *      (`sure`/`douteuse`/`absente`), jamais confondus. `valeur: null` UNIQUEMENT si
 *      `confiance: 'absente'` — un champ `sure`/`douteuse` porte toujours une valeur.
 *      « Lu et validé » (le troisième état demandé par le brief serveur) est une notion CÔTÉ
 *      ÉCRAN une fois l'utilisateur passé dessus — le serveur ne connaît que « sûr » (confirmé
 *      structurellement : référentiel ASTRA pour marque/modèle, clé de contrôle ISO 3779 pour le
 *      VIN, format attendu pour plaque/canton/date) et « douteux » (lu, non confirmé).
 *   4. Correspondances EXACTES uniquement (VIN/plaque pour le véhicule, nom+NPA pour le client) —
 *      jamais un rapprochement flou. `undefined` = rien trouvé, jamais deviné.
 *
 * Requête : `multipart/form-data`, un seul champ fichier `photo` (jpeg/png/webp/heic/heif côté
 * serveur — le front réencode déjà en JPEG avant envoi, `ecrans/scan/reduireImage.ts`, mais
 * l'endpoint reste défensif pour tout autre appelant). Pas de schéma zod de corps ici : l'upload
 * binaire n'est pas un objet JSON zod-validable comme le reste de l'API.
 */

// -------------------------------------------------------------------------------------------
// Contraintes de requête
// -------------------------------------------------------------------------------------------

/** 12 Mo — au-delà, une photo de comptoir est de toute façon inexploitable telle quelle. */
export const LIMITE_TAILLE_IMAGE_PERMIS_OCTETS = 12 * 1024 * 1024;

export const TYPES_MIME_IMAGE_PERMIS_ACCEPTES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export type TypeMimeImagePermisAccepte = (typeof TYPES_MIME_IMAGE_PERMIS_ACCEPTES)[number];

// -------------------------------------------------------------------------------------------
// Champ lu : trois états, jamais confondus (§3 ci-dessus)
// -------------------------------------------------------------------------------------------

export const NIVEAUX_CONFIANCE_OCR = ['sure', 'douteuse', 'absente'] as const;
export type NiveauConfianceOcr = (typeof NIVEAUX_CONFIANCE_OCR)[number];

/** `valeur: null` SEULEMENT si `confiance: 'absente'`. */
export interface ChampScanne<T> {
  readonly valeur: T | null;
  readonly confiance: NiveauConfianceOcr;
}

// -------------------------------------------------------------------------------------------
// Données extraites
// -------------------------------------------------------------------------------------------

/**
 * `marque`/`modele` ne viennent JAMAIS d'une lecture libre du texte imprimé : ils sont dérivés du
 * code type ASTRA (`chTypeApprovalNumber`) lu sur le document puis recoupé contre
 * `type_approbation_ch` — c'est le levier de conception du brief (« le code type donne à lui
 * seul la marque, le modèle, le carburant, la catégorie, les poids… bien plus sûr qu'un texte
 * reconnu »). `confiance: 'sure'` UNIQUEMENT quand ce recoupement a abouti ; sinon `'absente'`
 * (jamais une valeur OCRisée non recoupée, qui laisserait croire à une lecture directe fiable).
 */
export interface VehiculeScanne {
  readonly marque: ChampScanne<string>;
  readonly modele: ChampScanne<string>;
  /** `sure` seulement si la clé de contrôle ISO 3779 (9ᵉ caractère) concorde. */
  readonly vin: ChampScanne<string>;
  readonly plaque: ChampScanne<string>;
  readonly canton: ChampScanne<string>;
  /** ISO `aaaa-mm-jj`. */
  readonly premiereMiseEnCirculationLe: ChampScanne<string>;
}

/**
 * `estEntreprise` : heuristique par mots-clés de raison sociale (SA/Sàrl/AG/GmbH…) sur le bloc
 * détenteur — jamais `sure` (aucune confirmation structurelle possible), au mieux `douteuse`.
 * `nom`/`prenom` : séparation heuristique du premier groupe de mots (convention d'impression
 * suisse « Nom Prénom(s) »), NON VALIDÉE sur un échantillon réel à raison sociale (voir le
 * rapport de livraison) — toujours `douteuse`, jamais `sure`, l'utilisateur corrige avant
 * soumission.
 */
export interface DetenteurScanne {
  readonly estEntreprise: ChampScanne<boolean>;
  readonly nom: ChampScanne<string>;
  readonly prenom: ChampScanne<string>;
  readonly raisonSociale: ChampScanne<string>;
  readonly rue: ChampScanne<string>;
  readonly npa: ChampScanne<string>;
  readonly localite: ChampScanne<string>;
}

export interface DonneesPermisScanne {
  readonly vehicule: VehiculeScanne;
  readonly detenteur: DetenteurScanne;
}

// -------------------------------------------------------------------------------------------
// Correspondances trouvées — EXACTES uniquement (§4 ci-dessus)
// -------------------------------------------------------------------------------------------

export interface CorrespondanceClientExistant {
  readonly id: string;
  readonly nomAffiche: string;
}

export interface CorrespondanceVehiculeExistant {
  readonly id: string;
  readonly libelle: string;
}

/**
 * `client` : VIN puis plaque active (clés quasi uniques) contre les véhicules du tenant.
 * `vehicule` : nom complet + NPA STRICTEMENT identiques (après normalisation) contre les clients
 * du tenant — réutilise `detecterDoublons` (`clients/detection-doublons.ts`), déjà à cette
 * doctrine conservatrice. AUCUN rapprochement par IDE côté véhicule : le permis de circulation
 * suisse ne porte pas ce numéro (document d'immatriculation, pas un document d'entreprise) —
 * signalé pour arbitrage si un autre document source venait un jour l'apporter.
 */
export interface CorrespondancesScan {
  readonly client?: CorrespondanceClientExistant;
  readonly vehicule?: CorrespondanceVehiculeExistant;
}

export interface ReponseScanPermisCirculation {
  readonly donnees: DonneesPermisScanne;
  readonly correspondances: CorrespondancesScan;
}
