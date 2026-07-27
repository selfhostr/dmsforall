/**
 * Schéma complet du socle (étape 0).
 *
 * Ce module est la source de vérité TypeScript du schéma : c'est lui que Drizzle reçoit pour
 * typer `BaseDfa`, et lui que `drizzle-kit` lit pour comparer le modèle au SQL réellement
 * appliqué. Les migrations de `migrations/*.sql` restent écrites à la main et font foi côté
 * base — `drizzle-kit generate` sert de contrôle de dérive, pas de générateur de vérité.
 *
 * Toute table ajoutée ici DOIT être exportée depuis ce fichier, sinon elle n'existe pas pour
 * le typage des transactions.
 */

export * from './enums';
export * from './colonnes-communes';
export * from './tenant';
export * from './site';
export * from './utilisateur';
export * from './session';
export * from './journal-securite';
