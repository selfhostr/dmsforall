/**
 * Import (rejouable) du référentiel véhicules suisse — `type_approbation_ch` (migration 0050).
 *
 * `pnpm db:import:vehicules-ch`, sur le modèle de `pnpm db:seed`.
 *
 * ==================================================================================================
 * SOURCE — écart mesuré avec l'en-tête de la migration 0050
 * ==================================================================================================
 * 0050 documente un choix TAS (vs TARGA) fondé sur des échantillons réels au moment de son écriture,
 * mais anticipait une livraison TAS en JSON PAR CODE TYPE (`4100-json-Files/<cat>_<code>.json`,
 * 227 540 fichiers) — irréaliste à télécharger un par un pour un import rejouable. En exécution
 * réelle sur `https://opendata.astra.admin.ch/ivzod/` (pas une supposition), l'ASTRA publie
 * DÉSORMAIS aussi TAS en trois exports CSV BULK, `4000-Typengenehmigungen_TAS/4300-Datensaetze/`
 * (`TAS_Automobil.csv` ≈336 Mo, `TAS_Motorrad.csv` ≈12 Mo, `TAS_Anhaenger.csv` ≈6 Mo) — mêmes noms
 * de champ EXACTS que ceux cités par `db/schema/referentiel/type-approbation-ch.ts`
 * (`chTypeApprovalNumber`, `vehicleCategoryCode`, `makeName`, `commercialName`, `chFuelType`,
 * `driveType`, `engineType`, `engineCapacity`, `maximumNetPower`, `chNrOfSeatingPositionsMinimum`,
 * `definitive`, `versionNo`…), vérifiés colonne à colonne sur un échantillon réel avant d'écrire ce
 * fichier. C'est donc TOUJOURS TAS, au sens où la migration l'entendait — seul le VECTEUR de
 * livraison (CSV bulk hebdomadaire plutôt que JSON par fichier) diffère de ce qu'elle anticipait.
 * Ce fichier ne modifie ni la migration ni son miroir Drizzle : aucun n'avait besoin de changer.
 *
 * Total mesuré à l'écriture de ce fichier : 227 414 lignes (210 467 Automobil + 11 541 Motorrad +
 * 5 406 Anhaenger) — cohérent avec les 227 540 codes types annoncés par 0050 (écart 126 lignes,
 * plausible sur un jeu hebdomadaire entre l'écriture de la migration et cet import).
 *
 * PIÈGE CSV VÉRIFIÉ EN EXÉCUTION (pas supposé) : ces fichiers sont `;`-délimités, UTF-8 AVEC BOM
 * (vérifié par lecture d'octets bruts), et au moins un champ réel contient un `;` LITTÉRAL À
 * L'INTÉRIEUR de guillemets (ex. un champ de description de suspension `"v+h= Schraubenfedern;
 * Stossdämpfer"` sur un enregistrement Alfa Romeo réel) — un `split(';')` naïf décale alors toutes
 * les colonnes suivantes. `csv-parse` (respect RFC4180 des guillemets) est utilisé ci-dessous,
 * jamais un découpage manuel.
 *
 * MARQUES — chiffre mesuré sur cette même source (pas une estimation) : 1 611 marques distinctes,
 * 155 en couvrant 95 % des CODES TYPES (pas du parc réel en circulation, donnée absente de ce jeu
 * TAS). Écart signalé avec un chiffre antérieur de ~704 marques (72 pour 95 %) évoqué pour ce
 * chantier : non reproduit malgré une méthode de comptage correcte (parseur CSV respectant les
 * guillemets, vérifié sur `TARGA` ET `TAS`, deux sources ASTRA distinctes, aucune des deux ne
 * rendant 704). Non résolu ici — remonté tel quel plutôt qu'un chiffre inventé pour coller à une
 * attente.
 *
 * ==================================================================================================
 * CHAMPS NON MAPPÉS ICI, DÉLIBÉRÉMENT (`type_approbation_ch` en a la colonne, TAS n'a pas
 * l'équivalent ou l'équivalent est ambigu) :
 *   - aucun — contrairement à une première source explorée (TARGA), TAS couvre EXACTEMENT les
 *     champs que `type-approbation-ch.ts` documente déjà, colonne par colonne (voir ci-dessus).
 *
 * POIDS — DEUX noms de champ source selon la catégorie (déjà anticipé par le commentaire de
 * `poids_vide_kg`/`poids_total_kg` dans le schéma Drizzle, vérifié ici sur les 3 fichiers réels) :
 *   - Automobil : `chMassOfTheVehicleInRunningOrderMinimum` / `technicallyPermissibleMaximumLadenMassMinimum`
 *   - Motorrad ET Anhaenger (vérifiées identiques) : `chEmptyWeightMinimum` / `techPermMaxLadenMassMin`
 *
 * PLACES — absent des en-têtes Motorrad et Anhaenger (vérifié, pas de colonne `*Seating*` du
 * tout) : `null` pour ces deux catégories, jamais une valeur inventée.
 *
 * IDEMPOTENT : `insert ... on conflict (code_type_ch) do update`, par lots de 1000 lignes (limite
 * de paramètres Postgres par requête, très en dessous des 65535). Rejouer ce script met à jour
 * sans dupliquer ; `modifie_le` se met à jour tout seul via le trigger `touche_modifie_le` (0050).
 *
 * Connexion `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`) : `dfa_app` n'a QUE SELECT sur cette
 * table par posture déclarée (`[dfa:referentiel-partage]`, voir 0050 et `acces-base.service.ts`) —
 * seul `dfa_migrator` peut y écrire, exactement comme pour toute migration/maintenance de schéma.
 *
 * SÛR EN PRODUCTION, à la différence de `seed-dev.ts` : ce sont des données publiques ASTRA en
 * lecture seule pour l'application, pas un jeu de démo avec des mots de passe publiés — aucun
 * garde-fou `nodeEnv === 'production'` ici.
 *
 * ALIAS DE MARQUES — NE VIT PAS ICI. Les noms de marque `makeName` importés ci-dessous sont ceux
 * de l'ASTRA tels quels (ex. « VW », jamais « VOLKSWAGEN ») ; le mécanisme qui rapproche un nom de
 * comptoir de sa marque canonique (`type_approbation_ch_marque_alias`, migration 0051) est une
 * table CURÉE À LA MAIN, distincte de cet import automatisé — mélanger les deux ferait perdre les
 * alias à chaque réimport hebdomadaire ASTRA (`upsererLot` ne connaît que `type_approbation_ch`).
 * Voir `vehicules/referentiel/service-referentiel-vehicules-ch.ts` pour la résolution des alias.
 */

