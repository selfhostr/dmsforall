/**
 * Migration 0069 — correction rétroactive de l'arrondi TVA négatif sur `ligne_or` (commit
 * 2358f2e : `Math.round`, demi vers +∞, remplacé par `arrondiCommercial`, demi éloigné de zéro).
 *
 * Test d'INTÉGRATION, pas unitaire : le comportement dépend de trois triggers RÉELS sur
 * `ligne_or` (`ligne_or_verrouiller_or`, `ligne_or_recalculer_drapeaux`, `ligne_or_audit`)
 * qu'aucun test unitaire ne peut simuler fidèlement — en particulier le bypass du trigger de
 * verrouillage sur un OR facturé (bloc B) et la répercussion automatique sur
 * `ordre_reparation.total_valide_centimes`.
 *
 * Scénario : deux lignes fautives — une sur un OR OUVERT (`planifie`), une sur un OR VERROUILLÉ
 * (`facture`) — plus une ligne déjà correcte (témoin, qui ne doit JAMAIS bouger). Les deux cas
 * fautifs reprennent LITTÉRALEMENT les deux exemples chiffrés du plan de cette tâche :
 *   - remise -500 c. au taux normal (8.1 %) : ancienne règle tva=-40 (Math.round(-40.5)=-40 en
 *     JS, arrondit vers +∞), nouvelle règle tva=-41 (arrondiCommercial, s'éloigne de zéro) ;
 *   - remise -250 c. au taux réduit (2.6 %) : ancienne règle tva=-6, nouvelle règle tva=-7
 *     (`arrondi-commercial.spec.ts` : `arrondiCommercial(-6500n, 1000n)` -> `-7n`).
 *
 * Migre jusqu'à 0068 (0069 exclue), insère les fixtures directement en SQL avec les valeurs
 * `Math.round` d'origine, PUIS applique le fichier 0069 comme un `up` normal (comme en
 * production : `pnpm db:migrate` ne l'aurait exécuté qu'une fois, sur des données déjà en
 * place).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  demarrerBaseEphemere,
  listerFichiersMigrationsUp,
  requeteSousTenant,
  ecrireSousTenant,
  type BaseEphemere,
} from '../setup/postgres-ephemere';
import { semerGarageDemo, type TenantFixture } from '../fixtures/garage-demo';

const DOSSIER_MIGRATIONS = path.resolve(__dirname, '../../src/db/migrations');
const CHEMIN_0069 = path.join(DOSSIER_MIGRATIONS, '0069_correction_arrondi_negatif_ligne_or.sql');
const CHEMIN_0069_DOWN = path.join(
  DOSSIER_MIGRATIONS,
  'down/0069_correction_arrondi_negatif_ligne_or.down.sql',
);

const MARQUEUR_DEBUT = 'DFA_0069_BLOC_CORRECTION_DEBUT';
const MARQUEUR_FIN = 'DFA_0069_BLOC_CORRECTION_FIN';

/** Extrait le sous-texte entre les deux marqueurs (bloc A + bloc B, y compris les deux
 *  `create or replace function` qui les précèdent — voir l'en-tête de 0069 : cette zone est
 *  volontairement rejouable seule, contrairement à `create table`/`drop function`). */
function extraireBlocRejouable(sqlComplet: string): string {
  const debut = sqlComplet.indexOf(MARQUEUR_DEBUT);
  const fin = sqlComplet.indexOf(MARQUEUR_FIN);
  if (debut === -1 || fin === -1 || fin < debut) {
    throw new Error(
      `[test 0069] marqueurs ${MARQUEUR_DEBUT}/${MARQUEUR_FIN} introuvables ou mal ordonnés dans ` +
        `0069_correction_arrondi_negatif_ligne_or.sql — le test ne peut pas isoler le bloc rejouable.`,
    );
  }
  // Repart du début de LIGNE du marqueur de début, et va jusqu'à la FIN de ligne du marqueur de
  // fin (pas juste l'occurrence du mot dans les deux cas) — pas de ligne SQL coupée en plein
  // milieu.
  const debutLigne = sqlComplet.lastIndexOf('\n', debut) + 1;
  const finDeLigne = sqlComplet.indexOf('\n', fin);
  const finRegion = finDeLigne === -1 ? sqlComplet.length : finDeLigne;
  return sqlComplet.slice(debutLigne, finRegion);
}

