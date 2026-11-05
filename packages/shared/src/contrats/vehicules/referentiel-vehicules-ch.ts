import { z } from 'zod';

/**
 * Référentiel véhicules suisse (ASTRA/TAS, migration 0050 `type_approbation_ch`) — autocomplétion
 * marque → modèle pour la saisie fiche véhicule (mode 2 de la migration : cascade quand le permis
 * de circulation n'est pas sous les yeux).
 *
 * `GET /referentiels/vehicules/marques` et `GET /referentiels/vehicules/modeles` : ce sont des
 * PROJECTIONS d'autocomplétion, comme `GET /recherche` (`contrats/atelier/recherche.ts`) — pas des
 * collections. Pas de pagination par curseur, une `limite` plafonnée suffit.
 *
 * Contrat gelé avec l'écran de saisie véhicule (lot React, même livraison) — un écart
 * nécessaire se remonte, il ne se code pas « en attendant ».
 */

export const LIMITE_DEFAUT_REFERENTIEL_VEHICULES_CH = 20;
export const LIMITE_MAX_REFERENTIEL_VEHICULES_CH = 50;

// -------------------------------------------------------------------------------------------
// GET /referentiels/vehicules/marques
// -------------------------------------------------------------------------------------------

/**
 * `recherche` facultatif : absent ou vide = les marques les plus fréquentes du référentiel
 * (classées par nombre de modèles), pas une erreur de validation ni la liste complète non triée.
 */
export const schemaRechercheMarquesVehiculesCh = z.object({
  recherche: z.string().trim().max(120).optional(),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_MAX_REFERENTIEL_VEHICULES_CH)
    .default(LIMITE_DEFAUT_REFERENTIEL_VEHICULES_CH),
});
export type ParametresRechercheMarquesVehiculesCh = z.infer<
  typeof schemaRechercheMarquesVehiculesCh
>;

/**
 * `aliasTrouve` — `null` quand `nom` a été trouvé directement (nom canonique ASTRA, ou
 * `normaliser_recherche` seul suffisait) ; sinon le terme d'alias (table
 * `type_approbation_ch_marque_alias`, migration 0051) qui a permis de trouver cette marque —
 * ex. `nom: 'VW'`, `aliasTrouve: 'Volkswagen'` pour une recherche « volkswagen ». Un utilisateur
 * qui tape le nom courant d'une marque et voit son sigle ASTRA apparaître doit comprendre
 * pourquoi ; ce champ est la réponse, pas une donnée décorative.
 */
export interface MarqueVehiculeCh {
  readonly nom: string;
  readonly nombreModeles: number;
  readonly aliasTrouve: string | null;
}

export interface ReponseMarquesVehiculesCh {
  readonly marques: readonly MarqueVehiculeCh[];
}

// -------------------------------------------------------------------------------------------
// GET /referentiels/vehicules/modeles
// -------------------------------------------------------------------------------------------

/**
 * `marque` obligatoire (mode 2 : la marque est déjà choisie à l'étape précédente de la cascade).
 * `recherche` facultatif, même doctrine que ci-dessus.
 */
export const schemaRechercheModelesVehiculesCh = z.object({
  marque: z.string().trim().min(1).max(120),
  recherche: z.string().trim().max(120).optional(),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_MAX_REFERENTIEL_VEHICULES_CH)
    .default(LIMITE_DEFAUT_REFERENTIEL_VEHICULES_CH),
});
export type ParametresRechercheModelesVehiculesCh = z.infer<
  typeof schemaRechercheModelesVehiculesCh
>;

/**
 * `codeTypeCh` : le code type ASTRA ne préremplit la fiche que quand ce nom de modèle correspond
 * à EXACTEMENT un code type dans le référentiel pour cette marque — sinon `null` (plusieurs
 * motorisations/variantes techniques partagent le même nom commercial, le serveur ne devine pas
 * laquelle choisir).
 */
export interface ModeleVehiculeCh {
  readonly nom: string;
  readonly codeTypeCh: string | null;
}

export interface ReponseModelesVehiculesCh {
  readonly modeles: readonly ModeleVehiculeCh[];
}
