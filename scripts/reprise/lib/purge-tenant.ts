/**
 * Purge FK-safe d'un tenant de TEST — hors périmètre de la résiliation applicative (`exploitation/
 * cycle-vie-tenant/`, qui ne fait jamais de suppression physique : `tenant.statut = 'resilie'`,
 * données intactes, cf. commentaire de `site_tenant_fk` dans `0000_socle.sql` : « supprimer un
 * tenant qui a encore des sites doit échouer bruyamment »). Ce module est le complément explicite
 * pour l'AUTRE cas d'usage, celui de ce harnais : un tenant de test qu'on veut vraiment faire
 * disparaître, pas suspendre.
 *
 * MÉCANISME — introspection `pg_constraint`, jamais une liste de tables recopiée à la main. Le
 * schéma compte déjà 79+ tables `tenant_id` (`registre-tables-tenant.ts`) et continue de croître
 * (migrations 0000→0068+ au 26.08.2026) : une liste figée dans CE script périmerait à la première
 * migration qui ajoute une table, en silence — exactement le type de défaut que ce dépôt a déjà
 * payé une fois (cf. `verifier-droits-sql.ts`, tête de fichier). À la place : lire les FK RÉELLES
 * de la base migrée au moment de l'exécution, construire le graphe de dépendance, trier
 * topologiquement (enfant avant parent), DELETE table par table. S'adapte automatiquement à toute
 * nouvelle table `tenant_id`, sans y toucher.
 *
 * CYCLES — mesurés réels, pas seulement des auto-références. Exemple trouvé en exécution sur CE
 * schéma (26.08.2026) : `dossier_vente.vehicule_stock_id -> vehicule_stock` (le véhicule vendu) ET
 * `vehicule_stock.origine_reprise_dossier_vente_id -> dossier_vente` (le dossier qui a généré ce
 * véhicule de stock EN REPRISE) — un cycle à deux tables bien réel, pas un artefact d'auto-
 * référence. Un simple tri topologique ne le résout jamais (par construction : aucun ordre linéaire
 * ne satisfait les deux arcs à la fois). Traitement générique, pas un correctif ad hoc pour CE
 * cycle précis : quand le tri topologique reste incomplet, les arcs NULLABLES entièrement internes
 * au reliquat non ordonné sont neutralisés (`UPDATE ... SET colonne = null where tenant_id = $1`)
 * puis le tri est retenté — répété jusqu'à résolution complète ou jusqu'à ce qu'un passage complet
 * ne neutralise plus aucun arc (cycle fait uniquement de colonnes `NOT NULL`, cas qui n'existe pas
 * aujourd'hui mais lèverait alors une erreur explicite plutôt que de boucler). La nullabilité est
 * lue en base (`pg_attribute.attnotnull`), jamais supposée.
 *
 * GARDE-FOU NON NÉGOCIABLE : n'opère JAMAIS que sur un tenant dont le `slug` correspond au préfixe
 * de test (`PREFIXE_SLUG_TEST`). Vérifié ICI, pas seulement à l'appelant — un script de nettoyage
 * qui ne vérifie qu'en surface est le genre d'outil qu'on finit par lancer une fois sur le mauvais
 * environnement.
 */
import type { Client } from 'pg';

export const PREFIXE_SLUG_TEST = 'reprise-test-';

export function estSlugDeTest(slug: string): boolean {
  return slug.startsWith(PREFIXE_SLUG_TEST);
}

function exigerSlugDeTest(slug: string): void {
  if (!estSlugDeTest(slug)) {
    throw new Error(
      `Refus de purger le tenant « ${slug} » : ne commence pas par « ${PREFIXE_SLUG_TEST} ». ` +
        `Ce garde-fou est volontairement non contournable — un tenant réel ne doit jamais pouvoir ` +
        `être atteint par ce chemin.`,
    );
  }
}

