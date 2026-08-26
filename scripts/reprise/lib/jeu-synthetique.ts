/**
 * Jeu de test SYNTHÉTIQUE — le palier « petit et rapide » demandé par la mission : aucune donnée
 * réelle de garage, entièrement fabriqué, rejouable en quelques secondes. Complète (ne remplace
 * pas) le palier « réel réduit » construit par `construire-jeu-reduit-source.ts` à partir de la
 * vraie archive Auto-i de @laupernoe.
 *
 * POURQUOI SYNTHÉTIQUE ET PAS UN SOUS-ENSEMBLE DE `Kunden.csv`/`VerkaufFahrzeuge.csv` (les CSV que
 * la mission cite comme point de départ possible) — arbitrage assumé, à signaler : ces CSV
 * (`/chemin/vers/echantillons/travail/auto-i/csv/`) contiennent des données PERSONNELLES RÉELLES d'un
 * vrai client de @laupernoe (noms, adresses, e-mails, téléphones — vérifié à la lecture de `Kunden.csv`).
 * Le principe nLPD que ce même chantier documente ailleurs (« les fichiers intermédiaires
 * d'extraction sont chiffrés et détruits après bascule ») interdit en pratique de les recopier
 * dans un fichier PERMANENT sous contrôle de version, destiné à être rejoué des dizaines de fois
 * sur des tenants de démonstration. Un jeu fabriqué, structurellement identique (mêmes colonnes,
 * mêmes pièges : dates `aaaa.mm.jj`, accents, NPA/VIN/plaque suisses), obtient la même preuve
 * mécanique SANS ce risque — et reste utilisable par quiconque n'a pas accès aux archives de @laupernoe
 * (§ « documentée pour que n'importe qui la refasse »).
 *
 * CLASSEMENT DE RÔLE VISÉ — les seuils exacts sont ceux de `apps/api/src/reprise/lecteurs/
 * detecteur-role.ts`/`signaux-contenu.ts` (lus, pas devinés) : la table clients porte un e-mail et
 * un NPA valides sur CHAQUE ligne (signaux `email`/`npa_suisse`, seuil 25 %), la table véhicules un
 * VIN 17 caractères ET une plaque suisse valides (signaux `chassis_vin`/`plaque_suisse`, seuil
 * 40 %), la table factures une date plausible ET un montant à précision centimes SANS aucune
 * colonne VIN/plaque (le signal `document_vente` est pénalisé ×0,6 s'il en détecte une — voir
 * `evaluerDocument`).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ecrireDbf, type TableDbf } from './dbf';
import { creerArchiveZip } from './zip';

/** PRNG déterministe (mulberry32) — même graine => même archive, octet pour octet (utile pour
 *  comparer deux exécutions, ou documenter une empreinte SHA-256 stable dans un guide). */
