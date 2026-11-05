/**
 * Énumération des tenants actifs pour le job périodique de relances de facturation (rappel #2) —
 * MÊME PATRON, MÊME DÉCISION que `pointage/enumerer-tenants-actifs-pointage.ts` (LU comme modèle,
 * jamais importé ici — aucune dépendance de compilation entre modules d'experts parallèles, même
 * doctrine que `pointage.module.ts`, § en-tête) :
 *
 * DÉCISION : un client `pg` DÉDIÉ sur `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`), jamais une
 * 7ᵉ fonction `amorcage.*` — la table `tenant` porte, depuis la migration 0001
 * (`0001_socle_rls.sql`, policy `tenant_migrator`), une politique RLS EXPLICITE et DÉLIBÉRÉE
 * `to dfa_migrator using (true) with check (true)`, posée pour EXACTEMENT ce besoin (énumération
 * cross-tenant en lecture seule). Ce canal est déjà revu, déjà en production, déjà minimal — le
 * router ici ne modifie AUCUN fichier de la couche base commune.
 *
 * GARANTIE D'ISOLATION — ce fichier ne lit QUE `tenant.id`/`tenant.statut`, EN LECTURE SEULE,
 * jamais aucune table de facturation : les données sensibles (factures, clients) ne sont JAMAIS
 * accédées par ce canal migrateur, uniquement par `AccesBase.enTenant(ctx)` (RLS, `dfa_app`, une
 * transaction PAR TENANT) dans `ServiceRelancesFacture.planifier`/`.envoyerPretes` — voir
 * `orchestration-job-relances.ts` pour la preuve que ces deux canaux ne se mélangent jamais (la
 * connexion migrateur est fermée avant que la première transaction `enTenant` ne s'ouvre).
 *
 * `statut = 'actif'` UNIQUEMENT : un tenant `suspendu` (accès bloqué par l'exploitant) ou `resilie`
 * (rétention légale) ne doit voir AUCUNE de ses données modifiées par un job système — même
 * doctrine fail-closed que `planifier()` (§ « sans config, ou désactivée, … rien ne se
 * planifie »).
 */

import { asc, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { tenant } from '../db/schema';

export async function chargerTenantsActifsRelances(
  urlMigration: string,
): Promise<readonly string[]> {
  const client = new Client({
    connectionString: urlMigration,
    application_name: 'dfa-relances-facture-tenants',
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
      // transaction, jamais deux à la fois — voir `orchestration-job-relances.ts`).
      .orderBy(asc(tenant.id));
    return lignes.map((l) => l.id);
  } finally {
    await client.end();
  }
}
