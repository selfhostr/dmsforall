/**
 * Type de la configuration validée (contrat gelé §2.7).
 *
 * `Config` est dérivé du schéma zod : il n'est jamais écrit à la main, sinon le type et la
 * validation divergeraient silencieusement à la première variable ajoutée.
 */
export type { Config, ProblemeConfig } from './charger-config';
