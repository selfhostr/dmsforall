/**
 * Provisionnement d'un tenant de TEST pour la reprise de données — même patron que
 * `apps/api/src/db/seed/seed-dev.ts` (tenant + site + utilisateur `direction`, connexion
 * `dfa_migrator`, upsert idempotent), délibérément DUPLIQUÉ plutôt qu'importé :
 *
 *   1. `seed-dev.ts` sème UN jeu figé (`garage-martin`) — ce harnais doit pouvoir en créer
 *      plusieurs, à la demande, avec des identifiants dérivés d'un paramètre (slug) ;
 *   2. rester hors de toute dépendance vers `apps/api/src/**` : ce fichier vit dans le périmètre
 *      exclusif de ce chantier (`scripts/`), un autre agent modifie `apps/api/src/reprise/` EN CE
 *      MOMENT sur la même branche — zéro dépendance croisée, zéro risque de casse si son
 *      refactor déplace un export.
 *
 * RÔLE `direction`, jamais `admin` : seul `direction` porte `reprise.plan.valider`/
 * `reprise.import.lancer` (`DROITS_REPRISE_PAR_ROLE`, `matrice-droits.ts` — RF-115, aucun droit
 * financier pour `admin`). Un tenant de test provisionné avec un compte `admin` peut avancer
 * jusqu'au plan et jamais plus loin — piège vécu en lisant le contrôleur avant d'écrire ce fichier.
 *
 * UN SEUL SITE : `ecrivain-document-vente-reprise.ts` prend « le premier site du tenant » sans
 * autre critère (ambiguïté signalée par son auteur pour un groupe multi-sites) — un tenant de test
 * à un site élimine toute ambiguïté sur QUEL site reçoit les documents repris.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Client } from 'pg';

import { estSlugDeTest, PREFIXE_SLUG_TEST } from './purge-tenant';

export interface TenantDeTest {
  readonly tenantId: string;
  readonly slug: string;
  readonly siteId: string;
  readonly siteCode: string;
  readonly utilisateurId: string;
  readonly email: string;
  readonly motDePasse: string;
}

export interface OptionsTenantTest {
  /** Suffixe qui distingue ce tenant des autres (ex. `autoi-01`, `synth-a`). Le slug final est
   *  `reprise-test-<suffixe>` — toujours sous le préfixe reconnu par `purge-tenant.ts`. */
  readonly suffixe: string;
  /** Mot de passe fixe pour rejouabilité manuelle (défaut : généré, imprimé une fois). */
  readonly motDePasse?: string;
}

interface ModuleArgon2Napi {
  hash(clair: string, options: Record<string, unknown>): Promise<string>;
}

/**
 * Résolution FORCÉE depuis `apps/api/package.json` plutôt qu'un `import()` nu — `@node-rs/argon2`
 * n'est déclaré que dans les dépendances de `@dfa/api` (workspace pnpm strict, aucun hissage vers
 * la racine, vérifié : `apps/api/node_modules/@node-rs/argon2` existe, `node_modules/@node-rs/`
 * n'existe pas à la racine). Un `import()` nu depuis CE fichier (`scripts/reprise/lib/`) remonte
 * l'arborescence depuis SON PROPRE chemin, jamais depuis le `cwd` du process — il ne trouverait
 * donc jamais le paquet, même lancé via `pnpm --filter @dfa/api exec tsx`. Mesuré en exécution
 * (piège réel, pas anticipé) : un `import('@node-rs/argon2')` nu échoue ici alors qu'il réussirait
 * dans un fichier situé sous `apps/api/`. `createRequire` ancré sur `apps/api/package.json` fait
 * porter la résolution par CE point du dépôt, quel que soit l'endroit d'où ce module est appelé.
 */
const RACINE_DEPOT = resolve(__dirname, '../../..');
const requireDepuisApi = createRequire(resolve(RACINE_DEPOT, 'apps/api/package.json'));

/** Même stratégie de repli que `seed-dev.ts::chargerHacheurParDefaut` (paramètres OWASP
 *  Argon2id) — dupliquée pour la même raison d'indépendance de périmètre que le reste du fichier. */
