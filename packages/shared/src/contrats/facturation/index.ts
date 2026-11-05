/**
 * Contrats de l'étape 2 — Facturation (chaîne devis → bon de commande → facture → avoir,
 * paiements, export fiduciaire).
 *
 * Point d'entrée unique du domaine, même règle que `contrats/atelier` : tout ce qui est exporté
 * ici est GELÉ au nom près et à la signature près une fois validé. Un écart nécessaire se remonte
 * à le mainteneur, il ne se code pas « en attendant ».
 *
 * Règle de compatibilité opposable à toute revue future, reprise à l'identique de
 * `contrats/atelier/index.ts` : un client de cette API doit ignorer les champs qu'il ne connaît
 * pas et ne doit jamais échouer sur une valeur d'enum inconnue.
 *
 * `primitives.ts` n'est PAS réexporté ici : ses symboles sont internes au domaine facturation, et
 * les primitives génériques déjà publiques (`schemaCentimes`, `schemaIdentifiant`…) restent
 * celles de `contrats/atelier/primitives`, réutilisées sans être dupliquées.
 */

export * from './enums';
export * from './ligne';
export * from './document';
export * from './paiement';
export * from './export';
export * from './facturer-or';
export * from './creancier';
export * from './imputation-devise-incoherente';