import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { Client } from 'pg';

import {
  typeApprobationCh,
  type NouveauTypeApprobationCh,
} from '../schema/referentiel/type-approbation-ch';

// -------------------------------------------------------------------------------------------
// Mapping pur (testable sans réseau ni base) — CSV TAS -> ligne d'insertion
// -------------------------------------------------------------------------------------------

export type CategorieSourceTas = 'automobil' | 'motorrad' | 'anhaenger';

/** Une ligne `columns: true` de `csv-parse` : un objet keyé par en-tête, valeurs toujours `string`
 *  (jamais déjà typées), champ absent (colonne inexistante dans CETTE catégorie) = `undefined`. */
export type LigneCsvTas = Readonly<Record<string, string | undefined>>;

export interface SourceTas {
  readonly fichier: string;
  readonly categorie: CategorieSourceTas;
  readonly libelle: string;
}

/** Les trois exports CSV bulk TAS (voir en-tête de fichier). Ordre sans importance fonctionnelle
 *  (chaque code type est upserté indépendamment), mais la plus grosse source en premier permet de
 *  voir la progression tourner tout de suite plutôt qu'après deux téléchargements rapides. */
export const SOURCES_TAS: readonly SourceTas[] = [
  {
    fichier: 'TAS_Automobil.csv',
    categorie: 'automobil',
    libelle: 'voitures de tourisme et utilitaires légers (MV)',
  },
  { fichier: 'TAS_Motorrad.csv', categorie: 'motorrad', libelle: 'deux-roues motorisés (MB)' },
  { fichier: 'TAS_Anhaenger.csv', categorie: 'anhaenger', libelle: 'remorques (TR)' },
];

