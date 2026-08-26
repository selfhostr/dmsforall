#!/usr/bin/env -S pnpm --filter @dfa/api exec tsx
/**
 * Harnais d'import répétable — UNE commande, UN tenant, verdict clair. Le script que la mission
 * demande en premier point : « un script qui, en une commande, mène le parcours complet pour un
 * tenant donné ». Pour plusieurs garages à la fois, voir `campagne-multi-garages.ts` (qui appelle
 * la même fonction `executerCampagneUnTenant` exportée ci-dessous, un tenant à la fois).
 *
 * CE QUE CE SCRIPT VÉRIFIE, ET COMMENT :
 *   - le parcours API complet (dépôt par tranches -> finalisation -> analyse -> plan -> validation
 *     -> import -> rapport), voir `lib/parcours.ts` ;
 *   - le résultat PAR SQL DIRECT (`lib/verification-sql.ts`), jamais seulement la réponse de
 *     l'API : compte les fiches réellement en base, avec leur ancrage d'origine, et vérifie
 *     qu'aucun `numero_origine` n'est dupliqué (preuve d'idempotence directe) ;
 *   - à la demande (`--rejouer`) : un DEUXIÈME dossier complet sur le MÊME tenant, avec la MÊME
 *     archive — jamais `POST .../import/rejouer` seul, qui n'est autorisé que depuis
 *     `import_echoue` (mesuré le 26.08.2026, `409` depuis `import_termine`) — puis compare les
 *     comptages avant/après : identiques => idempotent, tout écart => défaut à rapporter ;
 *   - à la demande (`--nettoyer`) : purge intégrale du tenant en fin de script
 *     (`lib/purge-tenant.ts`, FK-safe, garde-fou de préfixe non contournable).
 *
 * USAGE :
 *   pnpm --filter @dfa/api exec tsx /chemin/vers/dmsforall/scripts/reprise/campagne-reprise.ts \
 *     --tenant <suffixe> --archive <chemin.zip> [--rejouer] [--nettoyer]
 *
 * Exemple avec le jeu synthétique (voir `construire-jeu-synthetique.ts`) :
 *   tsx .../campagne-reprise.ts --tenant demo-01 --archive /tmp/dfa-reprise-jeux-test/jeu-synthetique-g42.zip --rejouer --nettoyer
 */
import { chargerConfig } from './lib/env';
import { nouveauClientPg, type ClientPg } from './lib/pg-client';
import { creerTenantDeTest, type TenantDeTest } from './lib/tenant';
import { purgerTenantDeTest, listerTablesTenant } from './lib/purge-tenant';
import { seConnecter } from './lib/client-http';
import { executerUnDossierComplet, type ResultatParcoursDossier } from './lib/parcours';
import {
  compterDomainesReprise,
  echantillonClients,
  instantaneComptagesTenant,
  diffInstantanes,
  type ComptageDomainesReprise,
} from './lib/verification-sql';

export interface OptionsCampagneUnTenant {
  readonly suffixeTenant: string;
  readonly cheminArchive: string;
  readonly rejouerImportComplet?: boolean;
  readonly nettoyerApres?: boolean;
}

export type VerdictCampagne = 'succes' | 'echec' | 'plan_vide';

export interface ResultatCampagneUnTenant {
  readonly tenant: TenantDeTest;
  readonly premierPassage: ResultatParcoursDossier;
  readonly comptagesApresPremierPassage: ComptageDomainesReprise;
  readonly deuxiemePassage: ResultatParcoursDossier | null;
  readonly comptagesApresDeuxiemePassage: ComptageDomainesReprise | null;
  readonly idempotent: boolean | null; // null si --rejouer non demandé
  readonly echantillon: readonly unknown[];
  readonly verdict: VerdictCampagne;
  readonly messages: readonly string[];
}

function memesComptages(a: ComptageDomainesReprise, b: ComptageDomainesReprise): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fonction réutilisable — un tenant, une archive, un verdict. Ne journalise que via `progres`
 * (l'appelant CLI décide de l'affichage ; `campagne-multi-garages.ts` la réutilise sans dupliquer
 * cette logique).
 */