interface ArcFk {
  readonly tableEnfant: string;
  readonly tableParent: string;
  /** Colonnes de la FK CÔTÉ ENFANT, `tenant_id` exclu. */
  readonly colonnesEnfant: readonly string[];
  /** `true` seulement si TOUTES les colonnes enfant de cette FK, `tenant_id` EXCLU, sont
   *  nullables — une FK composite avec ne serait-ce qu'une colonne sémantique `NOT NULL` ne peut
   *  pas être neutralisée par `UPDATE ... SET colonne = null` sans violer la contrainte.
   *  `tenant_id` est délibérément écarté du test : le patron de FK composite de ce schéma
   *  (`(tenant_id, x) -> parent(tenant_id, id)`, cf. commentaire de `site_tenant_id_uk` dans
   *  `0000_socle.sql`) porte `tenant_id` NOT NULL sur QUASIMENT toutes les FK — le compter
   *  classerait à tort la quasi-totalité des arcs comme non nullables. Mesuré en exécution : sans
   *  cette exclusion, `vehicule_stock.origine_reprise_dossier_vente_id` (nullable en réalité,
   *  `information_schema.columns.is_nullable = 'YES'`) ressortait « non nullable » à cause de la
   *  seule colonne `tenant_id` de la même contrainte composite. */
  readonly nullable: boolean;
}

/**
 * Toutes les FK `public -> public` de la base migrée, colonnes enfant + nullabilité incluses (pour
 * neutraliser auto-références ET cycles multi-tables avant DELETE — voir tête de fichier).
 *
 * CAST `::text` NON DÉCORATIF sur `a.attname` (bug réel rencontré en écrivant ce fichier) :
 * `pg_attribute.attname` est de type `name`, dont le type tableau (`name[]`) n'a pas de parseur
 * enregistré côté client `pg` (contrairement à `text[]`) — sans ce cast, chaque ligne revenait
 * comme la CHAÎNE LITTÉRALE Postgres de l'array (`"{colonne}"`) plutôt qu'un tableau JS, et le
 * `for...of` qui consomme `colonnesEnfant` plus bas itérait alors ses CARACTÈRES un par un —
 * l'UPDATE de neutralisation exécutait littéralement `set { = null ...`, échec avec une erreur de
 * syntaxe SQL sans rapport apparent avec la cause réelle.
 */
async function listerArcsFk(client: Client): Promise<ArcFk[]> {
  const { rows } = await client.query<{
    table_enfant: string;
    table_parent: string;
    colonnes_enfant: string[];
    nullable: boolean;
  }>(`
    select
      con.conrelid::regclass::text  as table_enfant,
      con.confrelid::regclass::text as table_parent,
      array(
        select a.attname::text
        from unnest(con.conkey) as k(attnum)
        join pg_attribute a on a.attnum = k.attnum and a.attrelid = con.conrelid
        where a.attname <> 'tenant_id'
      ) as colonnes_enfant,
      not exists (
        select 1
        from unnest(con.conkey) as k(attnum)
        join pg_attribute a on a.attnum = k.attnum and a.attrelid = con.conrelid
        where a.attnotnull and a.attname <> 'tenant_id'
      ) as nullable
    from pg_constraint con
    where con.contype = 'f'
      and con.connamespace = 'public'::regnamespace
      and con.conrelid::regclass::text !~ '\\.'   -- exclut les tables d'un autre schéma éventuel
  `);
  return rows
    .map((r) => ({
      tableEnfant: r.table_enfant,
      tableParent: r.table_parent,
      colonnesEnfant: r.colonnes_enfant,
      nullable: r.nullable,
    }))
    .filter((a) => a.colonnesEnfant.length > 0); // une FK purement (tenant_id) seul n'existe pas ici, garde défensive
}

/** Tables `public` qui portent une colonne `tenant_id` — périmètre de la purge. Exportée : sert
 *  aussi de base à l'instantané d'étanchéité (`verification-sql.ts::instantaneComptagesTenant`). */
export async function listerTablesTenant(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ table_name: string }>(`
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
  `);
  return new Set(rows.map((r) => r.table_name));
}

interface TentativeTri {
  readonly ordre: readonly string[];
  readonly restantes: readonly string[];
}

/** Tri topologique (Kahn) sur le graphe « enfant -> parent » restreint aux tables `tenant_id` et
 *  aux arcs fournis (auto-références déjà écartées par l'appelant). Rend l'ordre obtenu ET les
 *  tables restées bloquées (cycle) — ne lève jamais, laisse l'appelant décider quoi en faire. */