export const URL_BASE_TAS =
  'https://opendata.astra.admin.ch/ivzod/4000-Typengenehmigungen_TAS/4300-Datensaetze/';

function chaineNonVide(valeur: string | undefined): string | null {
  const nettoyee = valeur?.trim();
  return nettoyee && nettoyee.length > 0 ? nettoyee : null;
}

/** `Number()` accepte déjà `.` ; `,` accepté en défense (variante de formatage jamais exclue sans
 *  l'avoir vue). Arrondit au plus proche (0050 : « perte de précision négligeable pour l'usage
 *  visé »). `null` si absent, non numérique, ou négatif (viole les contraintes `>= 0` de 0050 —
 *  mieux vaut une valeur absente qu'un import qui échoue en base sur une ligne ASTRA aberrante). */
function entierArrondiPositifOuNul(valeur: string | undefined): number | null {
  const brute = chaineNonVide(valeur);
  if (brute === null) return null;
  const nombre = Number(brute.replace(',', '.'));
  if (!Number.isFinite(nombre) || nombre < 0) return null;
  return Math.round(nombre);
}

/** Même règle qu'`entierArrondiPositifOuNul`, en plus strict : 0050 exige `places > 0` (jamais 0
 *  ni négatif) quand la colonne n'est pas `null`. */
function entierStrictementPositifOuNul(valeur: string | undefined): number | null {
  const nombre = entierArrondiPositifOuNul(valeur);
  return nombre !== null && nombre > 0 ? nombre : null;
}

const MOTIF_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** ASTRA `definitive` est déjà rendu `'AAAA-MM-JJ'` dans ces exports (vérifié sur échantillon réel)
 *  — aucune conversion de fuseau à faire, colonne Postgres `date` (pas `timestamptz`). `null` si le
 *  format ne correspond pas à ce qui a été vérifié, plutôt que de laisser Postgres échouer toute la
 *  ligne sur un format inattendu. */
function dateIsoOuNull(valeur: string | undefined): string | null {
  const brute = chaineNonVide(valeur);
  return brute && MOTIF_DATE_ISO.test(brute) ? brute : null;
}

/** Deux noms de champ source pour poids vide/total selon la catégorie — voir en-tête de fichier
 *  (« POIDS »), vérifié sur les 3 en-têtes CSV réels avant d'écrire cette table. */
const CHAMPS_POIDS: Readonly<
  Record<CategorieSourceTas, { readonly vide: string; readonly total: string }>
> = {
  automobil: {
    vide: 'chMassOfTheVehicleInRunningOrderMinimum',
    total: 'technicallyPermissibleMaximumLadenMassMinimum',
  },
  motorrad: { vide: 'chEmptyWeightMinimum', total: 'techPermMaxLadenMassMin' },
  anhaenger: { vide: 'chEmptyWeightMinimum', total: 'techPermMaxLadenMassMin' },
};

/**
 * `null` = ligne ignorée (un des quatre champs obligatoires de `type_approbation_ch` — code type,
 * catégorie, marque, modèle — est vide dans la source). Jamais de valeur inventée pour satisfaire
 * une contrainte `not null` : une ligne ASTRA sans marque n'est pas exploitable pour
 * l'autocomplétion qu'elle doit servir, la sauter est plus honnête que la falsifier.
 */