/** Les deux fonctions jetables sont `create or replace` — les redéclarer ici pour le test
 *  d'idempotence les laisse présentes en base (elles ne sont PAS re-DROPées par un rejeu partiel
 *  du bloc, seulement par la fin du fichier complet). Sans ce nettoyage, l'assertion de
 *  `0069_....down.sql` (« la fonction ne doit plus exister ») échouerait — pas un défaut de la
 *  migration réelle (un `up` complet unique les DROP correctement, prouvé par le test
 *  down/up ci-dessous), seulement un résidu de CE test qui rejoue le bloc une fois de plus que
 *  ne le ferait jamais un déploiement réel. */
const NETTOYAGE_FONCTIONS_JETABLES = `
  drop function if exists public.dfa_0069_recalculer_ligne_or(
    public.type_ligne_or, public.payeur_ligne_or, integer, integer, integer, integer, smallint, smallint
  );
  drop function if exists public.dfa_0069_arrondi_commercial(bigint, bigint);
`;

interface LigneOrEtat {
  readonly montantHtCentimes: number;
  readonly montantTvaCentimes: number;
  readonly montantTtcCentimes: number;
  readonly modifieLe: string;
}

interface JournalCorrection {
  readonly categorie: string;
  readonly ligneOrId: string;
  readonly montantHtAvantCentimes: number;
  readonly montantTvaAvantCentimes: number;
  readonly montantTtcAvantCentimes: number;
  readonly montantHtApresCentimes: number;
  readonly montantTvaApresCentimes: number;
  readonly montantTtcApresCentimes: number;
}

let bdd: BaseEphemere;
let client: Client;
let tenant: TenantFixture;

// Identifiants fixes (déterministes) pour tout le fixture — plus lisible dans les requêtes de
// vérification qu'un `randomUUID()` capturé dans une variable par ligne.
const CLIENT_ID = randomUUID();
const VEHICULE_ID = randomUUID();
const OR_OUVERT_ID = randomUUID();
const OR_VERROUILLE_ID = randomUUID();
const OR_TEMOIN_ID = randomUUID();
const LIGNE_OUVERT_ID = randomUUID();
const LIGNE_VERROUILLE_ID = randomUUID();
const LIGNE_TEMOIN_ID = randomUUID();

// --- Cas chiffrés (voir en-tête) ---------------------------------------------------------------
// OR ouvert : remise -500 c. @ 8.1 % — ancien Math.round -> ht=-500 tva=-40 ttc=-540 ; nouveau
// arrondiCommercial -> ht=-500 tva=-41 ttc=-541.
const OUVERT_AVANT = { ht: -500, tva: -40, ttc: -540 };
const OUVERT_APRES = { ht: -500, tva: -41, ttc: -541 };
// OR verrouillé : remise -250 c. @ 2.6 % — ancien -> ht=-250 tva=-6 ttc=-256 ; nouveau ->
// ht=-250 tva=-7 ttc=-257.
const VERROUILLE_AVANT = { ht: -250, tva: -6, ttc: -256 };
const VERROUILLE_APRES = { ht: -250, tva: -7, ttc: -257 };
// Témoin : forfait 10000 c. @ 8.1 % — DÉJÀ correct sous les deux règles (positif, division
// exacte) : ne doit jamais bouger.
const TEMOIN = { ht: 10000, tva: 810, ttc: 10810 };