function tenterTriTopologique(
  tables: ReadonlySet<string>,
  arcsPertinents: readonly ArcFk[],
): TentativeTri {
  const degreEntrant = new Map<string, number>();
  const successeurs = new Map<string, string[]>();
  for (const t of tables) degreEntrant.set(t, 0);
  for (const arc of arcsPertinents) {
    degreEntrant.set(arc.tableParent, (degreEntrant.get(arc.tableParent) ?? 0) + 1);
    const liste = successeurs.get(arc.tableEnfant) ?? [];
    liste.push(arc.tableParent);
    successeurs.set(arc.tableEnfant, liste);
  }

  // File FIFO triée par nom pour un ordre reproductible (diagnostiquable) entre deux exécutions.
  const file = [...tables].filter((t) => (degreEntrant.get(t) ?? 0) === 0).sort();
  const resultat: string[] = [];
  while (file.length > 0) {
    const t = file.shift()!;
    resultat.push(t);
    for (const suivant of successeurs.get(t) ?? []) {
      const d = (degreEntrant.get(suivant) ?? 0) - 1;
      degreEntrant.set(suivant, d);
      if (d === 0) {
        file.push(suivant);
        file.sort();
      }
    }
  }

  const ensembleResolu = new Set(resultat);
  const restantes = [...tables].filter((t) => !ensembleResolu.has(t)).sort();
  return { ordre: resultat, restantes };
}

const MAX_PASSAGES_CASSAGE_CYCLE = 20; // largement au-dessus de tout cas réel observé (1 à ce jour)
const MAX_PASSAGES_PURGE = 10; // idem pour le point fixe de suppression (2 passages suffisent dans tous les cas mesurés)

/**
 * Calcule l'ordre de suppression ET la liste des arcs à neutraliser au préalable (auto-références
 * + cycles multi-tables, voir tête de fichier). Boucle jusqu'à résolution complète : à chaque
 * passage incomplet, neutralise tout arc NULLABLE entièrement interne au reliquat non ordonné, puis
 * retente. Lève seulement si un passage entier ne neutralise plus aucun arc (cycle fait uniquement
 * de colonnes `NOT NULL` — n'existe pas aujourd'hui, mais ne doit jamais boucler en silence).
 */
function calculerPlanSuppression(
  tables: ReadonlySet<string>,
  arcsInitiaux: readonly ArcFk[],
): { ordre: readonly string[]; arcsANeutraliser: readonly ArcFk[] } {
  const autoReferences = arcsInitiaux.filter(
    (a) => a.tableEnfant === a.tableParent && tables.has(a.tableEnfant),
  );
  let arcsRestants = arcsInitiaux.filter(
    (a) =>
      a.tableEnfant !== a.tableParent && tables.has(a.tableEnfant) && tables.has(a.tableParent),
  );
  const arcsANeutraliser: ArcFk[] = [...autoReferences];

  for (let passage = 0; passage < MAX_PASSAGES_CASSAGE_CYCLE; passage += 1) {
    const tentative = tenterTriTopologique(tables, arcsRestants);
    if (tentative.restantes.length === 0) return { ordre: tentative.ordre, arcsANeutraliser };

    const ensembleRestant = new Set(tentative.restantes);
    const arcsInternesNullables = arcsRestants.filter(
      (a) => a.nullable && ensembleRestant.has(a.tableEnfant) && ensembleRestant.has(a.tableParent),
    );
    if (arcsInternesNullables.length === 0) {
      throw new Error(
        `Purge tenant : cycle de FK non cassable détecté (colonnes toutes NOT NULL) entre ` +
          `${tentative.restantes.join(', ')} — à traiter à la main (rendre une des colonnes ` +
          `impliquées nullable, ou étendre ce script) avant de relancer la purge.`,
      );
    }
    arcsANeutraliser.push(...arcsInternesNullables);
    const neutralises = new Set(arcsInternesNullables);
    arcsRestants = arcsRestants.filter((a) => !neutralises.has(a));
  }

  throw new Error(
    `Purge tenant : cassage de cycle non stabilisé après ${String(MAX_PASSAGES_CASSAGE_CYCLE)} ` +
      `passages — vraisemblablement un défaut de ce script, pas seulement un cycle inhabituel.`,
  );
}

export interface ResultatPurgeTenant {
  readonly tenantId: string;
  readonly slug: string;
  readonly tablesPurgees: readonly { readonly table: string; readonly lignes: number }[];
}

/**
 * Purge intégrale d'un tenant de test : toutes les lignes `tenant_id = $1` sur toutes les tables
 * qui en portent une, puis la ligne `tenant` elle-même. UNE SEULE transaction — un échec à mi-
 * parcours ne doit jamais laisser un tenant à moitié purgé (même préoccupation que le seed).
 *
 * Rend la liste des tables réellement touchées (nombre de lignes) — utile pour un rapport de
 * campagne (« que reste-t-il derrière nous »).
 */