export async function executerCampagneUnTenant(
  pg: ClientPg,
  apiUrl: string,
  origine: string,
  options: OptionsCampagneUnTenant,
  progres: (message: string, detail?: Record<string, unknown>) => void = () => undefined,
): Promise<ResultatCampagneUnTenant> {
  const messages: string[] = [];
  const noter = (m: string, detail?: Record<string, unknown>): void => {
    messages.push(detail ? `${m} ${JSON.stringify(detail)}` : m);
    progres(m, detail);
  };

  const tenant = await creerTenantDeTest(pg, { suffixe: options.suffixeTenant });
  noter('tenant_pret', { slug: tenant.slug, tenantId: tenant.tenantId, email: tenant.email });

  const session = await seConnecter(apiUrl, origine, tenant.email, tenant.motDePasse);
  noter('connecte');

  const premierPassage = await executerUnDossierComplet(session, options.cheminArchive, (e, d) =>
    noter(`parcours_1:${e}`, d),
  );
  const comptagesApresPremierPassage = await compterDomainesReprise(pg, tenant.tenantId);
  noter('comptages_apres_premier_passage', { ...comptagesApresPremierPassage });

  let verdict: VerdictCampagne;
  if (premierPassage.statutFinal === 'plan_propose' && premierPassage.planElementsInclus === 0) {
    verdict = 'plan_vide';
  } else if (premierPassage.statutFinal === 'import_termine') {
    verdict = 'succes';
  } else {
    verdict = 'echec';
  }

  let deuxiemePassage: ResultatParcoursDossier | null = null;
  let comptagesApresDeuxiemePassage: ComptageDomainesReprise | null = null;
  let idempotent: boolean | null = null;
  if (options.rejouerImportComplet && verdict === 'succes') {
    deuxiemePassage = await executerUnDossierComplet(session, options.cheminArchive, (e, d) =>
      noter(`parcours_2:${e}`, d),
    );
    comptagesApresDeuxiemePassage = await compterDomainesReprise(pg, tenant.tenantId);
    noter('comptages_apres_deuxieme_passage', { ...comptagesApresDeuxiemePassage });
    idempotent =
      deuxiemePassage.statutFinal === 'import_termine' &&
      memesComptages(comptagesApresPremierPassage, comptagesApresDeuxiemePassage);
    if (!idempotent) verdict = 'echec';
    noter('idempotence', { idempotent });
  }

  const echantillon = await echantillonClients(pg, tenant.tenantId, 5);

  if (options.nettoyerApres) {
    await purgerTenantDeTest(pg, tenant.slug);
    noter('tenant_purge');
  }

  return {
    tenant,
    premierPassage,
    comptagesApresPremierPassage,
    deuxiemePassage,
    comptagesApresDeuxiemePassage,
    idempotent,
    echantillon,
    verdict,
    messages,
  };
}

function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
function drapeau(nom: string): boolean {
  return process.argv.includes(`--${nom}`);
}

async function main(): Promise<void> {
  const suffixeTenant = argument('tenant');
  const cheminArchive = argument('archive');
  if (!suffixeTenant || !cheminArchive) {
    process.stderr.write(
      'Usage : campagne-reprise.ts --tenant <suffixe> --archive <chemin.zip> [--rejouer] [--nettoyer]\n',
    );
    process.exitCode = 2;
    return;
  }

  const cfg = chargerConfig();
  const pg = nouveauClientPg({
    connectionString: cfg.urlMigration,
    application_name: 'dfa-reprise-campagne',
  });
  await pg.connect();
  try {
    const resultat = await executerCampagneUnTenant(
      pg,
      cfg.apiUrl,
      cfg.origine,
      {
        suffixeTenant,
        cheminArchive,
        rejouerImportComplet: drapeau('rejouer'),
        nettoyerApres: drapeau('nettoyer'),
      },
      (m, d) =>
        process.stdout.write(
          `[${new Date().toISOString()}] ${m}${d ? ' ' + JSON.stringify(d) : ''}\n`,
        ),
    );

    process.stdout.write('\n=== VERDICT ===\n');
    process.stdout.write(
      `tenant            : ${resultat.tenant.slug} (${resultat.tenant.tenantId})\n`,
    );
    process.stdout.write(
      `connexion         : ${resultat.tenant.email} / ${resultat.tenant.motDePasse}\n`,
    );
    process.stdout.write(`statut dossier 1  : ${resultat.premierPassage.statutFinal}\n`);
    process.stdout.write(
      `plan              : ${String(resultat.premierPassage.planElementsInclus)} inclus / ${String(resultat.premierPassage.planElementsExclus)} exclus\n`,
    );
    process.stdout.write(
      `comptages en base : ${JSON.stringify(resultat.comptagesApresPremierPassage)}\n`,
    );
    if (resultat.idempotent !== null) {
      process.stdout.write(
        `idempotence       : ${resultat.idempotent ? 'OK (comptages identiques)' : 'ÉCHEC (comptages divergents)'}\n`,
      );
    }
    process.stdout.write(`échantillon       : ${JSON.stringify(resultat.echantillon)}\n`);
    process.stdout.write(`VERDICT           : ${resultat.verdict.toUpperCase()}\n`);

    if (resultat.verdict === 'echec') process.exitCode = 1;
  } finally {
    await pg.end();
  }
}

// Garde d'exécution CLI — bug réel rencontré en écrivant ce harnais : ce fichier est aussi importé
// comme BIBLIOTHÈQUE par `campagne-multi-garages.ts` (`executerCampagneUnTenant`,
// `listerTablesTenant`…). Sans cette garde, importer ce module exécutait AUSSI son propre `main()`
// — celui-ci lisait alors `process.argv` du script APPELANT (`campagne-multi-garages.ts`, arguments
// `--nb-garages`/`--prefixe`, jamais `--tenant`), affichait un faux message d'usage, et posait un
// `process.exitCode` parasite. `require.main === module` ne vaut que pour l'exécution DIRECTE
// (`tsx campagne-reprise.ts ...`), jamais pour un `import`/`require` depuis un autre fichier.
if (require.main === module) {
  main().catch((erreur: unknown) => {
    const message = erreur instanceof Error ? (erreur.stack ?? erreur.message) : String(erreur);
    process.stderr.write(`Échec : ${message}\n`);
    process.exitCode = 1;
  });
}

// listerTablesTenant / instantaneComptagesTenant / diffInstantanes : utilisés par
// `campagne-multi-garages.ts` pour la preuve d'étanchéité inter-tenants — réexportés ici pour
// n'avoir qu'un seul point d'entrée public sur ce module.
export { listerTablesTenant, instantaneComptagesTenant, diffInstantanes };
