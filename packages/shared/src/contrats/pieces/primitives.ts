import { z } from 'zod';

/**
 * Primitives PROPRES au domaine pièces. Non réexportées par `pieces/index.ts` — même règle que
 * `facturation/primitives.ts` : les primitives génériques déjà publiques (`schemaCentimes`,
 * `schemaIdentifiant`, `schemaQuantiteMillieme`, `schemaMotif`, `schemaTexteCourt`,
 * `schemaDateJour`, `schemaHorodatage`, `schemaListeIdentifiants`, `schemaPourmille`) restent
 * celles de `contrats/atelier/primitives`, réutilisées sans être dupliquées ni réexportées deux
 * fois — un `export *` dupliquerait leur nom dans le barrel `@dfa/shared`.
 *
 * QUANTITÉS DE PIÈCES — décision explicite : ce domaine réutilise **`schemaQuantiteMillieme`**
 * (millièmes d'unité, déjà défini par l'étape 1 pour `ligne_or.quantiteMillieme`) pour TOUTE
 * quantité de pièce — stock physique, réservation, mouvement, ligne de commande fournisseur.
 * Aucune nouvelle unité n'est introduite : l'huile se compte en millièmes de litre, le câble en
 * millièmes de mètre, la pièce à l'unité en millièmes de pièce (`1000` = 1 unité) — c'est
 * exactement la même précision que celle déjà figée par `ligne_or`, à laquelle ce module
 * s'accroche (`RP-19`, §2). Introduire une deuxième unité entière pour le stock (ex. un
 * `quantiteDixieme` distinct) casserait la correspondance directe entre une ligne d'OR et sa
 * réservation, qui doit pouvoir se comparer champ à champ sans conversion.
 */

/** Prix d'achat ou de vente, CENTIMES entiers, positif ou nul. Jamais de flottant. */
export const schemaCentimesPositif = z.number().int().min(0);

/** Délai en jours entiers (délai fournisseur habituel, ancienneté d'une consigne non soldée). */
export const schemaDelaiJours = z.number().int().min(0).max(3650);

/** Emplacement de rangement, texte libre humain (`RP-11`) : « B3 », « étagère du fond ». */
export const schemaEmplacement = z.string().trim().max(60);

/** Référence article (OEM, équivalente, fournisseur, interne) : texte court, jamais vide. */
export const schemaReferenceArticle = z.string().trim().min(1).max(80);

/** Code-barres EAN ou interne, facultatif. */
export const schemaCodeBarres = z.string().trim().max(40);