export function mapperLigneTasVersInsertion(
  ligne: LigneCsvTas,
  categorie: CategorieSourceTas,
): NouveauTypeApprobationCh | null {
  const codeTypeCh = chaineNonVide(ligne.chTypeApprovalNumber);
  const categorieVehicule = chaineNonVide(ligne.vehicleCategoryCode);
  const marque = chaineNonVide(ligne.makeName);
  const modele = chaineNonVide(ligne.commercialName);
  if (!codeTypeCh || !categorieVehicule || !marque || !modele) return null;

  const champsPoids = CHAMPS_POIDS[categorie];

  return {
    codeTypeCh,
    categorie: categorieVehicule,
    marque,
    marqueCode: chaineNonVide(ligne.makeCode),
    modele,
    typeTechnique: chaineNonVide(ligne.type),
    variante: chaineNonVide(ligne.variant),
    version: chaineNonVide(ligne.version),
    carburantCode: chaineNonVide(ligne.chFuelType),
    transmissionCode: chaineNonVide(ligne.driveType),
    moteurDesignation: chaineNonVide(ligne.engineType),
    cylindreeCm3: entierArrondiPositifOuNul(ligne.engineCapacity),
    puissanceKw: entierArrondiPositifOuNul(ligne.maximumNetPower),
    poidsVideKg: entierArrondiPositifOuNul(ligne[champsPoids.vide]),
    poidsTotalKg: entierArrondiPositifOuNul(ligne[champsPoids.total]),
    places: entierStrictementPositifOuNul(ligne.chNrOfSeatingPositionsMinimum),
    dateHomologation: dateIsoOuNull(ligne.definitive),
    sourceVersionNo: entierArrondiPositifOuNul(ligne.versionNo) ?? 0,
  };
}

// -------------------------------------------------------------------------------------------
// Upsert par lots
// -------------------------------------------------------------------------------------------

export const TAILLE_LOT = 1000;

/** `sql\`excluded.<col>\`` sur CHAQUE colonne : indispensable pour un upsert MULTI-LIGNES — un
 *  `set` en valeurs JS statiques (comme `service-stock.ts`, insert d'UNE ligne) appliquerait la
 *  même valeur à toute ligne en conflit du lot, quelle que soit la ligne source qui a causé le
 *  conflit. `excluded` est la pseudo-table Postgres qui porte la ligne PROPOSÉE par CETTE ligne du
 *  lot — c'est le patron standard d'upsert en masse. */
async function upsererLot(
  base: NodePgDatabase,
  lot: readonly NouveauTypeApprobationCh[],
): Promise<void> {
  if (lot.length === 0) return;
  await base
    .insert(typeApprobationCh)
    .values([...lot])
    .onConflictDoUpdate({
      target: typeApprobationCh.codeTypeCh,
      set: {
        categorie: sql`excluded.categorie`,
        marque: sql`excluded.marque`,
        marqueCode: sql`excluded.marque_code`,
        modele: sql`excluded.modele`,
        typeTechnique: sql`excluded.type_technique`,
        variante: sql`excluded.variante`,
        version: sql`excluded.version`,
        carburantCode: sql`excluded.carburant_code`,
        transmissionCode: sql`excluded.transmission_code`,
        moteurDesignation: sql`excluded.moteur_designation`,
        cylindreeCm3: sql`excluded.cylindree_cm3`,
        puissanceKw: sql`excluded.puissance_kw`,
        poidsVideKg: sql`excluded.poids_vide_kg`,
        poidsTotalKg: sql`excluded.poids_total_kg`,
        places: sql`excluded.places`,
        dateHomologation: sql`excluded.date_homologation`,
        sourceVersionNo: sql`excluded.source_version_no`,
      },
    });
}

// -------------------------------------------------------------------------------------------
// Téléchargement + analyse streamée d'une source
// -------------------------------------------------------------------------------------------

export interface StatistiquesImportSource {
  readonly fichier: string;
  readonly lues: number;
  readonly ignorees: number;
  readonly upsertees: number;
}

