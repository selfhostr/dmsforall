/**
 * Surface publique de la couche base de données.
 *
 * Les autres modules importent depuis `../db` et rien d'autre : ni `./db/schema/session`
 * directement, ni `./db/acces-amorcage.service`. Ce qui n'apparaît pas ici n'est pas destiné à
 * être utilisé au dehors — en particulier les implémentations concrètes, qui se résolvent par
 * jeton (`JETON_DB`, `JETON_DB_AMORCAGE`) et jamais par leur classe.
 */

export { JETON_DB, JETON_DB_AMORCAGE } from './db.jetons';

export type {
  AccesAmorcage,
  AccesBase,
  BaseDfa,
  ConfigBase,
  ContexteTenant,
  EvenementSecuriteEntree,
  SessionAmorcage,
  TransactionDfa,
  UtilisateurAmorcage,
} from './db.types';

export { DbModule } from './db.module';
export { DbAmorcageModule } from './db-amorcage.module';

export { ErreurPostureRls } from './acces-base.service';

// Le schéma est exporté pour les requêtes métier (`tx.select().from(site)`) et pour les
// fixtures des tests d'intégration.
export * as schema from './schema';
export {
  journalSecurite,
  langueEnum,
  roleUtilisateurEnum,
  session,
  site,
  statutTenantEnum,
  statutUtilisateurEnum,
  tenant,
  typeEvenementSecuriteEnum,
  utilisateur,
} from './schema';

export type {
  LigneJournalSecurite,
  LigneSession,
  LigneSite,
  LigneTenant,
  LigneUtilisateur,
  NouveauSite,
  NouveauTenant,
  NouvelEvenementSecurite,
  NouvelUtilisateur,
  NouvelleSession,
} from './schema';
