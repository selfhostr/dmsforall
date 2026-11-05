#!/usr/bin/env node
/**
 * Banc de charge DFA — mesure la latence perçue (via l'API en marche, jamais Postgres en direct)
 * sur une base de développement volumineuse.
 *
 * Lecture seule stricte : chaque scénario est un GET. Rien n'est créé, modifié ou supprimé dans
 * `dfa_dev` — voir README.md pour le détail des garanties et la commande de lancement.
 *
 * Usage : node scripts/banc/executer-banc.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SessionBanc, URL_BASE_API } from './lib/http.mjs';
import { executerScenario } from './lib/executer-scenario.mjs';
import { obtenirCurseurALaPage, marcherPaginationComplete } from './lib/pagination.mjs';
import { ms } from './lib/stats.mjs';
import * as CFG from './config.mjs';

const DIR_SCRIPT = fileURLToPath(new URL('.', import.meta.url));
const DIR_RESULTATS = `${DIR_SCRIPT}resultats/`;
const SEUIL_CHARGE_MAX = 4;

function lireChargeMachine() {
  const brut = readFileSync('/proc/loadavg', 'utf8').trim().split(' ');
  return { charge1: Number(brut[0]), charge5: Number(brut[1]), charge15: Number(brut[2]) };
}

function hashCommitCourant() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: DIR_SCRIPT, encoding: 'utf8' }).trim();
  } catch {
    return 'inconnu';
  }
}

function brancheCourante() {
  try {
    return execSync('git branch --show-current', { cwd: DIR_SCRIPT, encoding: 'utf8' }).trim();
  } catch {
    return 'inconnue';
  }
}

/** Encode `q` proprement — les fragments peuvent contenir des caractères réservés à l'URL. */
function q(chemin, params) {
  const sp = new URLSearchParams(params);
  return `${chemin}?${sp.toString()}`;
}