async function importerSource(
  base: NodePgDatabase,
  source: SourceTas,
  journaliser: (message: string) => void,
): Promise<StatistiquesImportSource> {
  const url = `${URL_BASE_TAS}${source.fichier}`;
  journaliser(`Téléchargement ${source.fichier} (${source.libelle})…`);

  const reponse = await fetch(url);
  if (!reponse.ok || !reponse.body) {
    throw new Error(`Échec du téléchargement de ${url} : HTTP ${reponse.status}`);
  }

  // `bom: true` — fichiers ASTRA en UTF-8 AVEC BOM, vérifié en exécution sur les octets bruts
  // (voir en-tête de fichier) : sans cette option, le premier en-tête de colonne
  // (`chTypeApprovalNumber`) porterait le BOM en préfixe invisible et ne matcherait jamais.
  const analyseur = parse({
    delimiter: ';',
    columns: true,
    bom: true,
    relax_quotes: false,
    skip_empty_lines: true,
  });

  const flux = Readable.fromWeb(reponse.body as never).pipe(
    analyseur,
  ) as AsyncIterable<LigneCsvTas>;

  let lues = 0;
  let ignorees = 0;
  let upsertees = 0;
  let lot: NouveauTypeApprobationCh[] = [];

  for await (const ligneBrute of flux) {
    lues += 1;
    const ligne = mapperLigneTasVersInsertion(ligneBrute, source.categorie);
    if (!ligne) {
      ignorees += 1;
      continue;
    }
    lot.push(ligne);
    if (lot.length >= TAILLE_LOT) {
      await upsererLot(base, lot);
      upsertees += lot.length;
      lot = [];
    }
    if (lues % 20_000 === 0) {
      journaliser(`  ${source.fichier} : ${lues} lignes lues, ${upsertees} upsertées…`);
    }
  }
  await upsererLot(base, lot);
  upsertees += lot.length;

  journaliser(
    `${source.fichier} : ${lues} lignes lues, ${ignorees} ignorées (champ obligatoire absent), ` +
      `${upsertees} upsertées.`,
  );
  return { fichier: source.fichier, lues, ignorees, upsertees };
}

// -------------------------------------------------------------------------------------------
// Orchestration + point d'entrée CLI
// -------------------------------------------------------------------------------------------

export interface OptionsImportReferentielVehiculesCh {
  /** URL de connexion du rôle `dfa_migrator` — `dfa_app` n'a que `SELECT` sur cette table. */
  readonly urlMigration: string;
  readonly journaliser?: (message: string) => void;
  /** Injection de test — par défaut, les trois sources ASTRA réelles (`SOURCES_TAS`). */
  readonly sources?: readonly SourceTas[];
}

export async function importerReferentielVehiculesCh(
  options: OptionsImportReferentielVehiculesCh,
): Promise<readonly StatistiquesImportSource[]> {
  const journaliser =
    options.journaliser ?? ((message: string) => process.stdout.write(`${message}\n`));
  const sources = options.sources ?? SOURCES_TAS;

  const client = new Client({
    connectionString: options.urlMigration,
    application_name: 'dfa-import-referentiel-vehicules-ch',
  });
  await client.connect();
  const base = drizzle(client);

  try {
    const resultats: StatistiquesImportSource[] = [];
    for (const source of sources) {
      resultats.push(await importerSource(base, source, journaliser));
    }

    const totalLues = resultats.reduce((somme, r) => somme + r.lues, 0);
    const totalUpsertees = resultats.reduce((somme, r) => somme + r.upsertees, 0);
    journaliser(
      `\nImport terminé : ${totalLues} lignes lues au total, ${totalUpsertees} upsertées dans ` +
        `type_approbation_ch.`,
    );
    return resultats;
  } finally {
    await client.end();
  }
}

function estPointDEntree(): boolean {
  const argument = process.argv[1];
  return (
    argument !== undefined &&
    /^import-referentiel-vehicules-ch(\.[cm]?[jt]s)?$/.test(basename(argument))
  );
}

if (estPointDEntree()) {
  void (async () => {
    const { chargerFichierEnv } = await import('../../config/charger-fichier-env');
    chargerFichierEnv();
    const { chargerConfig } = await import('../../config/charger-config');
    const config = chargerConfig(process.env);

    await importerReferentielVehiculesCh({ urlMigration: config.DATABASE_URL_MIGRATION });
  })().catch((erreur: unknown) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    process.stderr.write(`\nÉchec de l'import du référentiel véhicules : ${message}\n`);
    process.exitCode = 1;
  });
}
