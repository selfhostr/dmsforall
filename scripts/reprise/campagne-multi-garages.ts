#!/usr/bin/env -S pnpm --filter @dfa/api exec tsx
/**
 * Campagne MULTI-GARAGES — le deuxième point de la mission : « prouvée sur plusieurs garages,
 * plusieurs fois ». Lance `executerCampagneUnTenant` (voir `campagne-reprise.ts`) pour CHAQUE
 * tenant demandé, puis fait la preuve qui ne peut se faire qu'avec plusieurs tenants A LA FOIS :
 * l'ÉTANCHÉITÉ — aucune ligne importée pour l'un ne doit atterrir chez l'autre.
 *
 * MÉTHODE D'ÉTANCHÉITÉ, mesurée pas supposée : instantané `table -> nombre de lignes` de TOUS les
 * tenants du lot (`lib/verification-sql.ts::instantaneComptagesTenant`, sur TOUTES les tables
 * `tenant_id`, pas seulement celles de la reprise) pris APRÈS CHAQUE import. Si l'import du tenant
 * B avait fait fuiter ne serait-ce qu'une ligne chez A, le comptage de A capturé après B aurait
 * changé par rapport à celui capturé après A lui-même — `diffInstantanes` le détecterait
 * immédiatement, sur N'IMPORTE QUELLE des 100+ tables `tenant_id`, pas seulement celles qu'on
 * pense à vérifier à la main.
 *
 * USAGE :
 *   tsx campagne-multi-garages.ts --archive <chemin.zip> --nb-garages 3 [--prefixe demo] [--nettoyer]
 *   tsx campagne-multi-garages.ts --archive a.zip --archive b.zip --tenant ga --tenant gb [--nettoyer]
 *
 * Deux modes : `--nb-garages N` génère N tenants `<prefixe>-01..0N` sur la MÊME archive (preuve
 * répétée, § mission) ; `--tenant`/`--archive` répétés associe explicitement chaque tenant à SON
 * archive (garages hétérogènes, ex. un Auto-i et un jeu synthétique côte à côte).
 */
import { chargerConfig } from './lib/env';
import { nouveauClientPg } from './lib/pg-client';
import {
  executerCampagneUnTenant,
  instantaneComptagesTenant,
  diffInstantanes,
  listerTablesTenant,
} from './campagne-reprise';

function argumentsMultiples(nom: string): string[] {
  const resultats: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${nom}`) {
      const v = process.argv[i + 1];
      if (v) resultats.push(v);
    }
  });
  return resultats;
}
function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
function drapeau(nom: string): boolean {
  return process.argv.includes(`--${nom}`);
}

async function main(): Promise<void> {
  const tenantsExplicites = argumentsMultiples('tenant');
  const archivesExplicites = argumentsMultiples('archive');
  const nbGarages = argument('nb-garages') ? Number(argument('nb-garages')) : undefined;
  const prefixe = argument('prefixe') ?? 'campagne';
  const rejouer = drapeau('rejouer');
  const nettoyer = drapeau('nettoyer');

  let paires: { suffixe: string; archive: string }[];
  if (nbGarages) {
    if (archivesExplicites.length !== 1) {
      throw new Error('--nb-garages exige exactement UNE --archive (rejouée sur chaque tenant).');
    }
    paires = Array.from({ length: nbGarages }, (_, i) => ({
      suffixe: `${prefixe}-${String(i + 1).padStart(2, '0')}`,
      archive: archivesExplicites[0]!,
    }));
  } else {
    if (tenantsExplicites.length === 0 || tenantsExplicites.length !== archivesExplicites.length) {
      process.stderr.write(
        'Usage : --nb-garages N --archive <zip>  OU  --tenant X --archive a.zip --tenant Y --archive b.zip ...\n',
      );
      process.exitCode = 2;
      return;
    }
    paires = tenantsExplicites.map((suffixe, i) => ({ suffixe, archive: archivesExplicites[i]! }));
  }

  const cfg = chargerConfig();
  const pg = nouveauClientPg({
    connectionString: cfg.urlMigration,
    application_name: 'dfa-reprise-multi',
  });
  await pg.connect();
  try {
    const toutesLesTables = [...(await listerTablesTenant(pg))].sort();

    const resultats: { suffixe: string; slug: string; tenantId: string; verdict: string }[] = [];
    const instantanesApresChaqueImport: {
      suffixe: string;
      tenantId: string;
      instantane: Record<string, number>;
    }[] = [];

    for (const { suffixe, archive } of paires) {
      process.stdout.write(`\n########## GARAGE ${suffixe} (${archive}) ##########\n`);
      const resultat = await executerCampagneUnTenant(
        pg,
        cfg.apiUrl,
        cfg.origine,
        {
          suffixeTenant: suffixe,
          cheminArchive: archive,
          rejouerImportComplet: rejouer,
          nettoyerApres: false,
        },
        (m, d) => process.stdout.write(`[${suffixe}] ${m}${d ? ' ' + JSON.stringify(d) : ''}\n`),
      );
      resultats.push({
        suffixe,
        slug: resultat.tenant.slug,
        tenantId: resultat.tenant.tenantId,
        verdict: resultat.verdict,
      });

      // Instantané de CE tenant tout de suite après SON import, ET ré-instantané de TOUS les
      // tenants déjà traités — la comparaison qui suit doit voir CHAQUE tenant antérieur
      // strictement inchangé par l'import qui vient de se produire.
      for (const precedent of instantanesApresChaqueImport) {
        const reInstantane = await instantaneComptagesTenant(
          pg,
          toutesLesTables,
          precedent.tenantId,
        );
        const diff = diffInstantanes(precedent.instantane, reInstantane);
        if (Object.keys(diff).length > 0) {
          process.stdout.write(
            `!!! FUITE ÉTANCHÉITÉ : l'import de ${suffixe} a modifié des lignes du tenant ${precedent.suffixe} : ${JSON.stringify(diff)}\n`,
          );
          resultats[resultats.length - 1]!.verdict = 'echec_etancheite';
        }
      }
      instantanesApresChaqueImport.push({
        suffixe,
        tenantId: resultat.tenant.tenantId,
        instantane: await instantaneComptagesTenant(pg, toutesLesTables, resultat.tenant.tenantId),
      });
    }

    process.stdout.write('\n=== VERDICT CAMPAGNE MULTI-GARAGES ===\n');
    for (const r of resultats)
      process.stdout.write(`${r.suffixe.padEnd(20)} ${r.tenantId}  ${r.verdict.toUpperCase()}\n`);
    const echecs = resultats.filter((r) => r.verdict !== 'succes');
    process.stdout.write(
      echecs.length === 0
        ? `${String(resultats.length)}/${String(resultats.length)} garages OK, étanchéité confirmée entre tous.\n`
        : `${String(echecs.length)}/${String(resultats.length)} garage(s) en défaut — voir ci-dessus.\n`,
    );

    if (nettoyer) {
      const { purgerTenantDeTest } = await import('./lib/purge-tenant');
      for (const r of resultats) await purgerTenantDeTest(pg, r.slug);
      process.stdout.write(`Tenants de test purgés (${String(resultats.length)}).\n`);
    }

    if (echecs.length > 0) process.exitCode = 1;
  } finally {
    await pg.end();
  }
}

main().catch((erreur: unknown) => {
  const message = erreur instanceof Error ? (erreur.stack ?? erreur.message) : String(erreur);
  process.stderr.write(`Échec : ${message}\n`);
  process.exitCode = 1;
});
