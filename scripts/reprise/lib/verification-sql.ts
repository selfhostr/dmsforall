/**
 * Contrôles PAR SQL DIRECT du résultat d'un import de reprise — jamais une confiance aveugle dans
 * ce que l'API rapporte (§ mission : « vérifie le résultat par SQL, pas par ce que l'API
 * affirme »). Connexion `dfa_migrator` (même raison que `lib/tenant.ts`/`lib/purge-tenant.ts` :
 * lecture d'exploitation hors tenant, RLS non pertinent ici).
 *
 * Colonnes d'ancrage utilisées, mesurées dans le code réel (jamais supposées) :
 *   - `client`/`vehicule`/`document_vente` portent `origine`/`numero_origine` depuis la migration
 *     0066 (`ecrivain-client-reprise.ts`/`ecrivain-vehicule-reprise.ts`/
 *     `ecrivain-document-vente-reprise.ts`, lus le 26.08.2026) ;
 *   - `vehicule_plaque`/`vehicule_detention` n'ont PAS cet ancrage (`docs/reprise/decisions.md`,
 *     « Ce qui reste ouvert » — migration d'extension non écrite pour ces tables). Sur un tenant
 *     de TEST fraîchement créé (aucun usage applicatif normal avant l'import), un simple
 *     `count(*) where tenant_id = $1` suffit : toute ligne trouvée ne peut provenir que de la
 *     reprise, faute d'alternative.
 */
import type { ClientPg } from './pg-client';

export interface ComptageDomainesReprise {
  readonly clients: number;
  readonly clientsNumeroOrigineDistinct: number;
  readonly vehicules: number;
  readonly vehiculesNumeroOrigineDistinct: number;
  readonly vehiculePlaques: number;
  readonly vehiculeDetentions: number;
  readonly documentsVente: number;
  readonly documentsVenteNumeroOrigineDistinct: number;
  readonly documentsVenteNonEmis: number;
}

/**
 * Comptage par domaine repris, AVEC le contrôle d'unicité de `numero_origine` intégré (colonne
 * distincte = colonne totale <=> aucun doublon) : c'est la preuve d'idempotence la plus directe —
 * un rejeu qui aurait dupliqué une fiche ferait immédiatement diverger les deux nombres.
 */
export async function compterDomainesReprise(
  client: ClientPg,
  tenantId: string,
): Promise<ComptageDomainesReprise> {
  const un = async (sql: string): Promise<number> => {
    const { rows } = await client.query<{ n: string }>(sql, [tenantId]);
    return Number(rows[0]!.n);
  };
  return {
    clients: await un(`select count(*)::text as n from public.client where tenant_id = $1`),
    clientsNumeroOrigineDistinct: await un(
      `select count(distinct numero_origine)::text as n from public.client where tenant_id = $1 and numero_origine is not null`,
    ),
    vehicules: await un(`select count(*)::text as n from public.vehicule where tenant_id = $1`),
    vehiculesNumeroOrigineDistinct: await un(
      `select count(distinct numero_origine)::text as n from public.vehicule where tenant_id = $1 and numero_origine is not null`,
    ),
    vehiculePlaques: await un(
      `select count(*)::text as n from public.vehicule_plaque where tenant_id = $1`,
    ),
    vehiculeDetentions: await un(
      `select count(*)::text as n from public.vehicule_detention where tenant_id = $1`,
    ),
    documentsVente: await un(
      `select count(*)::text as n from public.document_vente where tenant_id = $1`,
    ),
    documentsVenteNumeroOrigineDistinct: await un(
      `select count(distinct numero_origine)::text as n from public.document_vente where tenant_id = $1 and numero_origine is not null`,
    ),
    documentsVenteNonEmis: await un(
      `select count(*)::text as n from public.document_vente where tenant_id = $1 and statut <> 'emis'`,
    ),
  };
}

/** Échantillon lisible par un garagiste (§ mission : « retrouve-moi la dernière facture de M.
 *  Rossier » vaut mieux que « 8000 lignes importées ») — quelques clients avec leur numéro
 *  d'origine et leur nombre de véhicules, pour un contrôle manuel à l'écran ou en recette. */
export async function echantillonClients(
  client: ClientPg,
  tenantId: string,
  limite = 10,
): Promise<
  readonly {
    numero: string;
    nom: string | null;
    raisonSociale: string | null;
    numeroOrigine: string | null;
    nbVehicules: number;
  }[]
> {
  const { rows } = await client.query<{
    numero: string;
    nom: string | null;
    raison_sociale: string | null;
    numero_origine: string | null;
    nb_vehicules: number;
  }>(
    `select c.numero, c.nom, c.raison_sociale, c.numero_origine,
            (select count(*) from public.vehicule_detention d where d.client_id = c.id)::int as nb_vehicules
     from public.client c
     where c.tenant_id = $1
     order by c.numero_origine
     limit $2`,
    [tenantId, limite],
  );
  return rows.map((r) => ({
    numero: r.numero,
    nom: r.nom,
    raisonSociale: r.raison_sociale,
    numeroOrigine: r.numero_origine,
    nbVehicules: r.nb_vehicules,
  }));
}

/** Un instantané `table -> nombre de lignes du tenant` sur une liste de tables données — brique de
 *  base de la preuve d'étanchéité (comparer un instantané avant/après l'import D'UN AUTRE tenant). */
export async function instantaneComptagesTenant(
  client: ClientPg,
  tables: readonly string[],
  tenantId: string,
): Promise<Record<string, number>> {
  const resultat: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from public.${table} where tenant_id = $1`,
      [tenantId],
    );
    resultat[table] = Number(rows[0]!.n);
  }
  return resultat;
}

/** Différences entre deux instantanés du MÊME tenant (attendu : objet vide si rien n'a bougé —
 *  c'est la preuve d'étanchéité : importer un AUTRE tenant ne doit rien changer ici). */
export function diffInstantanes(
  avant: Record<string, number>,
  apres: Record<string, number>,
): Record<string, { avant: number; apres: number }> {
  const diff: Record<string, { avant: number; apres: number }> = {};
  for (const table of Object.keys(avant)) {
    if (avant[table] !== apres[table]) diff[table] = { avant: avant[table]!, apres: apres[table]! };
  }
  return diff;
}
