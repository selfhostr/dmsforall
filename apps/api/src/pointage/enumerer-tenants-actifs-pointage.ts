/**
 * Énumération des tenants actifs pour le job de clôture automatique de fin de journée du
 * pointage (RM-91/RM-119) — DÉCISION tranchée par ce chantier (les deux points laissés ouverts
 * par `service-cloture-automatique-pointage.ts`, § en-tête).
 *
 * DÉCISION : un client `pg` DÉDIÉ sur `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`), MÊME
 * PATRON DE CONNEXION que `vehicules/referentiel/etat-import-referentiel-vehicules-ch.ts`
 * (`avecClientMigration`, LU comme modèle, jamais importé ici — aucune dépendance de compilation
 * entre modules d'experts parallèles, même doctrine que `pointage.module.ts`, § en-tête) — jamais
 * une 7ᵉ fonction `amorcage.*` :
 *
 *   1. `db/db.types.ts`/`db/acces-amorcage.service.ts` sont HORS du périmètre d'écriture exclusif
 *      de ce lot (`pointage/`, `ordonnancement/`, contrats pointage, migration 0059) — y ajouter
 *      une opération cross-tenant serait une décision de sécurité touchant un fichier partagé par
 *      TOUT le dépôt, pas seulement `pointage/` ;
 *   2. la doctrine de `db.types.ts` (§ commentaire des 6 fonctions) est que cette surface reste
 *      « minuscule et figée » — un besoin de lecture cross-tenant qui a DÉJÀ un canal établi et
 *      audité (voir point 3) n'a aucune raison d'en ouvrir un second ;
 *   3. la table `tenant` porte DÉJÀ, depuis la migration 0001 (`0001_socle_rls.sql`, policy
 *      `tenant_migrator`), une politique RLS EXPLICITE et DÉLIBÉRÉE `to dfa_migrator using (true)
 *      with check (true)` — posée pour EXACTEMENT ce besoin (le commentaire de la migration cite
 *      littéralement « une future migration de reprise de données (backfill) » devant voir tous
 *      les tenants). Ce canal est déjà revu, déjà en production (utilisé par le seed de
 *      développement), déjà minimal : une seule table, un seul rôle, une politique déjà auditée.
 *      Router l'énumération par ce canal plutôt que d'en créer un nouveau ne modifie AUCUN fichier
 *      de la couche base commune.
 *
 * GARANTIE D'ISOLATION — ce fichier ne lit QUE `tenant.id`/`tenant.statut`, EN LECTURE SEULE,
 * jamais aucune table de pointage : les données sensibles (pointages) ne sont JAMAIS accédées par
 * ce canal migrateur, uniquement par `AccesBase.enTenant(ctx)` (RLS, `dfa_app`, une transaction
 * PAR TENANT) dans `ServiceClotureAutomatiquePointage.executerPourTenant` — voir `orchestration-
 * job-cloture-automatique-pointage.ts` pour la preuve que ces deux canaux ne se mélangent jamais
 * (la connexion migrateur est fermée avant que la première transaction `enTenant` ne s'ouvre).
 *
 * `statut = 'actif'` UNIQUEMENT : un tenant `suspendu` (accès bloqué par l'exploitant) ou `resilie`
 * (rétention légale) ne doit voir AUCUNE de ses données modifiées par un job système — même
 * doctrine fail-closed que `chargerCandidatsClotureAutomatique` (« sans config, rien ne se
 * planifie, jamais un défaut actif implicite »).
 */

import { asc, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { tenant } from '../db/schema';

export async function chargerTenantsActifsPointage(
  urlMigration: string,
): Promise<readonly string[]> {
  const client = new Client({
    connectionString: urlMigration,
    application_name: 'dfa-pointage-cloture-automatique-tenants',
  });
  await client.connect();
  try {
    const base: NodePgDatabase = drizzle(client);
    const lignes = await base
      .select({ id: tenant.id })
      .from(tenant)
      .where(eq(tenant.statut, 'actif'))
      // Tri déterministe — un ordre stable facilite la lecture des logs d'un passage à l'autre,
      // sans aucune conséquence fonctionnelle (chaque tenant est traité dans sa PROPRE
      // transaction, jamais deux à la fois — voir `orchestration-job-cloture-automatique-
      // pointage.ts`).
      .orderBy(asc(tenant.id));
    return lignes.map((l) => l.id);
  } finally {
    await client.end();
  }
}
