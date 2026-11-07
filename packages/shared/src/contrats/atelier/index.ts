/**
 * Contrats de l'étape 1 — Atelier + Clients.
 *
 * Point d'entrée unique du domaine. Tout ce qui est exporté ici est **gelé au nom près et à la
 * signature près** pour le lot 1 : un expert qui a besoin d'un écart le remonte à
 * le mainteneur, il ne l'implémente pas « en attendant ».
 *
 * Règle de compatibilité opposable à toute revue future (§11.1) :
 * > Un client de cette API **doit ignorer les champs qu'il ne connaît pas** et **ne doit pas
 * > échouer sur une valeur d'enum inconnue**. Sous cette condition, l'ajout d'un champ, d'un
 * > endpoint, d'un avertissement ou d'un événement n'est jamais une rupture.
 *
 * Interdits sans exception (§11.4) : renommer ou retirer un champ, retirer un endpoint,
 * restreindre une validation, resserrer une borne de pagination, réduire la rétention
 * d'idempotence, ajouter une valeur à un enum gelé, rendre obligatoire un champ de requête
 * jusque-là facultatif.
 */

export * from './enums';
export * from './primitives';
export * from './avertissement';
export * from './client';
export * from './vehicule';
export * from './ligne';
export * from './ordre-reparation';
export * from './devis';
export * from './parametrage';
export * from './recherche';
export * from './evenement';
export * from './photo-ligne';