beforeAll(async () => {
  bdd = await demarrerBaseEphemere({ appliquerMigrations: false });

  // 1. Migre jusqu'à 0068 (0069 volontairement exclue à ce stade).
  client = new Client({ connectionString: bdd.migrateur.url });
  await client.connect();
  const fichiers = listerFichiersMigrationsUp().filter((f) => !f.startsWith('0069_'));
  for (const fichier of fichiers) {
    await client.query(readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf8'));
  }

  // 2. Socle tenant/site/utilisateur (semerGarageDemo, superutilisateur — tenant/site sont
  //    FORCE ROW LEVEL SECURITY, même dfa_migrator ne peut pas y écrire sans contexte).
  const socle = await semerGarageDemo(bdd);
  tenant = socle.tenantA;

  // 3. Client + véhicule minimaux, via dfa_app sous contexte tenant — même chemin qu'un service
  //    applicatif réel (`ecrireSousTenant`, patron de test/lot1/fixtures/garage-demo-lot1.ts).
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (pg) => {
    await pg.query(
      `insert into client (id, tenant_id, numero, type, civilite, nom, prenom, langue, statut)
       values ($1, $2, 'CLI-0069', 'particulier', 'M.', 'Test', 'Client0069', 'fr', 'actif')`,
      [CLIENT_ID, tenant.id],
    );
    await pg.query(
      `insert into vehicule (id, tenant_id, marque, modele, statut)
       values ($1, $2, 'Test', 'Modele0069', 'actif')`,
      [VEHICULE_ID, tenant.id],
    );
  });
  const SITE_REELLE_ID = tenant.sites[0]?.id;
  if (!SITE_REELLE_ID) {
    throw new Error('[test 0069] semerGarageDemo devait fournir au moins un site pour tenantA.');
  }

  const chargesFigees = {
    adresse: { rue: 'Test', npa: '1000', localite: 'Lausanne', pays: 'CH' },
    conditions: { conditionsGenerales: 'CGV test 0069' },
  };

  // 4. OR OUVERT (statut 'planifie', non verrouillé) + sa ligne fautive — chemin dfa_app normal.
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (pg) => {
    await pg.query(
      `insert into ordre_reparation
         (id, tenant_id, numero, site_id, type, statut, client_id, vehicule_id,
          client_designation_figee, adresse_facturation_figee, conditions_figees)
       values ($1, $2, 'OR-0069-OUVERT', $3, 'reparation', 'planifie', $4, $5, 'Test Client0069', $6, $7)`,
      [
        OR_OUVERT_ID,
        tenant.id,
        SITE_REELLE_ID,
        CLIENT_ID,
        VEHICULE_ID,
        chargesFigees.adresse,
        chargesFigees.conditions,
      ],
    );
    await pg.query(
      `insert into ligne_or
         (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut, payeur,
          designation, prix_unitaire_centimes, quantite_millieme, rabais_pourmille, taux_tva_pourmille,
          montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes)
       values ($1, $2, $3, 1, 'remise', 'commandee', 'validee', 'client', 'Remise test (OR ouvert)',
               -500, 1000, 0, 81, $4, $5, $6)`,
      [
        LIGNE_OUVERT_ID,
        tenant.id,
        OR_OUVERT_ID,
        OUVERT_AVANT.ht,
        OUVERT_AVANT.tva,
        OUVERT_AVANT.ttc,
      ],
    );
  });

  // 5. OR TÉMOIN (statut 'planifie') + ligne déjà correcte — chemin dfa_app normal.
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (pg) => {
    await pg.query(
      `insert into ordre_reparation
         (id, tenant_id, numero, site_id, type, statut, client_id, vehicule_id,
          client_designation_figee, adresse_facturation_figee, conditions_figees)
       values ($1, $2, 'OR-0069-TEMOIN', $3, 'reparation', 'planifie', $4, $5, 'Test Client0069', $6, $7)`,
      [
        OR_TEMOIN_ID,
        tenant.id,
        SITE_REELLE_ID,
        CLIENT_ID,
        VEHICULE_ID,
        chargesFigees.adresse,
        chargesFigees.conditions,
      ],
    );
    await pg.query(
      `insert into ligne_or
         (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut, payeur,
          designation, prix_unitaire_centimes, quantite_millieme, rabais_pourmille, taux_tva_pourmille,
          montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes)
       values ($1, $2, $3, 1, 'forfait', 'commandee', 'validee', 'client', 'Ligne témoin (déjà correcte)',
               10000, 1000, 0, 81, $4, $5, $6)`,
      [LIGNE_TEMOIN_ID, tenant.id, OR_TEMOIN_ID, TEMOIN.ht, TEMOIN.tva, TEMOIN.ttc],
    );
  });

  // 6. OR VERROUILLÉ (statut 'facture' DÈS la création — un statut initial n'est pas une
  //    transition, `verifier_transition` (BEFORE UPDATE only) ne s'applique donc pas à l'INSERT)
  //    + sa ligne fautive, via `dfa_migrator` (propriétaire, seul rôle qui peut désactiver le
  //    trigger de verrouillage `ligne_or_verrouiller_or` — INSERT sur un OR déjà 'facture' serait
  //    autrement bloqué par ZDFA2, exactement comme le serait la correction elle-même : c'est ce
  //    que le bloc B de la migration contourne, on reproduit ici le même geste pour construire le
  //    fixture).
  const migClient = await bdd.poolMigrateur.connect();
  try {
    await migClient.query('begin');
    await migClient.query(
      `insert into ordre_reparation
         (id, tenant_id, numero, site_id, type, statut, client_id, vehicule_id,
          client_designation_figee, adresse_facturation_figee, conditions_figees)
       values ($1, $2, 'OR-0069-VERROUILLE', $3, 'reparation', 'facture', $4, $5, 'Test Client0069', $6, $7)`,
      [
        OR_VERROUILLE_ID,
        tenant.id,
        SITE_REELLE_ID,
        CLIENT_ID,
        VEHICULE_ID,
        chargesFigees.adresse,
        chargesFigees.conditions,
      ],
    );
    await migClient.query('alter table public.ligne_or disable trigger ligne_or_verrouiller_or');
    await migClient.query(
      `insert into ligne_or
         (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut, payeur,
          designation, prix_unitaire_centimes, quantite_millieme, rabais_pourmille, taux_tva_pourmille,
          montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes)
       values ($1, $2, $3, 1, 'remise', 'commandee', 'facturee', 'client', 'Remise test (OR verrouillé)',
               -250, 1000, 0, 26, $4, $5, $6)`,
      [
        LIGNE_VERROUILLE_ID,
        tenant.id,
        OR_VERROUILLE_ID,
        VERROUILLE_AVANT.ht,
        VERROUILLE_AVANT.tva,
        VERROUILLE_AVANT.ttc,
      ],
    );
    await migClient.query('alter table public.ligne_or enable trigger ligne_or_verrouiller_or');
    await migClient.query('commit');
  } catch (erreur) {
    await migClient.query('rollback').catch(() => undefined);
    throw erreur;
  } finally {
    migClient.release();
  }
}, 180_000);

