/**
 * Contrats de l'étape 3 — Pièces (référentiel article, stock, mouvements, réservation, commande
 * fournisseur, consigne d'échange standard, vente comptoir).
 *
 * Point d'entrée unique du domaine, même règle que `contrats/atelier/index.ts` et
 * `contrats/facturation/index.ts` : tout ce qui est exporté ici est GELÉ au nom près et à la
 * signature près une fois validé par l'orchestrateur. Un écart nécessaire se remonte, il ne se
 * code pas « en attendant ».
 *
 * `primitives.ts` n'est PAS réexporté ici — même règle que `facturation/primitives.ts` : ses
 * symboles sont internes au domaine pièces, et les primitives génériques déjà publiques restent
 * celles de `contrats/atelier/primitives`.
 *
 * Règle de compatibilité opposable à toute revue future, reprise à l'identique des autres
 * domaines : un client de cette API doit ignorer les champs qu'il ne connaît pas et ne doit jamais
 * échouer sur une valeur d'enum inconnue.
 */

export * from './enums';
export * from './article';
export * from './stock';
export * from './mouvement';
export * from './stock-insuffisant';
export * from './reservation';
export * from './fournisseur';
export * from './commande-fournisseur';
export * from './consigne';
export * from './parametrage';
export * from './facture-fournisseur';