async function main() {
  const charge = lireChargeMachine();
  console.log(
    `Charge machine (1/5/15 min) au démarrage : ${charge.charge1} / ${charge.charge5} / ${charge.charge15}`,
  );
  if (charge.charge1 > SEUIL_CHARGE_MAX) {
    console.log(
      `Charge 1 min > ${SEUIL_CHARGE_MAX} : les mesures ne seraient pas fiables. Arrêt sans rien lancer.`,
    );
    process.exitCode = 1;
    return;
  }

  const session = new SessionBanc();
  console.log(`Connexion à ${URL_BASE_API} en tant que ${CFG.IDENTIFIANTS_DEMO.email}…`);
  const { dureeMs: dureeConnexion } = await session.connecter(
    CFG.IDENTIFIANTS_DEMO.email,
    CFG.IDENTIFIANTS_DEMO.motDePasse,
  );
  console.log(`Connecté (${Math.round(dureeConnexion)} ms).`);

  const resultats = [];
  const anomalies = [];

  async function lancer(nom, chemin, { n, concurrence, methode = 'GET' }) {
    const r = await executerScenario({
      nom,
      n,
      concurrence,
      executerUneRequete: async () => {
        const { statut, dureeMs } = await session.requete(methode, chemin);
        return { statut, dureeMs };
      },
    });
    resultats.push(r);
    const statutsInattendus = Object.keys(r.parStatut).filter(
      (s) => Number(s) >= 400 || Number(s) < 0,
    );
    if (statutsInattendus.length > 0) {
      anomalies.push(`${nom} : statuts inattendus ${JSON.stringify(r.parStatut)}`);
    }
    console.log(
      `  ${nom.padEnd(38)} n=${r.n} c=${r.concurrence}  p50=${ms(r.latences.p50).padStart(5)}ms  ` +
        `p95=${ms(r.latences.p95).padStart(5)}ms  p99=${ms(r.latences.p99).padStart(5)}ms  ` +
        `statuts=${JSON.stringify(r.parStatut)}`,
    );
    return r;
  }

  // --------------------------------------------------------------------------------------------
  // Découverte (lecture seule) : un clientId réel avec véhicules, pour les scénarios "fiche".
  // Les valeurs métier réelles (numéro client, VIN) servent à construire des fragments de
  // recherche RÉALISTES mais ne sont JAMAIS écrites dans le rapport — ce sont des données de
  // production d'un vrai garage, pas une fixture de démo.
  // --------------------------------------------------------------------------------------------
  console.log('\nDécouverte (lecture seule)…');
  const pageClients = await session.requete('GET', q('/clients', { limite: '50' }));
  if (pageClients.statut !== 200)
    throw new Error(`Découverte clients échouée : ${pageClients.statut}`);
  const clientAvecVehicules =
    pageClients.corps.donnees.find((c) => c.nombreVehicules > 0) ?? pageClients.corps.donnees[0];
  const fragmentLongClient = clientAvecVehicules.numeroClient;

  const pageVehicules = await session.requete('GET', q('/vehicules', { limite: '50' }));
  if (pageVehicules.statut !== 200)
    throw new Error(`Découverte véhicules échouée : ${pageVehicules.statut}`);
  const vehiculeAvecVin = pageVehicules.corps.donnees.find((v) => v.vin);
  const fragmentLongVehicule = vehiculeAvecVin ? vehiculeAvecVin.vin : null;

  console.log(
    `  Client de référence : nombreVehicules=${clientAvecVehicules.nombreVehicules}, ` +
      `fragment long = numéro client réel (${fragmentLongClient.length} car., non journalisé).`,
  );
  console.log(
    fragmentLongVehicule
      ? `  Véhicule de référence : fragment long = VIN réel (${fragmentLongVehicule.length} car., non journalisé).`
      : '  Aucun véhicule avec VIN trouvé en page 1 — fragment long véhicule ignoré.',
  );

  // Curseurs profonds, obtenus UNE FOIS par une marche séquentielle puis REJOUÉS N fois — on
  // mesure le coût d'une lecture à cette profondeur, pas le coût de la marche pour y parvenir.
  console.log('\nCalcul des curseurs de profondeur (page 10 / page 50 / limite max)…');
  const curseurClients10 = await obtenirCurseurALaPage(session, '/clients', 50, 10);
  const curseurClients50 = await obtenirCurseurALaPage(session, '/clients', 50, 50);
  const curseurClients200Profond = await obtenirCurseurALaPage(session, '/clients', 200, 45);
  const curseurVehicules10 = await obtenirCurseurALaPage(session, '/vehicules', 50, 10);
  const curseurVehicules50 = await obtenirCurseurALaPage(session, '/vehicules', 50, 50);
  const curseurVehicules200Profond = await obtenirCurseurALaPage(session, '/vehicules', 200, 30);
  console.log(
    `  clients: page10 atteinte=${curseurClients10.pageAtteinte}/10 épuisé=${curseurClients10.epuise}` +
      `  page50 atteinte=${curseurClients50.pageAtteinte}/50 épuisé=${curseurClients50.epuise}` +
      `  limite200@45 atteinte=${curseurClients200Profond.pageAtteinte}/45 épuisé=${curseurClients200Profond.epuise}`,
  );
  console.log(
    `  vehicules: page10 atteinte=${curseurVehicules10.pageAtteinte}/10 épuisé=${curseurVehicules10.epuise}` +
      `  page50 atteinte=${curseurVehicules50.pageAtteinte}/50 épuisé=${curseurVehicules50.epuise}` +
      `  limite200@30 atteinte=${curseurVehicules200Profond.pageAtteinte}/30 épuisé=${curseurVehicules200Profond.epuise}`,
  );

  // --------------------------------------------------------------------------------------------
  // Préchauffage : une requête (non chronométrée) par forme de requête SQL distincte, pour que le
  // premier scénario mesuré ne paie pas seul le cache mémoire Postgres/OS froid et la mise en
  // cache du plan — sans ça, l'ORDRE d'exécution des scénarios biaiserait la comparaison entre
  // eux (le premier scénario lancé aurait l'air plus lent qu'il ne l'est en régime établi).
  // --------------------------------------------------------------------------------------------
  console.log('\nPréchauffage (non chronométré)…');
  await session.requete('GET', q('/clients', { limite: '50' }));
  await session.requete('GET', q('/clients', { limite: '200' }));
  await session.requete('GET', q('/clients', { q: CFG.FRAGMENT_COURT_CLIENT }));
  await session.requete('GET', q('/vehicules', { limite: '50' }));
  await session.requete('GET', q('/vehicules', { limite: '200' }));
  await session.requete('GET', q('/vehicules', { q: CFG.FRAGMENT_COURT_VEHICULE }));
  await session.requete('GET', `/clients/${clientAvecVehicules.id}`);
  await session.requete('GET', `/clients/${clientAvecVehicules.id}/vehicules`);
  await session.requete('GET', '/tableau-bord/activite');
  await session.requete('GET', '/tableau-bord/financier');
  console.log('  fait.');

  // --------------------------------------------------------------------------------------------
  // Scénarios perf — CLIENTS
  // --------------------------------------------------------------------------------------------
  console.log('\n== Clients — liste ==');
  await lancer('clients-page1', q('/clients', { limite: '50' }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer(
    'clients-page10',
    q('/clients', { limite: '50', curseur: curseurClients10.curseur ?? '' }),
    { n: CFG.N_STANDARD, concurrence: CFG.CONCURRENCE_STANDARD },
  );
  await lancer(
    'clients-page50',
    q('/clients', { limite: '50', curseur: curseurClients50.curseur ?? '' }),
    { n: CFG.N_STANDARD, concurrence: CFG.CONCURRENCE_STANDARD },
  );
  await lancer('clients-limite200-page1', q('/clients', { limite: '200' }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer(
    'clients-limite200-profond',
    q('/clients', { limite: '200', curseur: curseurClients200Profond.curseur ?? '' }),
    { n: CFG.N_STANDARD, concurrence: CFG.CONCURRENCE_STANDARD },
  );

  console.log('\n== Clients — recherche par fragment (isolé, c=1) ==');
  await lancer('clients-q-court-isole', q('/clients', { q: CFG.FRAGMENT_COURT_CLIENT }), {
    n: CFG.N_ISOLE,
    concurrence: 1,
  });
  await lancer('clients-q-long-isole', q('/clients', { q: fragmentLongClient }), {
    n: CFG.N_ISOLE,
    concurrence: 1,
  });
  await lancer('clients-q-aucun-isole', q('/clients', { q: CFG.FRAGMENT_SANS_CORRESPONDANCE }), {
    n: CFG.N_ISOLE,
    concurrence: 1,
  });

  console.log('\n== Clients — recherche par fragment (sous charge, c=6) ==');
  await lancer('clients-q-court-charge', q('/clients', { q: CFG.FRAGMENT_COURT_CLIENT }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer('clients-q-long-charge', q('/clients', { q: fragmentLongClient }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer('clients-q-aucun-charge', q('/clients', { q: CFG.FRAGMENT_SANS_CORRESPONDANCE }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });

  // --------------------------------------------------------------------------------------------
  // Scénarios perf — VÉHICULES
  // --------------------------------------------------------------------------------------------
  console.log('\n== Véhicules — liste ==');
  await lancer('vehicules-page1', q('/vehicules', { limite: '50' }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer(
    'vehicules-page10',
    q('/vehicules', { limite: '50', curseur: curseurVehicules10.curseur ?? '' }),
    { n: CFG.N_STANDARD, concurrence: CFG.CONCURRENCE_STANDARD },
  );
  await lancer(
    'vehicules-page50',
    q('/vehicules', { limite: '50', curseur: curseurVehicules50.curseur ?? '' }),
    { n: CFG.N_STANDARD, concurrence: CFG.CONCURRENCE_STANDARD },
  );
  await lancer('vehicules-limite200-page1', q('/vehicules', { limite: '200' }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer(
    'vehicules-limite200-profond',
    q('/vehicules', { limite: '200', curseur: curseurVehicules200Profond.curseur ?? '' }),
    { n: CFG.N_STANDARD, concurrence: CFG.CONCURRENCE_STANDARD },
  );

  console.log('\n== Véhicules — recherche par fragment (isolé, c=1) ==');
  await lancer('vehicules-q-court-isole', q('/vehicules', { q: CFG.FRAGMENT_COURT_VEHICULE }), {
    n: CFG.N_ISOLE,
    concurrence: 1,
  });
  if (fragmentLongVehicule) {
    await lancer('vehicules-q-long-isole', q('/vehicules', { q: fragmentLongVehicule }), {
      n: CFG.N_ISOLE,
      concurrence: 1,
    });
  }
  await lancer(
    'vehicules-q-aucun-isole',
    q('/vehicules', { q: CFG.FRAGMENT_SANS_CORRESPONDANCE }),
    { n: CFG.N_ISOLE, concurrence: 1 },
  );

  console.log('\n== Véhicules — recherche par fragment (sous charge, c=6) ==');
  await lancer('vehicules-q-court-charge', q('/vehicules', { q: CFG.FRAGMENT_COURT_VEHICULE }), {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  if (fragmentLongVehicule) {
    await lancer('vehicules-q-long-charge', q('/vehicules', { q: fragmentLongVehicule }), {
      n: CFG.N_STANDARD,
      concurrence: CFG.CONCURRENCE_STANDARD,
    });
  }
  await lancer(
    'vehicules-q-aucun-charge',
    q('/vehicules', { q: CFG.FRAGMENT_SANS_CORRESPONDANCE }),
    { n: CFG.N_STANDARD, concurrence: CFG.CONCURRENCE_STANDARD },
  );

  // --------------------------------------------------------------------------------------------
  // Fiche client + tableau de bord
  // --------------------------------------------------------------------------------------------
  console.log('\n== Fiche client / tableau de bord ==');
  await lancer('client-fiche', `/clients/${clientAvecVehicules.id}`, {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer('client-vehicules', `/clients/${clientAvecVehicules.id}/vehicules`, {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer('tableau-bord-activite', '/tableau-bord/activite', {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });
  await lancer('tableau-bord-financier', '/tableau-bord/financier', {
    n: CFG.N_STANDARD,
    concurrence: CFG.CONCURRENCE_STANDARD,
  });

  // --------------------------------------------------------------------------------------------
  // Recherche comptoir unifiée — rate-limitée PAR UTILISATEUR (40 req/30s, garde-limitation-
  // recherche.ts) : concurrence 1, volume délibérément bas pour rester loin de la limite.
  // --------------------------------------------------------------------------------------------
  console.log('\n== Recherche comptoir unifiée (/recherche, rate-limitée) ==');
  await lancer('recherche-unifiee-court', q('/recherche', { q: CFG.FRAGMENT_COURT_CLIENT }), {
    n: CFG.N_RECHERCHE_UNIFIEE,
    concurrence: CFG.CONCURRENCE_RECHERCHE_UNIFIEE,
  });
  await lancer(
    'recherche-unifiee-aucun',
    q('/recherche', { q: CFG.FRAGMENT_SANS_CORRESPONDANCE }),
    { n: CFG.N_RECHERCHE_UNIFIEE, concurrence: CFG.CONCURRENCE_RECHERCHE_UNIFIEE },
  );

  // --------------------------------------------------------------------------------------------
  // Correctness — plafond de pagination et intégrité du curseur au-delà de la page 50.
  // --------------------------------------------------------------------------------------------
  console.log('\n== Contrôles de correction ==');
  const limiteExcessive = await session.requete('GET', q('/clients', { limite: '201' }));
  console.log(
    `  limite=201 (> plafond 200) → HTTP ${limiteExcessive.statut} ` +
      `(attendu 400 VALIDATION_ECHOUEE)`,
  );
  if (limiteExcessive.statut !== 400) {
    anomalies.push(
      `limite=201 n'a PAS été rejetée (HTTP ${limiteExcessive.statut}) — plafond non appliqué ?`,
    );
  }

  console.log('\n  Marche complète clients (limite=200) x2 — intégrité du curseur…');
  const marcheClients1 = await marcherPaginationComplete(session, '/clients', 200);
  const marcheClients2 = await marcherPaginationComplete(session, '/clients', 200);
  console.log(
    `    marche 1 : total=${marcheClients1.total} pages=${marcheClients1.pages} doublons=${marcheClients1.doublons.length} tailleAnormale=${JSON.stringify(marcheClients1.tailleAnormale)}`,
  );
  console.log(
    `    marche 2 : total=${marcheClients2.total} pages=${marcheClients2.pages} doublons=${marcheClients2.doublons.length} tailleAnormale=${JSON.stringify(marcheClients2.tailleAnormale)}`,
  );
  if (marcheClients1.total !== marcheClients2.total) {
    anomalies.push(
      `Marche clients non déterministe : ${marcheClients1.total} puis ${marcheClients2.total} lignes.`,
    );
  }
  if (marcheClients1.doublons.length > 0 || marcheClients2.doublons.length > 0) {
    anomalies.push('Doublons détectés pendant la marche de pagination clients — curseur suspect.');
  }
  if (marcheClients1.tailleAnormale || marcheClients2.tailleAnormale) {
    anomalies.push(
      'Taille de page anormale (≠ limite) hors dernière page — ligne(s) potentiellement sautée(s).',
    );
  }

  console.log('\n  Marche complète véhicules (limite=200) x2 — intégrité du curseur…');
  const marcheVehicules1 = await marcherPaginationComplete(session, '/vehicules', 200);
  const marcheVehicules2 = await marcherPaginationComplete(session, '/vehicules', 200);
  console.log(
    `    marche 1 : total=${marcheVehicules1.total} pages=${marcheVehicules1.pages} doublons=${marcheVehicules1.doublons.length} tailleAnormale=${JSON.stringify(marcheVehicules1.tailleAnormale)}`,
  );
  console.log(
    `    marche 2 : total=${marcheVehicules2.total} pages=${marcheVehicules2.pages} doublons=${marcheVehicules2.doublons.length} tailleAnormale=${JSON.stringify(marcheVehicules2.tailleAnormale)}`,
  );
  if (marcheVehicules1.total !== marcheVehicules2.total) {
    anomalies.push(
      `Marche véhicules non déterministe : ${marcheVehicules1.total} puis ${marcheVehicules2.total} lignes.`,
    );
  }
  if (marcheVehicules1.doublons.length > 0 || marcheVehicules2.doublons.length > 0) {
    anomalies.push(
      'Doublons détectés pendant la marche de pagination véhicules — curseur suspect.',
    );
  }
  if (marcheVehicules1.tailleAnormale || marcheVehicules2.tailleAnormale) {
    anomalies.push(
      'Taille de page anormale (≠ limite) hors dernière page — ligne(s) potentiellement sautée(s).',
    );
  }

  // --------------------------------------------------------------------------------------------
  // Écriture des résultats
  // --------------------------------------------------------------------------------------------
  const chargeFin = lireChargeMachine();
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(DIR_RESULTATS, { recursive: true });

  const rapport = {
    horodatage: new Date().toISOString(),
    depot: { branche: brancheCourante(), commit: hashCommitCourant() },
    machine: { chargeDebut: charge, chargeFin },
    requetesSqlParEndpoint: CFG.REQUETES_SQL,
    paginationIntegrite: {
      clients: { marche1: marcheClients1, marche2: marcheClients2 },
      vehicules: { marche1: marcheVehicules1, marche2: marcheVehicules2 },
    },
    limitePlafondRejetee: { statut: limiteExcessive.statut, attendu: 400 },
    scenarios: resultats,
    anomalies,
  };

  const cheminJson = `${DIR_RESULTATS}${horodatage}.json`;
  writeFileSync(cheminJson, JSON.stringify(rapport, null, 2));

  const cheminMd = `${DIR_RESULTATS}${horodatage}.md`;
  writeFileSync(cheminMd, genererMarkdown(rapport));

  console.log(`\nRésultats écrits :\n  ${cheminJson}\n  ${cheminMd}`);
  if (anomalies.length > 0) {
    console.log(`\n${anomalies.length} anomalie(s) :`);
    for (const a of anomalies) console.log(`  - ${a}`);
  } else {
    console.log('\nAucune anomalie de correction détectée.');
  }
}

function genererMarkdown(rapport) {
  const lignes = [];
  lignes.push(`# Banc de charge DFA — ${rapport.horodatage}`);
  lignes.push('');
  lignes.push(`Branche \`${rapport.depot.branche}\`, commit \`${rapport.depot.commit}\`.`);
  lignes.push('');
  lignes.push(
    `Charge machine (1/5/15 min) : début ${rapport.machine.chargeDebut.charge1}/${rapport.machine.chargeDebut.charge5}/${rapport.machine.chargeDebut.charge15} — ` +
      `fin ${rapport.machine.chargeFin.charge1}/${rapport.machine.chargeFin.charge5}/${rapport.machine.chargeFin.charge15}.`,
  );
  lignes.push('');
  lignes.push('## Latences par scénario');
  lignes.push('');
  lignes.push(
    '| Scénario | n | concurrence | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | statuts |',
  );
  lignes.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const s of rapport.scenarios) {
    lignes.push(
      `| ${s.nom} | ${s.n} | ${s.concurrence} | ${ms(s.latences.p50)} | ${ms(s.latences.p95)} | ${ms(s.latences.p99)} | ${ms(s.latences.max)} | ${JSON.stringify(s.parStatut)} |`,
    );
  }
  lignes.push('');
  lignes.push('## Requêtes SQL par endpoint (comptées statiquement dans le code)');
  lignes.push('');
  lignes.push('| Endpoint | Requêtes SQL |');
  lignes.push('| --- | ---: |');
  for (const [endpoint, n] of Object.entries(rapport.requetesSqlParEndpoint)) {
    lignes.push(`| ${endpoint} | ${n} |`);
  }
  lignes.push('');
  lignes.push('## Intégrité pagination curseur (limite=200, deux marches indépendantes)');
  lignes.push('');
  for (const [nomCollection, resultat] of Object.entries(rapport.paginationIntegrite)) {
    lignes.push(
      `- **${nomCollection}** : marche 1 = ${resultat.marche1.total} lignes / ${resultat.marche1.pages} pages, ` +
        `marche 2 = ${resultat.marche2.total} lignes / ${resultat.marche2.pages} pages, ` +
        `doublons = ${resultat.marche1.doublons.length + resultat.marche2.doublons.length}.`,
    );
  }
  lignes.push('');
  lignes.push(`## Plafond de pagination (limite=201)`);
  lignes.push('');
  lignes.push(
    `HTTP ${rapport.limitePlafondRejetee.statut} (attendu ${rapport.limitePlafondRejetee.attendu}).`,
  );
  lignes.push('');
  lignes.push('## Anomalies');
  lignes.push('');
  if (rapport.anomalies.length === 0) {
    lignes.push('Aucune.');
  } else {
    for (const a of rapport.anomalies) lignes.push(`- ${a}`);
  }
  lignes.push('');
  return lignes.join('\n');
}

main().catch((erreur) => {
  console.error('Banc interrompu par une erreur :', erreur);
  process.exitCode = 1;
});