afterAll(async () => {
  await client?.end();
  await bdd?.fermer();
});

async function lireLigne(ligneId: string): Promise<LigneOrEtat> {
  const lignes = await requeteSousTenant<{
    montant_ht_centimes: number;
    montant_tva_centimes: number;
    montant_ttc_centimes: number;
    modifie_le: string;
  }>(
    bdd.poolApp,
    tenant.id,
    `select montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, modifie_le::text
       from ligne_or where id = $1`,
    [ligneId],
  );
  const ligne = lignes[0];
  if (!ligne) throw new Error(`[test 0069] ligne_or ${ligneId} introuvable.`);
  return {
    montantHtCentimes: ligne.montant_ht_centimes,
    montantTvaCentimes: ligne.montant_tva_centimes,
    montantTtcCentimes: ligne.montant_ttc_centimes,
    modifieLe: ligne.modifie_le,
  };
}

async function lireTotalValideCentimes(ordreReparationId: string): Promise<number> {
  const rows = await requeteSousTenant<{ total_valide_centimes: string }>(
    bdd.poolApp,
    tenant.id,
    `select total_valide_centimes::text from ordre_reparation where id = $1`,
    [ordreReparationId],
  );
  const row = rows[0];
  if (!row) throw new Error(`[test 0069] ordre_reparation ${ordreReparationId} introuvable.`);
  return Number(row.total_valide_centimes);
}