function mulberry32(graine: number): () => number {
  let a = graine;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRENOMS = [
  'Jean',
  'Marie',
  'François',
  'Céline',
  'Cédric',
  'Nathalie',
  'Yannick',
  'Sophie',
  'André',
  'Isabelle',
  'Werner',
  'Rösli',
  'Beat',
  'Ursula',
  'Grégoire',
  'Aline',
  'Kevin',
  'Émilie',
] as const;
const NOMS = [
  'Rossier',
  'Müller',
  'Dupasquier',
  'Höltschi',
  'Currat',
  'Zbinden',
  'Genoud',
  'Küng',
  'Bonvin',
  'Praz',
  'Schüpbach',
  'Delaloye',
  'Németh',
  'Berthoud',
  'Crausaz',
  'Ançay',
] as const;
const LOCALITES: readonly { npa: string; nom: string }[] = [
  { npa: '1950', nom: 'Sion' },
  { npa: '1920', nom: 'Martigny' },
  { npa: '1000', nom: 'Lausanne' },
  { npa: '1700', nom: 'Fribourg' },
  { npa: '3000', nom: 'Berne' },
  { npa: '1200', nom: 'Genève' },
  { npa: '8000', nom: 'Zürich' },
  { npa: '1963', nom: 'Vétroz' },
] as const;
const MARQUES_MODELES: readonly { marque: string; modele: string }[] = [
  { marque: 'Volkswagen', modele: 'Golf' },
  { marque: 'Škoda', modele: 'Octavia' },
  { marque: 'Renault', modele: 'Clio' },
  { marque: 'BMW', modele: 'Série 3' },
  { marque: 'Audi', modele: 'A3' },
  { marque: 'Toyota', modele: 'Yaris' },
  { marque: 'Opel', modele: 'Corsa' },
  { marque: 'Peugeot', modele: '208' },
] as const;
const CANTONS = ['VD', 'VS', 'GE', 'FR', 'BE', 'ZH'] as const;
const ALPHABET_VIN = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'; // exclut I, O, Q (CHECK réel de `vehicule`)

function choisir<T>(alea: () => number, liste: readonly T[]): T {
  return liste[Math.floor(alea() * liste.length)]!;
}

function genererVin(alea: () => number): string {
  let vin = '';
  for (let i = 0; i < 17; i += 1) vin += ALPHABET_VIN[Math.floor(alea() * ALPHABET_VIN.length)];
  return vin;
}

function genererDateIso(alea: () => number, anneeMin: number, anneeMax: number): string {
  const annee = anneeMin + Math.floor(alea() * (anneeMax - anneeMin + 1));
  const mois = 1 + Math.floor(alea() * 12);
  const jour = 1 + Math.floor(alea() * 28);
  return `${String(annee)}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

export interface OptionsJeuSynthetique {
  readonly nbClients?: number;
  readonly nbVehicules?: number;
  readonly nbFactures?: number;
  readonly graine?: number;
}

interface ClientGenere {
  readonly id: string;
  readonly nom: string;
  readonly prenom: string;
  readonly email: string;
  readonly npa: string;
  readonly localite: string;
}

function genererClients(alea: () => number, n: number): ClientGenere[] {
  const clients: ClientGenere[] = [];
  for (let i = 1; i <= n; i += 1) {
    const nom = choisir(alea, NOMS);
    const prenom = choisir(alea, PRENOMS);
    const loc = choisir(alea, LOCALITES);
    const domaine = choisir(alea, ['bluewin.ch', 'sunrise.ch', 'gmail.com', 'bluemail.ch']);
    clients.push({
      id: `C${String(i).padStart(5, '0')}`,
      nom,
      prenom,
      email: `${prenom.toLowerCase()}.${nom.toLowerCase()}${String(i)}@${domaine}`,
      npa: loc.npa,
      localite: loc.nom,
    });
  }
  return clients;
}

/** Construit le trio de tables DBF (clients / véhicules / factures) en mémoire — pas d'I/O ici,
 *  voir `ecrireJeuSynthetique` pour l'écriture sur disque + mise en archive. */
function construireTables(options: Required<OptionsJeuSynthetique>): readonly TableDbf[] {
  const alea = mulberry32(options.graine);
  const clients = genererClients(alea, options.nbClients);

  const kunden: TableDbf = {
    nom: 'KUNDEN',
    champs: [
      { nom: 'id', type: 'C', longueur: 10 },
      { nom: 'name', type: 'C', longueur: 30 },
      { nom: 'vorname', type: 'C', longueur: 30 },
      { nom: 'email', type: 'C', longueur: 60 },
      { nom: 'plz', type: 'C', longueur: 4 },
      { nom: 'ort', type: 'C', longueur: 30 },
      { nom: 'sprache', type: 'C', longueur: 2 },
    ],
    lignes: clients.map((c) => [c.id, c.nom, c.prenom, c.email, c.npa, c.localite, 'fr']),
  };

  const vehicules: { id: string; clientId: string | null }[] = [];
  const fahrzeugeLignes: (readonly (string | null)[])[] = [];
  for (let i = 1; i <= options.nbVehicules; i += 1) {
    const { marque, modele } = choisir(alea, MARQUES_MODELES);
    const vin = genererVin(alea);
    const plaque = `${choisir(alea, CANTONS)} ${String(1000 + Math.floor(alea() * 899_000))}`;
    const plaqueDu = genererDateIso(alea, 2008, 2025);
    // ~10 % des véhicules sans propriétaire connu (cas réel : véhicule d'occasion en dépôt) —
    // exerce le chemin `reference_manquante` de `ecrivain-vehicule-reprise.ts` sans le déclencher
    // sur la majorité du lot.
    const client = alea() < 0.9 ? choisir(alea, clients) : null;
    const id = `V${String(i).padStart(5, '0')}`;
    vehicules.push({ id, clientId: client?.id ?? null });
    fahrzeugeLignes.push([id, marque, modele, vin, plaque, plaqueDu, client?.id ?? null]);
  }
  const fahrzeuge: TableDbf = {
    nom: 'FAHRZEUGE',
    champs: [
      { nom: 'id', type: 'C', longueur: 10 },
      { nom: 'marke', type: 'C', longueur: 30 },
      { nom: 'modell', type: 'C', longueur: 30 },
      { nom: 'chassis', type: 'C', longueur: 17 },
      // Exactement « plaque » (pas « kennzeichen », trop long pour un nom DBF ≤ 10 caractères ET
      // hors de la liste d'alias exacte de `ecrivain-vehicule-reprise.ts::texte(..., 'plaque',
      // 'immatriculation', 'kennzeichen')`) — un nom tronqué qui ne matche AUCUN alias laisserait
      // `plaqueValeur` toujours `null`, silencieusement, et aucune `vehicule_plaque`/
      // `vehicule_detention` ne serait jamais écrite. Bug réel rencontré en écrivant ce fichier.
      { nom: 'plaque', type: 'C', longueur: 12 },
      { nom: 'plaque_du', type: 'D', longueur: 8 },
      { nom: 'halter_id', type: 'C', longueur: 10 },
    ],
    lignes: fahrzeugeLignes,
  };

  // Factures : AUCUNE colonne véhicule/plaque délibérément (voir tête de fichier — le signal
  // `document_vente` de `detecteur-role.ts` est pénalisé ×0,6 dès qu'une colonne châssis/plaque
  // dépasse 30 % de conformité, ce qui le ferait basculer vers « ordre_reparation »).
  const rechnungLignes: (readonly (string | number)[])[] = [];
  for (let i = 1; i <= options.nbFactures; i += 1) {
    const client = choisir(alea, clients);
    const totalTtc = 100 + Math.floor(alea() * 4900); // en unités "montant", cf. limite connue
    // signalée dans le rapport (service-import-reprise.ts n'applique aucune conversion ×100).
    rechnungLignes.push([
      `F${String(i).padStart(5, '0')}`,
      client.id,
      genererDateIso(alea, 2020, 2026),
      Number(totalTtc.toFixed(2)),
    ]);
  }
  const rechnung: TableDbf = {
    nom: 'RECHNUNG',
    champs: [
      { nom: 'id', type: 'C', longueur: 10 },
      { nom: 'client_id', type: 'C', longueur: 10 },
      { nom: 'date', type: 'D', longueur: 8 },
      { nom: 'total_ttc', type: 'N', longueur: 10, decimales: 2 },
    ],
    lignes: rechnungLignes,
  };

  return [kunden, fahrzeuge, rechnung];
}