export async function purgerTenantDeTest(
  client: Client,
  slug: string,
): Promise<ResultatPurgeTenant | null> {
  exigerSlugDeTest(slug);

  const { rows: lignesTenant } = await client.query<{ id: string }>(
    `select id from public.tenant where slug = $1`,
    [slug],
  );
  const tenantLigne = lignesTenant[0];
  if (!tenantLigne) return null; // déjà absent : purge idempotente, pas une erreur
  const tenantId = tenantLigne.id;

  const [tablesTenant, arcs] = await Promise.all([
    listerTablesTenant(client),
    listerArcsFk(client),
  ]);
  const { ordre, arcsANeutraliser } = calculerPlanSuppression(tablesTenant, arcs);

  const cumulParTable = new Map<string, number>();

  await client.query('begin');
  try {
    // Neutralise les auto-références et les cycles multi-tables (ex. dossier_vente <->
    // vehicule_stock) avant toute suppression, une fois pour toutes — voir tête de fichier.
    for (const arc of arcsANeutraliser) {
      for (const colonne of arc.colonnesEnfant) {
        await client.query(
          `update public.${arc.tableEnfant} set ${colonne} = null where tenant_id = $1 and ${colonne} is not null`,
          [tenantId],
        );
      }
    }

    // PASSAGES RÉPÉTÉS jusqu'à un point fixe (bug réel rencontré en écrivant ce harnais, sur un
    // tenant ayant réellement importé des données — jamais vu sur un tenant vide, d'où sa
    // découverte tardive) : supprimer une ligne `client`/`vehicule`/`document_vente` déclenche un
    // trigger d'audit (`audit_atelier`, CONTRIBUTING.md « Audit trail sur entités sensibles ») qui
    // INSÈRE une nouvelle ligne d'audit pour CE MÊME tenant. Un tri topologique n'a aucune prise
    // là-dessus : ce n'est pas une dépendance de clé étrangère, c'est un effet de bord de trigger,
    // et `audit_atelier` peut très bien être passé en début d'`ordre` (rien ne le force en fin),
    // laissant des lignes fraîchement recréées bloquer le `DELETE FROM tenant` final. Un DEUXIÈME
    // passage sur les tables qui ont encore des lignes après le premier (ici : `audit_atelier` de
    // nouveau, plus rien à sa suite) suffit dans tous les cas mesurés ; la boucle continue tant
    // qu'un passage supprime encore quelque chose, avec un plafond pour ne jamais tourner en
    // silence si un trigger venait à créer une chaîne plus longue.
    for (let passage = 0; passage < MAX_PASSAGES_PURGE; passage += 1) {
      let supprimeCePassage = 0;
      for (const table of ordre) {
        if (table === 'tenant') continue; // la ligne tenant elle-même part en dernier, hors boucle
        const { rowCount } = await client.query(
          `delete from public.${table} where tenant_id = $1`,
          [tenantId],
        );
        if (rowCount && rowCount > 0) {
          cumulParTable.set(table, (cumulParTable.get(table) ?? 0) + rowCount);
          supprimeCePassage += rowCount;
        }
      }
      if (supprimeCePassage === 0) break;
      if (passage === MAX_PASSAGES_PURGE - 1) {
        throw new Error(
          `Purge tenant : ${String(MAX_PASSAGES_PURGE)} passages n'ont pas suffi à stabiliser la ` +
            `suppression (un trigger continue de recréer des lignes) — probablement un défaut, pas ` +
            `un cas limite légitime.`,
        );
      }
    }

    await client.query(`delete from public.tenant where id = $1`, [tenantId]);
    await client.query('commit');
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  }

  const tablesPurgees = [...cumulParTable.entries()].map(([table, lignes]) => ({ table, lignes }));
  return { tenantId, slug, tablesPurgees };
}

/** Liste tous les tenants dont le slug porte le préfixe de test — pour un nettoyage en lot
 *  (`--nettoyer-tout`). */
export async function listerTenantsDeTest(
  client: Client,
): Promise<readonly { readonly id: string; readonly slug: string; readonly creeLe: Date }[]> {
  const { rows } = await client.query<{ id: string; slug: string; cree_le: Date }>(
    `select id, slug, cree_le from public.tenant where slug like $1 order by cree_le`,
    [`${PREFIXE_SLUG_TEST}%`],
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, creeLe: r.cree_le }));
}
