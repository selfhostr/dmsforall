import { z } from 'zod';

/**
 * Primitives de validation partagées par tous les schémas d'entrée de l'étape 1.
 *
 * Leur raison d'être est le §1.3 du contrat d'API : **le suffixe d'unité dans le nom du champ est
 * la meilleure défense connue contre un flottant qui s'infiltre trois ans plus tard dans un
 * connecteur tiers.** Ces schémas rendent la règle mécanique — `schemaCentimes` refuse un
 * décimal, donc un `prixUnitaireCentimes: 12.5` est rejeté à la porte plutôt que silencieusement
 * arrondi quelque part.
 *
 * **Il n'existe AUCUN champ `float` dans cette API**, et c'est une clause de compatibilité : en
 * introduire un serait une rupture, pas un ajout.
 */

/** uuid. Tous les identifiants de l'API. */
export const schemaIdentifiant = z.string().uuid();

/** Date métier seule, `aaaa-mm-jj` (suffixe de champ `…Le`). */
export const schemaDateJour = z.string().date();

/** Horodatage ISO 8601 **UTC** (suffixe de champ `…Le`). Le formatage suisse est une affaire de
 *  présentation et n'apparaît nulle part dans les charges utiles. */
export const schemaHorodatage = z.string().datetime();

/**
 * Argent, en CENTIMES entiers (suffixe `…Centimes`). Signé : une ligne de type `remise` porte un
 * montant négatif. JAMAIS un flottant — CONTRIBUTING.md, règle non négociable.
 */
export const schemaCentimes = z.number().int();

/** Argent positif ou nul : plafond, prix unitaire, seuil. */
export const schemaCentimesPositif = z.number().int().min(0);

/** Temps de travail en CENTIÈMES d'heure (suffixe `…Centiemes`). `120` = 1,2 h. */
export const schemaCentiemes = z.number().int().min(0);

/** Quantité en MILLIÈMES (suffixe `…Millieme`). `2500` = 2,5. */
export const schemaQuantiteMillieme = z.number().int().min(1);

/** Taux, rabais, TVA en POUR MILLE (suffixe `…Pourmille`). `81` = 8,1 %. */
export const schemaPourmille = z.number().int().min(0).max(1000);

/** Kilométrage : entier, dans l'unité déclarée par `unite`. La conversion mi -> km est faite par
 *  le SERVEUR (CT-08) — le client n'a aucune arithmétique d'unité à rejouer. */
export const schemaKilometrage = z.number().int().min(0).max(9_999_999);

/** Libellé court : désignation, nom, référence. */
export const schemaTexteCourt = z.string().trim().min(1).max(200);

/** Texte libre long : verbatim, retranscription, note. */
export const schemaTexteLong = z.string().trim().min(1).max(4000);

/**
 * Motif. Obligatoire sur toute action destructrice ou dérogatoire (annulation, réouverture,
 * refus de contrôle, régression de kilométrage) : un motif vide est un motif absent, donc la
 * borne basse n'est pas `1`.
 */
export const schemaMotif = z.string().trim().min(3).max(500);

/** Numéro IDE suisse, format `CHE-123.456.789`. */
export const schemaIde = z
  .string()
  .trim()
  .regex(/^CHE-\d{3}\.\d{3}\.\d{3}$/);

/** Adresse e-mail. */
export const schemaEmail = z.string().trim().toLowerCase().email().max(320);

/** Téléphone au format E.164 (le serveur normalise, le client peut envoyer la saisie brute). */
export const schemaTelephoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/);

/** Code pays ISO 3166-1 alpha-2, majuscules. */
export const schemaCodePays = z.string().length(2).toUpperCase();

/** Liste d'identifiants d'une action groupée. Non vide : une action groupée sans cible est une
 *  erreur de client, pas un no-op silencieux. Bornée pour éviter une transaction pathologique. */
export const schemaListeIdentifiants = z.array(schemaIdentifiant).min(1).max(200);