async function lireJournal(): Promise<JournalCorrection[]> {
  const rows = await requeteSousTenant<{
    categorie: string;
    ligne_or_id: string;
    montant_ht_avant_centimes: number;
    montant_tva_avant_centimes: number;
    montant_ttc_avant_centimes: number;
    montant_ht_apres_centimes: number;
    montant_tva_apres_centimes: number;
    montant_ttc_apres_centimes: number;
  }>(
    bdd.poolApp,
    tenant.id,
    `select categorie, ligne_or_id,
            montant_ht_avant_centimes, montant_tva_avant_centimes, montant_ttc_avant_centimes,
            montant_ht_apres_centimes, montant_tva_apres_centimes, montant_ttc_apres_centimes
       from ligne_or_correction_arrondi_negatif
      order by categorie`,
  );
  return rows.map((r) => ({
    categorie: r.categorie,
    ligneOrId: r.ligne_or_id,
    montantHtAvantCentimes: r.montant_ht_avant_centimes,
    montantTvaAvantCentimes: r.montant_tva_avant_centimes,
    montantTtcAvantCentimes: r.montant_ttc_avant_centimes,
    montantHtApresCentimes: r.montant_ht_apres_centimes,
    montantTvaApresCentimes: r.montant_tva_apres_centimes,
    montantTtcApresCentimes: r.montant_ttc_apres_centimes,
  }));
}