export interface JeuSynthetiqueConstruit {
  readonly cheminZip: string;
  readonly tailleOctets: number;
  readonly sha256: string;
  readonly nbClients: number;
  readonly nbVehicules: number;
  readonly nbFactures: number;
}

/**
 * Construit le jeu synthétique et l'assemble en une archive ZIP prête pour `POST /reprise/
 * dossiers` (le lecteur détecte la famille FoxPro/dBase au contenu, jamais à l'extension — voir
 * `detection-famille.ts`). Écrit dans `dossierSortie` (créé si besoin) sous un nom déterministe.
 */
export async function ecrireJeuSynthetique(
  dossierSortie: string,
  options: OptionsJeuSynthetique = {},
): Promise<JeuSynthetiqueConstruit> {
  const opts: Required<OptionsJeuSynthetique> = {
    nbClients: options.nbClients ?? 40,
    nbVehicules: options.nbVehicules ?? 35,
    nbFactures: options.nbFactures ?? 25,
    graine: options.graine ?? 42,
  };
  const tables = construireTables(opts);

  const dossierTravail = mkdtempSync(join(tmpdir(), 'dfa-reprise-synth-'));
  try {
    const fichiers = tables.map((table) => ecrireDbf(join(dossierTravail, table.nom), table));
    mkdirSync(dossierSortie, { recursive: true });
    const cheminZip = join(dossierSortie, `jeu-synthetique-g${String(opts.graine)}.zip`);
    // `normaliserHorodatage: true` : ces fichiers sont dans NOTRE répertoire temporaire (créé et
    // détruit par cet appel), jamais un original — voir tête de fichier de `lib/zip.ts`.
    const { tailleOctets, sha256 } = await creerArchiveZip(cheminZip, fichiers, {
      normaliserHorodatage: true,
    });
    return {
      cheminZip,
      tailleOctets,
      sha256,
      nbClients: opts.nbClients,
      nbVehicules: opts.nbVehicules,
      nbFactures: opts.nbFactures,
    };
  } finally {
    rmSync(dossierTravail, { recursive: true, force: true });
  }
}