async function hacherMotDePasse(clair: string): Promise<string> {
  try {
    const mod = requireDepuisApi('@node-rs/argon2') as ModuleArgon2Napi;
    return await mod.hash(clair, { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 });
  } catch {
    // repli
  }
  try {
    const mod = requireDepuisApi('argon2') as ModuleArgon2Napi;
    return await mod.hash(clair, { memoryCost: 19_456, timeCost: 2, parallelism: 1, type: 2 });
  } catch {
    throw new Error(
      `Aucune implémentation Argon2 disponible (@node-rs/argon2 ni argon2) sous ` +
        `apps/api/node_modules — lancer \`pnpm install\` à la racine du dépôt.`,
    );
  }
}

function motDePasseAleatoire(): string {
  // Format lisible à l'oral (utile en démo client) : ne cherche pas l'entropie maximale, cherche
  // à ne jamais être confondu avec un secret de production (même doctrine que `MOT_DE_PASSE_DEMO`
  // de `seed-dev.ts`, qui est en clair dans le dépôt pour la même raison).
  const suffixe = randomBytes(4).toString('hex');
  return `ReprisTest-${suffixe}!9`;
}

/**
 * Crée (ou réaligne si déjà présent — idempotent, comme `seed-dev.ts`) un tenant de test complet :
 * tenant + 1 site (`T01`) + 1 utilisateur `direction`, prêt à se connecter et driver le parcours
 * de reprise de bout en bout.
 */
export async function creerTenantDeTest(
  client: Client,
  options: OptionsTenantTest,
): Promise<TenantDeTest> {
  const slug = `${PREFIXE_SLUG_TEST}${options.suffixe}`;
  if (!estSlugDeTest(slug)) {
    // Ne peut normalement pas arriver (préfixe posé ci-dessus) — garde-fou de cohérence interne.
    throw new Error(`Slug construit hors du préfixe de test : ${slug}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new Error(
      `Suffixe « ${options.suffixe} » produit un slug invalide (${slug}) — ` +
        `\`tenant_slug_format_chk\` exige minuscules/chiffres/tirets uniquement.`,
    );
  }
  const motDePasse = options.motDePasse ?? motDePasseAleatoire();
  const email = `direction@${slug}.dfa-test.invalid`; // TLD réservé (RFC 2606) : jamais un vrai domaine.

  await client.query('begin');
  try {
    const { rows: rowsTenant } = await client.query<{ id: string }>(
      `insert into public.tenant (slug, raison_sociale, pays, langue_defaut, statut)
       values ($1, $2, 'CH', 'fr', 'actif')
       on conflict (slug) do update set statut = 'actif'
       returning id`,
      [slug, `Garage de test — ${options.suffixe}`],
    );
    const tenantId = rowsTenant[0]!.id;

    const siteCode = 'T01';
    const { rows: rowsSite } = await client.query<{ id: string }>(
      `insert into public.site (tenant_id, code, nom, rue, npa, localite, pays, actif)
       values ($1, $2, 'Site de test', 'Route de Test 1', '1000', 'Lausanne', 'CH', true)
       on conflict (tenant_id, code) do update set actif = true
       returning id`,
      [tenantId, siteCode],
    );
    const siteId = rowsSite[0]!.id;

    const hash = await hacherMotDePasse(motDePasse);
    const { rows: rowsUtilisateur } = await client.query<{ id: string }>(
      `insert into public.utilisateur
         (tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut)
       values ($1, $2, $3, 'Direction', 'Test', 'fr', 'direction', 'actif')
       on conflict (email) do update set
         mot_de_passe_hash = excluded.mot_de_passe_hash,
         statut = 'actif', echecs_connexion = 0, verrouille_jusqu_a = null
       returning id`,
      [tenantId, email, hash],
    );
    const utilisateurId = rowsUtilisateur[0]!.id;

    await client.query('commit');
    return { tenantId, slug, siteId, siteCode, utilisateurId, email, motDePasse };
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  }
}
