/**
 * Jeton d'injection de la configuration.
 *
 * Le contrat gelé de l'étape 0 (§2.7) place `JETON_CONFIG` dans son propre fichier, pour qu'un
 * consommateur puisse injecter la config sans importer le schéma zod ni le chargeur — donc sans
 * tirer `charger-config.ts` (et ses dépendances) dans son graphe de modules.
 *
 * La définition réelle vit dans `charger-config.ts` avec le schéma dont elle est solidaire ;
 * ce fichier n'est qu'un point d'entrée stable conforme au contrat.
 */
export { JETON_CONFIG } from './charger-config';
