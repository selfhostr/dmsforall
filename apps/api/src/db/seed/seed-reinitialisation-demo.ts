/**
 * Remise à zéro du SEUL tenant de démonstration (`garage-martin`), avant de le recréer.
 *
 * Pourquoi : le seed « complet » crée des centaines de lignes (OR, factures, paiements,
 * pointages…) liées entre elles. Les rejouer par clé métier ligne à ligne serait fragile ; on
 * supprime donc tout ce qui dépend du tenant de démo, puis on recrée. Un second lancement
 * produit exactement le même jeu, sans doublon.
 *
 * Garde-fous :
 *   - ne touche QUE les lignes dont `tenant_id` = celui du slug de démo : les autres garages de
 *     l'instance (par exemple `patron@garage-local.ch`) ne sont jamais lus ni modifiés ;
 *   - la ligne `tenant` elle-même est conservée (le seed l'upserte) ;
 *   - refuse de tourner en production ;
 *   - une seule transaction : en cas d'échec, rien n'est supprimé.
 *
 * Les triggers utilisateur (verrouillage des documents émis, interdiction de supprimer une
 * ligne d'OR, audit…) protègent le fonctionnement normal de l'application ; ici ils sont
 * suspendus le temps de la transaction, uniquement sur les tables du schéma public, avec le rôle
 * propriétaire du schéma.
 */
import { Client } from 'pg';

export async function reinitialiserTenantDemo(options: {
  readonly urlMigration: string;
  readonly nodeEnv: string;
  readonly slug: string;
  readonly journaliser: (message: string) => void;
}): Promise<void> {
  if (options.nodeEnv === 'production') {
    throw new Error('La réinitialisation du tenant de démonstration est interdite en production.');
  }
  const client = new Client({
    connectionString: options.urlMigration,
    application_name: 'dfa-seed-reset',
  });
  await client.connect();
  try {
    await client.query('begin');
    const t = await client.query<{ id: string }>('select id from public.tenant where slug = $1', [
      options.slug,
    ]);
    const tenantId = t.rows[0]?.id;
    if (tenantId === undefined) {
      await client.query('commit');
      options.journaliser(`Tenant « ${options.slug} » absent : rien à réinitialiser.`);
      return;
    }

    const tables = (
      await client.query<{ table_name: string }>(
        `select c.table_name
           from information_schema.columns c
           join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'tenant_id'
            and t.table_type = 'BASE TABLE'
            and c.table_name <> 'tenant'
            and c.table_name !~ '^audit_atelier_'
          order by c.table_name`,
      )
    ).rows.map((r) => r.table_name);

    for (const nom of tables) {
      await client.query(`alter table public."${nom}" disable trigger user`);
    }

    let restantes = [...tables];
    let total = 0;
    while (restantes.length > 0) {
      const echouees: string[] = [];
      for (const nom of restantes) {
        await client.query('savepoint s');
        try {
          const r = await client.query(`delete from public."${nom}" where tenant_id = $1`, [
            tenantId,
          ]);
          total += r.rowCount ?? 0;
          await client.query('release savepoint s');
        } catch (erreur) {
          await client.query('rollback to savepoint s');
          const code = (erreur as { code?: string }).code;
          if (code !== '23503') throw erreur;
          echouees.push(nom);
        }
      }
      if (echouees.length === restantes.length) {
        // Cycle de clés étrangères (ex. véhicule <-> véhicule en stock, document <-> export) :
        // on met à NULL les colonnes nullables qui pointent vers une table encore à vider.
        const liens = await client.query<{ table_name: string; colonne: string }>(
          `select c.conrelid::regclass::text as table_name, a.attname as colonne
             from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
            where c.contype = 'f' and not a.attnotnull and a.attname <> 'tenant_id'
              and not exists (select 1 from pg_constraint k
                               where k.conrelid = c.conrelid and k.contype = 'c' and a.attnum = any (k.conkey))
              and c.conrelid::regclass::text = any ($1::text[])
              and c.confrelid::regclass::text = any ($1::text[])`,
          [echouees],
        );
        if (liens.rows.length === 0) {
          throw new Error(
            `Suppression bloquée par des clés étrangères sur : ${echouees.join(', ')}`,
          );
        }
        for (const l of liens.rows) {
          await client.query(
            `update ${l.table_name} set "${l.colonne}" = null where tenant_id = $1`,
            [tenantId],
          );
        }
      }
      restantes = echouees;
    }

    for (const nom of tables) {
      await client.query(`alter table public."${nom}" enable trigger user`);
    }
    await client.query('commit');
    options.journaliser(
      `Tenant « ${options.slug} » vidé (${String(total)} ligne(s) supprimée(s)).`,
    );
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  } finally {
    await client.end();
  }
}