describe('migration 0069 — correction arrondi TVA négatif sur ligne_or', () => {
  it("état AVANT 0069 : les fixtures portent bien les valeurs Math.round d'origine", async () => {
    const ouvert = await lireLigne(LIGNE_OUVERT_ID);
    expect([
      ouvert.montantHtCentimes,
      ouvert.montantTvaCentimes,
      ouvert.montantTtcCentimes,
    ]).toEqual([OUVERT_AVANT.ht, OUVERT_AVANT.tva, OUVERT_AVANT.ttc]);

    const verrouille = await lireLigne(LIGNE_VERROUILLE_ID);
    expect([
      verrouille.montantHtCentimes,
      verrouille.montantTvaCentimes,
      verrouille.montantTtcCentimes,
    ]).toEqual([VERROUILLE_AVANT.ht, VERROUILLE_AVANT.tva, VERROUILLE_AVANT.ttc]);

    // Preuve en exécution, AVANT toute correction, que le trigger de recalcul répercute déjà le
    // (mauvais) TTC sur les DEUX branches — la base de comparaison du point de mesure ci-dessous.
    expect(await lireTotalValideCentimes(OR_OUVERT_ID)).toBe(OUVERT_AVANT.ttc);
    expect(await lireTotalValideCentimes(OR_VERROUILLE_ID)).toBe(VERROUILLE_AVANT.ttc);
    expect(await lireTotalValideCentimes(OR_TEMOIN_ID)).toBe(TEMOIN.ttc);
  });

  it('applique 0069 (up) : corrige les deux lignes fautives, laisse le témoin intact, met à jour total_valide_centimes sur OUVERT et VERROUILLÉ', async () => {
    const temoinAvant = await lireLigne(LIGNE_TEMOIN_ID);

    await client.query(readFileSync(CHEMIN_0069, 'utf8'));

    const ouvertApres = await lireLigne(LIGNE_OUVERT_ID);
    expect([
      ouvertApres.montantHtCentimes,
      ouvertApres.montantTvaCentimes,
      ouvertApres.montantTtcCentimes,
    ]).toEqual([OUVERT_APRES.ht, OUVERT_APRES.tva, OUVERT_APRES.ttc]);

    const verrouilleApres = await lireLigne(LIGNE_VERROUILLE_ID);
    expect([
      verrouilleApres.montantHtCentimes,
      verrouilleApres.montantTvaCentimes,
      verrouilleApres.montantTtcCentimes,
    ]).toEqual([VERROUILLE_APRES.ht, VERROUILLE_APRES.tva, VERROUILLE_APRES.ttc]);

    // Témoin : inchangé bit-à-bit, y compris `modifie_le` (aucun UPDATE ne l'a touché — pas
    // seulement « les valeurs sont restées identiques par coïncidence »).
    const temoinApres = await lireLigne(LIGNE_TEMOIN_ID);
    expect(temoinApres).toEqual(temoinAvant);

    // RÉSERVE DU BRIEF (point 4) — mesurée, pas raisonnée : total_valide_centimes suit la
    // correction sur les DEUX catégories, y compris la branche VERROUILLÉE (bypass de trigger).
    expect(await lireTotalValideCentimes(OR_OUVERT_ID)).toBe(OUVERT_APRES.ttc);
    expect(await lireTotalValideCentimes(OR_VERROUILLE_ID)).toBe(VERROUILLE_APRES.ttc);
    expect(await lireTotalValideCentimes(OR_TEMOIN_ID)).toBe(TEMOIN.ttc);

    // Journal : une ligne par ligne corrigée, catégorie correcte, aucune pour le témoin.
    const journal = await lireJournal();
    expect(journal).toHaveLength(2);
    const parCategorie = Object.fromEntries(journal.map((j) => [j.categorie, j]));
    expect(parCategorie.or_ouvert).toMatchObject({
      ligneOrId: LIGNE_OUVERT_ID,
      montantHtAvantCentimes: OUVERT_AVANT.ht,
      montantTvaAvantCentimes: OUVERT_AVANT.tva,
      montantTtcAvantCentimes: OUVERT_AVANT.ttc,
      montantHtApresCentimes: OUVERT_APRES.ht,
      montantTvaApresCentimes: OUVERT_APRES.tva,
      montantTtcApresCentimes: OUVERT_APRES.ttc,
    });
    expect(parCategorie.or_verrouille).toMatchObject({
      ligneOrId: LIGNE_VERROUILLE_ID,
      montantHtAvantCentimes: VERROUILLE_AVANT.ht,
      montantTvaAvantCentimes: VERROUILLE_AVANT.tva,
      montantTtcAvantCentimes: VERROUILLE_AVANT.ttc,
      montantHtApresCentimes: VERROUILLE_APRES.ht,
      montantTvaApresCentimes: VERROUILLE_APRES.tva,
      montantTtcApresCentimes: VERROUILLE_APRES.ttc,
    });
  });

  it('idempotence : rejouer seulement le bloc de correction ne duplique rien et ne retouche aucune ligne déjà corrigée', async () => {
    const ouvertAvantRejeu = await lireLigne(LIGNE_OUVERT_ID);
    const verrouilleAvantRejeu = await lireLigne(LIGNE_VERROUILLE_ID);
    const journalAvantRejeu = await lireJournal();

    const sqlComplet = readFileSync(CHEMIN_0069, 'utf8');
    const blocRejouable = extraireBlocRejouable(sqlComplet);
    await client.query(blocRejouable);

    const ouvertApresRejeu = await lireLigne(LIGNE_OUVERT_ID);
    const verrouilleApresRejeu = await lireLigne(LIGNE_VERROUILLE_ID);
    // `modifie_le` STRICTEMENT identique : la preuve qu'aucun second UPDATE n'a touché la ligne
    // (des valeurs inchangées par coïncidence ne suffiraient pas à le prouver).
    expect(ouvertApresRejeu).toEqual(ouvertAvantRejeu);
    expect(verrouilleApresRejeu).toEqual(verrouilleAvantRejeu);

    const journalApresRejeu = await lireJournal();
    expect(journalApresRejeu).toHaveLength(journalAvantRejeu.length);
    expect(journalApresRejeu).toEqual(journalAvantRejeu);

    // Nettoyage des fonctions jetables re-déclarées par le rejeu partiel (voir le commentaire de
    // NETTOYAGE_FONCTIONS_JETABLES) — restaure l'état « aucun résidu » qu'un `up` complet unique
    // atteint tout seul, condition pour que le `down` ci-dessous s'exécute sans faux positif.
    await client.query(NETTOYAGE_FONCTIONS_JETABLES);
  });

  it("down : restaure les deux lignes à leurs valeurs Math.round d'origine, dépose la table journal, ne touche pas le témoin", async () => {
    await client.query(readFileSync(CHEMIN_0069_DOWN, 'utf8'));

    const ouvert = await lireLigne(LIGNE_OUVERT_ID);
    expect([
      ouvert.montantHtCentimes,
      ouvert.montantTvaCentimes,
      ouvert.montantTtcCentimes,
    ]).toEqual([OUVERT_AVANT.ht, OUVERT_AVANT.tva, OUVERT_AVANT.ttc]);

    const verrouille = await lireLigne(LIGNE_VERROUILLE_ID);
    expect([
      verrouille.montantHtCentimes,
      verrouille.montantTvaCentimes,
      verrouille.montantTtcCentimes,
    ]).toEqual([VERROUILLE_AVANT.ht, VERROUILLE_AVANT.tva, VERROUILLE_AVANT.ttc]);

    const temoin = await lireLigne(LIGNE_TEMOIN_ID);
    expect([
      temoin.montantHtCentimes,
      temoin.montantTvaCentimes,
      temoin.montantTtcCentimes,
    ]).toEqual([TEMOIN.ht, TEMOIN.tva, TEMOIN.ttc]);

    // total_valide_centimes suit aussi le down (même trigger, jamais désactivé pour lui).
    expect(await lireTotalValideCentimes(OR_OUVERT_ID)).toBe(OUVERT_AVANT.ttc);
    expect(await lireTotalValideCentimes(OR_VERROUILLE_ID)).toBe(VERROUILLE_AVANT.ttc);

    const { rows } = await client.query<{ table_present: string | null }>(
      `select to_regclass('public.ligne_or_correction_arrondi_negatif') as table_present`,
    );
    expect(rows[0]?.table_present).toBeNull();
  });

  it("rejoue le up après le down : re-corrige à l'identique", async () => {
    await client.query(readFileSync(CHEMIN_0069, 'utf8'));

    const ouvert = await lireLigne(LIGNE_OUVERT_ID);
    expect([
      ouvert.montantHtCentimes,
      ouvert.montantTvaCentimes,
      ouvert.montantTtcCentimes,
    ]).toEqual([OUVERT_APRES.ht, OUVERT_APRES.tva, OUVERT_APRES.ttc]);

    const verrouille = await lireLigne(LIGNE_VERROUILLE_ID);
    expect([
      verrouille.montantHtCentimes,
      verrouille.montantTvaCentimes,
      verrouille.montantTtcCentimes,
    ]).toEqual([VERROUILLE_APRES.ht, VERROUILLE_APRES.tva, VERROUILLE_APRES.ttc]);

    expect(await lireTotalValideCentimes(OR_OUVERT_ID)).toBe(OUVERT_APRES.ttc);
    expect(await lireTotalValideCentimes(OR_VERROUILLE_ID)).toBe(VERROUILLE_APRES.ttc);

    const journal = await lireJournal();
    expect(journal).toHaveLength(2);
  });
});
