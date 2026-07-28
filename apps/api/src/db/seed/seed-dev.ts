/**
 * Jeu de données de démonstration : un garage valaisan à deux sites.
 *
 * Objectifs :
 *   - permettre de se connecter à l'application dès `pnpm db:seed`, sans écran d'inscription
 *     (qui n'existe pas à l'étape 0 et n'existera jamais : les comptes sont créés par le garage) ;
 *   - donner aux tests manuels des données réalistes, en vocabulaire de garagiste suisse.
 *
 * IDEMPOTENT : rejouable autant de fois que voulu. Chaque enregistrement est identifié par sa
 * clé métier (slug du tenant, code du site, email de l'utilisateur) et mis à jour s'il existe
 * déjà. Un seed qu'on ne peut lancer qu'une fois est un seed qu'on n'utilise pas.
 *
 * Se connecte avec `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`) : créer un tenant est une
 * opération d'exploitation, pas une opération applicative, et `dfa_app` n'a de toute façon
 * aucune visibilité hors de son tenant courant.
 */

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { basename } from 'node:path';
import { Client } from 'pg';

import * as schema from '../schema';
import {
  client as clientMetier,
  clientAdresse,
  parametreAtelier,
  parametreSite,
  prestation,
  prestationPrix,
  site,
  tauxHoraire,
  tenant,
  utilisateur,
  vehicule,
  vehiculeDetention,
  vehiculeExpertise,
  vehiculeKilometrage,
  vehiculePlaque,
  vehiculeTravailReporte,
} from '../schema';

/**
 * Mot de passe de démonstration, volontairement présent en clair dans le dépôt : il ne protège
 * rien, il ouvre un jeu de données factice sur une base de développement. Le vrai garde-fou est
 * que ce script REFUSE de s'exécuter en production (voir `semerDev`).
 */
export const MOT_DE_PASSE_DEMO = 'Demo1234!Garage';

export const SLUG_TENANT_DEMO = 'garage-martin';

/** Paramètres Argon2id du contrat §2.7 (recommandations OWASP courantes). */
const ARGON2_MEMOIRE_KIB = 19_456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISME = 1;

/** Signature attendue de `ServiceMotDePasse.hacher` (contrat §2.10). */
export type HacherMotDePasse = (clair: string) => Promise<string>;

export interface OptionsSeed {
  /** URL de connexion du rôle `dfa_migrator`. */
  readonly urlMigration: string;
  readonly nodeEnv: string;
  /**
   * Fonction de hachage. À fournir de préférence depuis `ServiceMotDePasse` : le seed produit
   * alors exactement les mêmes hachages que l'application, avec les paramètres de la
   * configuration réelle. Sans elle, on retombe sur Argon2id aux paramètres par défaut
   * ci-dessus — le hachage des mots de passe n'appartient pas à la couche base de données, et
   * cette dépendance reste donc optionnelle et inversée.
   */
  readonly hacherMotDePasse?: HacherMotDePasse;
  readonly journaliser?: (message: string) => void;
}

// ---------------------------------------------------------------------------------------------
// Hachage
// ---------------------------------------------------------------------------------------------

interface ModuleArgon2Napi {
  hash(clair: string, options: Record<string, unknown>): Promise<string>;
}

/**
 * Charge Argon2id depuis `@node-rs/argon2` (binaires précompilés — pas de chaîne de compilation
 * native à installer sous Windows) ou, à défaut, depuis `argon2`.
 *
 * Le spécificateur est typé `string` et non littéral : TypeScript n'exige donc pas que ces
 * modules soient résolvables à la compilation. `src/db/` n'a pas à dépendre d'une bibliothèque
 * de hachage — c'est le domaine de `src/auth/`.
 */
async function chargerHacheurParDefaut(): Promise<HacherMotDePasse> {
  const nodeRs: string = '@node-rs/argon2';
  try {
    const mod = (await import(nodeRs)) as ModuleArgon2Napi;
    return (clair) =>
      mod.hash(clair, {
        memoryCost: ARGON2_MEMOIRE_KIB,
        timeCost: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISME,
        algorithm: 2, // Algorithm.Argon2id
      });
  } catch {
    // On essaie l'implémentation alternative avant d'abandonner.
  }

  const classique: string = 'argon2';
  try {
    const mod = (await import(classique)) as ModuleArgon2Napi;
    return (clair) =>
      mod.hash(clair, {
        memoryCost: ARGON2_MEMOIRE_KIB,
        timeCost: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISME,
        type: 2, // argon2id
      });
  } catch {
    throw new Error(
      `Aucune implémentation Argon2 disponible (@node-rs/argon2 ou argon2).\n` +
        `Installer @node-rs/argon2, ou appeler semerDev({ hacherMotDePasse }) en fournissant ` +
        `ServiceMotDePasse.hacher.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Données de démonstration
// ---------------------------------------------------------------------------------------------

const SITES_DEMO = [
  {
    code: 'SION',
    nom: 'Garage Martin — Sion',
    rue: 'Route de Riddes 42',
    npa: '1950',
    localite: 'Sion',
  },
  {
    code: 'MARTIGNY',
    nom: 'Garage Martin — Martigny',
    rue: 'Avenue du Grand-Saint-Bernard 18',
    npa: '1920',
    localite: 'Martigny',
  },
] as const;

const UTILISATEURS_DEMO = [
  {
    email: 'admin@garage-martin.ch',
    prenom: 'Pierre',
    nom: 'Martin',
    role: 'admin',
    langue: 'fr',
  },
  {
    email: 'chef.atelier@garage-martin.ch',
    prenom: 'Sophie',
    nom: 'Rossier',
    role: 'chef_atelier',
    langue: 'fr',
  },
] as const;

// --- Atelier + clients (lot 1) -------------------------------------------------------------
// Le scénario de démo (plan-lot1-execution.md §3.1) : M. Meier appelle, sa Golf sort en tapant
// « 123456 » dans la barre du comptoir, avec détenteur, dernier kilométrage, une expertise échue
// depuis 42 jours et deux travaux reportés dont un marqué sécurité.

const TAUX_HORAIRE_DEMO = [
  { code: 'ATELIER', libelle: 'Taux horaire atelier', montantCentimes: 13500, valideDu: '2020-01-01', valideAu: '2025-12-31' },
  { code: 'ATELIER', libelle: 'Taux horaire atelier', montantCentimes: 14500, valideDu: '2026-01-01', valideAu: null },
] as const;

const PRESTATIONS_DEMO = [
  { code: 'VID-ESS', designationFr: 'Vidange huile + filtre (essence)', tempsBaremeCentiemes: 80, prixCentimes: 9000 },
  { code: 'FREIN-AV', designationFr: 'Remplacement plaquettes de frein avant', tempsBaremeCentiemes: 100, prixCentimes: 45000 },
  { code: 'PNEUS-CHG', designationFr: 'Changement de pneus (4 roues)', tempsBaremeCentiemes: 50, prixCentimes: 32000 },
  { code: 'DIAG-OBD', designationFr: 'Diagnostic électronique OBD', tempsBaremeCentiemes: 60, prixCentimes: 12000 },
  { code: 'EXPERTISE-PREP', designationFr: "Préparation à l'expertise MFK", tempsBaremeCentiemes: 120, prixCentimes: 15000 },
] as const;

const CLIENTS_DEMO = [
  {
    numero: 'CL-0001',
    type: 'particulier' as const,
    civilite: 'M.',
    nom: 'Meier',
    prenom: 'Urs',
    langue: 'de',
    telephone: '079 123 45 67',
    telephoneE164: '+41791234567',
    adresse: { rue: 'Bahnhofstrasse 12', npa: '1950', localite: 'Sion' },
  },
  {
    numero: 'CL-0002',
    type: 'particulier' as const,
    civilite: 'Mme',
    nom: 'Dupont',
    prenom: 'Claire',
    langue: 'fr',
    telephone: '078 987 65 43',
    telephoneE164: '+41789876543',
    adresse: { rue: 'Avenue de la Gare 5', npa: '1920', localite: 'Martigny' },
  },
  {
    numero: 'CL-0003',
    type: 'entreprise' as const,
    raisonSociale: 'Transports Rhône Sàrl',
    ide: 'CHE-101.202.303',
    langue: 'fr',
    telephone: '027 555 12 34',
    telephoneE164: '+41275551234',
    adresse: { rue: 'Route Industrielle 8', npa: '1950', localite: 'Sion' },
  },
] as const;

const VEHICULES_DEMO = [
  {
    vin: 'WVWZZZ1KZAW123456',
    marque: 'Volkswagen',
    modele: 'Golf',
    version: 'VII 2.0 TDI',
    carburant: 'diesel',
    couleur: 'gris',
    clientNumero: 'CL-0001',
    plaque: 'VS 123456',
    kilometrages: [
      { valeur: 82_000, releveLe: '2026-01-15T09:00:00Z', source: 'reception' as const },
      { valeur: 85_000, releveLe: '2026-05-10T10:30:00Z', source: 'declaratif' as const },
    ],
    // Expertise échue depuis 42 jours (aujourd'hui = 2026-07-28 → échéance 2026-06-16).
    expertise: {
      dateExpertise: '2022-06-16',
      resultat: 'accepte' as const,
      prochaineEcheance: '2026-06-16',
      sourceEcheance: 'calculee' as const,
    },
    travauxReportes: [
      {
        designation: 'Plaquettes de frein avant usées',
        urgence: 'a_faire' as const,
        securite: true,
        montantEstimeCentimes: 45_000,
        kmConstat: 85_000,
        dateConstat: '2026-05-10',
      },
      {
        designation: 'Ampoule de feu de position hors service',
        urgence: 'a_surveiller' as const,
        securite: false,
        montantEstimeCentimes: 3_500,
        kmConstat: 85_000,
        dateConstat: '2026-05-10',
      },
    ],
  },
  {
    vin: 'TMBJJ7NE1M0123457',
    marque: 'Skoda',
    modele: 'Octavia',
    version: 'Combi 1.5 TSI',
    carburant: 'essence',
    couleur: 'bleu',
    clientNumero: 'CL-0002',
    plaque: 'VS 55512',
    kilometrages: [{ valeur: 41_500, releveLe: '2026-04-02T08:15:00Z', source: 'reception' as const }],
  },
  {
    vin: null,
    marque: 'Renault',
    modele: 'Master',
    version: 'Fourgon L2H2',
    carburant: 'diesel',
    couleur: 'blanc',
    clientNumero: 'CL-0003',
    plaque: 'VS 90001',
    kilometrages: [{ valeur: 128_300, releveLe: '2026-06-20T07:00:00Z', source: 'reception' as const }],
  },
  {
    vin: 'WBA8E9106K5E12348',
    marque: 'BMW',
    modele: 'Série 3',
    version: '320d Touring',
    carburant: 'diesel',
    couleur: 'noir',
    clientNumero: 'CL-0001',
    plaque: 'GE 445566',
    kilometrages: [{ valeur: 63_200, releveLe: '2026-03-11T11:45:00Z', source: 'reception' as const }],
  },
] as const;

// ---------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------

export async function semerDev(options: OptionsSeed): Promise<{ tenantId: string }> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  // Garde-fou non négociable : ce script crée des comptes dont le mot de passe est public.
  if (options.nodeEnv === 'production') {
    throw new Error(
      `Le seed de démonstration est interdit en production : il crée des comptes dont le mot de passe est publié dans le dépôt.`,
    );
  }

  const hacher = options.hacherMotDePasse ?? (await chargerHacheurParDefaut());

  const client = new Client({
    connectionString: options.urlMigration,
    application_name: 'dfa-seed',
  });
  await client.connect();
  const base = drizzle(client, { schema });

  try {
    // Le tout dans UNE transaction : un seed interrompu ne laisse pas un tenant sans site ni
    // sans compte administrateur, état dont personne ne saurait quoi faire.
    await client.query('begin');

    // --- Tenant --------------------------------------------------------------------------------
    const [ligneTenant] = await base
      .insert(tenant)
      .values({
        slug: SLUG_TENANT_DEMO,
        raisonSociale: 'Garage Martin SA',
        numeroTva: 'CHE-123.456.789 TVA',
        pays: 'CH',
        langueDefaut: 'fr',
        statut: 'actif',
      })
      .onConflictDoUpdate({
        target: tenant.slug,
        set: {
          raisonSociale: 'Garage Martin SA',
          pays: 'CH',
          langueDefaut: 'fr',
          // On réactive : un rejeu du seed doit rendre le tenant utilisable même s'il a été
          // suspendu à la main pour tester le code d'erreur AUTH_TENANT_SUSPENDU.
          statut: 'actif',
        },
      })
      .returning({ id: tenant.id });

    if (ligneTenant === undefined) {
      throw new Error(`Le tenant de démonstration n'a pas pu être créé.`);
    }
    const tenantId = ligneTenant.id;
    journaliser(`Tenant « ${SLUG_TENANT_DEMO} » (${tenantId})`);

    // --- Sites ---------------------------------------------------------------------------------
    const idsSitesParCode = new Map<string, string>();
    for (const s of SITES_DEMO) {
      const [ligneSite] = await base
        .insert(site)
        .values({
          tenantId,
          code: s.code,
          nom: s.nom,
          rue: s.rue,
          npa: s.npa,
          localite: s.localite,
          pays: 'CH',
          actif: true,
        })
        .onConflictDoUpdate({
          target: [site.tenantId, site.code],
          set: { nom: s.nom, rue: s.rue, npa: s.npa, localite: s.localite, actif: true },
        })
        .returning({ id: site.id });
      const idSite = ligneSite?.id ?? (await base.select({ id: site.id }).from(site).where(and(eq(site.tenantId, tenantId), eq(site.code, s.code))))[0]?.id;
      if (idSite === undefined) {
        throw new Error(`Site « ${s.code} » introuvable après upsert.`);
      }
      idsSitesParCode.set(s.code, idSite);
      journaliser(`  site ${s.code} — ${s.nom}`);
    }

    // --- Utilisateurs --------------------------------------------------------------------------
    for (const u of UTILISATEURS_DEMO) {
      // Hachage à chaque exécution : le sel change, le mot de passe non. C'est idempotent au
      // sens qui compte — l'état final permet toujours de se connecter avec MOT_DE_PASSE_DEMO.
      const motDePasseHash = await hacher(MOT_DE_PASSE_DEMO);

      await base
        .insert(utilisateur)
        .values({
          tenantId,
          email: u.email,
          motDePasseHash,
          prenom: u.prenom,
          nom: u.nom,
          langue: u.langue,
          role: u.role,
          statut: 'actif',
        })
        .onConflictDoUpdate({
          target: utilisateur.email,
          set: {
            motDePasseHash,
            prenom: u.prenom,
            nom: u.nom,
            langue: u.langue,
            role: u.role,
            // Remise à l'état nominal : un compte verrouillé pendant les tests de force brute
            // redevient utilisable après un simple `pnpm db:seed`.
            statut: 'actif',
            echecsConnexion: 0,
            verrouilleJusquA: null,
          },
        });
      journaliser(`  utilisateur ${u.email} (${u.role})`);
    }

    // Contrôle de cohérence : le tenant de démonstration doit avoir au moins un administrateur,
    // faute de quoi personne ne peut rien faire de ce jeu de données.
    const admins = await base
      .select({ id: utilisateur.id })
      .from(utilisateur)
      .where(eq(utilisateur.tenantId, tenantId));

    if (admins.length < UTILISATEURS_DEMO.length) {
      throw new Error(
        `Incohérence : ${String(admins.length)} utilisateur(s) pour le tenant de démonstration, ` +
          `${String(UTILISATEURS_DEMO.length)} attendus. Un email est probablement déjà pris par un autre tenant.`,
      );
    }

    // --- Paramètres d'atelier --------------------------------------------------------------
    // plafond_defaut_centimes = 30000 (300.—) : le scénario §3.1 en a besoin (le plafond de l'OR
    // de démo est franchi par la constatation du technicien).
    await base
      .insert(parametreAtelier)
      .values({ tenantId, plafondDefautCentimes: 30_000, controleQualite: 'jamais' })
      .onConflictDoUpdate({
        target: parametreAtelier.tenantId,
        set: { plafondDefautCentimes: 30_000, controleQualite: 'jamais' },
      });
    journaliser(`  paramètres d'atelier (plafond par défaut 300.—)`);

    for (const idSite of idsSitesParCode.values()) {
      await base
        .insert(parametreSite)
        .values({ tenantId, siteId: idSite })
        // Rien à harmoniser sur rejeu : un opérateur a pu personnaliser les horaires du site
        // depuis le seed initial, ce script ne doit pas les écraser.
        .onConflictDoNothing({ target: parametreSite.siteId });
    }

    // --- Taux horaires (2, datés — pas de contrainte UNIQUE simple, EXCLUDE seulement : on
    // s'assure de la présence par lecture avant écriture, idempotent au sens applicatif) --------
    for (const th of TAUX_HORAIRE_DEMO) {
      const existant = await base
        .select({ id: tauxHoraire.id })
        .from(tauxHoraire)
        .where(
          and(
            eq(tauxHoraire.tenantId, tenantId),
            eq(tauxHoraire.code, th.code),
            eq(tauxHoraire.valideDu, th.valideDu),
          ),
        );
      if (existant.length === 0) {
        await base.insert(tauxHoraire).values({
          tenantId,
          code: th.code,
          libelle: th.libelle,
          montantCentimes: th.montantCentimes,
          valideDu: th.valideDu,
          valideAu: th.valideAu,
        });
      }
    }
    journaliser(`  ${String(TAUX_HORAIRE_DEMO.length)} taux horaires`);

    // --- Prestations (5) + prix -------------------------------------------------------------
    for (const p of PRESTATIONS_DEMO) {
      const [lignePrestation] = await base
        .insert(prestation)
        .values({
          tenantId,
          code: p.code,
          designationFr: p.designationFr,
          typeLigne: 'forfait',
          tempsBaremeCentiemes: p.tempsBaremeCentiemes,
          tauxHoraireCode: 'ATELIER',
        })
        .onConflictDoUpdate({
          target: [prestation.tenantId, prestation.code],
          set: { designationFr: p.designationFr, tempsBaremeCentiemes: p.tempsBaremeCentiemes },
        })
        .returning({ id: prestation.id });

      const idPrestation = lignePrestation?.id;
      if (idPrestation === undefined) {
        throw new Error(`Prestation « ${p.code} » introuvable après upsert.`);
      }

      const prixExistant = await base
        .select({ id: prestationPrix.id })
        .from(prestationPrix)
        .where(
          and(eq(prestationPrix.tenantId, tenantId), eq(prestationPrix.prestationId, idPrestation)),
        );
      if (prixExistant.length === 0) {
        await base.insert(prestationPrix).values({
          tenantId,
          prestationId: idPrestation,
          prixCentimes: p.prixCentimes,
          valideDu: '2026-01-01',
          valideAu: null,
        });
      }
    }
    journaliser(`  ${String(PRESTATIONS_DEMO.length)} prestations`);

    // --- Clients (3) + adresse principale ----------------------------------------------------
    const idsClientsParNumero = new Map<string, string>();
    for (const c of CLIENTS_DEMO) {
      const [ligneClient] = await base
        .insert(clientMetier)
        .values({
          tenantId,
          numero: c.numero,
          type: c.type,
          civilite: 'civilite' in c ? c.civilite : null,
          nom: 'nom' in c ? c.nom : null,
          prenom: 'prenom' in c ? c.prenom : null,
          raisonSociale: 'raisonSociale' in c ? c.raisonSociale : null,
          ide: 'ide' in c ? c.ide : null,
          langue: c.langue,
          telephone: c.telephone,
          telephoneE164: c.telephoneE164,
          statut: 'actif',
        })
        .onConflictDoUpdate({
          target: [clientMetier.tenantId, clientMetier.numero],
          set: { telephone: c.telephone, telephoneE164: c.telephoneE164, statut: 'actif' },
        })
        .returning({ id: clientMetier.id });

      const idClient = ligneClient?.id;
      if (idClient === undefined) {
        throw new Error(`Client « ${c.numero} » introuvable après upsert.`);
      }
      idsClientsParNumero.set(c.numero, idClient);

      const adresseExistante = await base
        .select({ id: clientAdresse.id })
        .from(clientAdresse)
        .where(
          and(
            eq(clientAdresse.tenantId, tenantId),
            eq(clientAdresse.clientId, idClient),
            eq(clientAdresse.type, 'principale'),
          ),
        );
      if (adresseExistante.length === 0) {
        await base.insert(clientAdresse).values({
          tenantId,
          clientId: idClient,
          type: 'principale',
          rue: c.adresse.rue,
          npa: c.adresse.npa,
          localite: c.adresse.localite,
          pays: 'CH',
          actif: true,
        });
      }
    }
    journaliser(`  ${String(CLIENTS_DEMO.length)} clients`);

    // --- Véhicules (4) + plaque + détention + kilométrages -----------------------------------
    for (const v of VEHICULES_DEMO) {
      const critereVehicule = v.vin
        ? and(eq(vehicule.tenantId, tenantId), eq(vehicule.vin, v.vin))
        : and(eq(vehicule.tenantId, tenantId), eq(vehicule.marque, v.marque), eq(vehicule.modele, v.modele), eq(vehicule.version, v.version));

      const existant = await base.select({ id: vehicule.id }).from(vehicule).where(critereVehicule);
      let idVehicule = existant[0]?.id;

      if (idVehicule === undefined) {
        const [ligneVehicule] = await base
          .insert(vehicule)
          .values({
            tenantId,
            vin: v.vin,
            marque: v.marque,
            modele: v.modele,
            version: v.version,
            carburant: v.carburant,
            couleur: v.couleur,
            statut: 'actif',
          })
          .returning({ id: vehicule.id });
        idVehicule = ligneVehicule?.id;
      }
      if (idVehicule === undefined) {
        throw new Error(`Véhicule « ${v.marque} ${v.modele} » introuvable après insertion.`);
      }

      const idClient = idsClientsParNumero.get(v.clientNumero);
      if (idClient === undefined) {
        throw new Error(`Client « ${v.clientNumero} » introuvable pour le véhicule ${v.marque} ${v.modele}.`);
      }

      const plaqueExistante = await base
        .select({ id: vehiculePlaque.id })
        .from(vehiculePlaque)
        .where(and(eq(vehiculePlaque.tenantId, tenantId), eq(vehiculePlaque.vehiculeId, idVehicule), eq(vehiculePlaque.valeur, v.plaque)));
      if (plaqueExistante.length === 0) {
        await base.insert(vehiculePlaque).values({
          tenantId,
          vehiculeId: idVehicule,
          valeur: v.plaque,
          canton: v.plaque.slice(0, 2),
          pays: 'CH',
          du: '2020-01-01',
          au: null,
        });
      }

      const detentionExistante = await base
        .select({ id: vehiculeDetention.id })
        .from(vehiculeDetention)
        .where(
          and(
            eq(vehiculeDetention.tenantId, tenantId),
            eq(vehiculeDetention.vehiculeId, idVehicule),
            eq(vehiculeDetention.clientId, idClient),
          ),
        );
      if (detentionExistante.length === 0) {
        await base.insert(vehiculeDetention).values({
          tenantId,
          vehiculeId: idVehicule,
          clientId: idClient,
          du: '2020-01-01',
          au: null,
        });
      }

      for (const km of v.kilometrages) {
        const releveExistant = await base
          .select({ id: vehiculeKilometrage.id })
          .from(vehiculeKilometrage)
          .where(
            and(
              eq(vehiculeKilometrage.tenantId, tenantId),
              eq(vehiculeKilometrage.vehiculeId, idVehicule),
              eq(vehiculeKilometrage.releveLe, new Date(km.releveLe)),
            ),
          );
        if (releveExistant.length === 0) {
          await base.insert(vehiculeKilometrage).values({
            tenantId,
            vehiculeId: idVehicule,
            valeur: km.valeur,
            unite: 'km',
            releveLe: new Date(km.releveLe),
            source: km.source,
          });
        }
      }

      if ('expertise' in v && v.expertise) {
        const expertiseExistante = await base
          .select({ id: vehiculeExpertise.id })
          .from(vehiculeExpertise)
          .where(
            and(
              eq(vehiculeExpertise.tenantId, tenantId),
              eq(vehiculeExpertise.vehiculeId, idVehicule),
              eq(vehiculeExpertise.dateExpertise, v.expertise.dateExpertise),
            ),
          );
        if (expertiseExistante.length === 0) {
          await base.insert(vehiculeExpertise).values({
            tenantId,
            vehiculeId: idVehicule,
            dateExpertise: v.expertise.dateExpertise,
            resultat: v.expertise.resultat,
            prochaineEcheance: v.expertise.prochaineEcheance,
            sourceEcheance: v.expertise.sourceEcheance,
          });
        }
      }

      if ('travauxReportes' in v) {
        for (const travail of v.travauxReportes) {
          const travailExistant = await base
            .select({ id: vehiculeTravailReporte.id })
            .from(vehiculeTravailReporte)
            .where(
              and(
                eq(vehiculeTravailReporte.tenantId, tenantId),
                eq(vehiculeTravailReporte.vehiculeId, idVehicule),
                eq(vehiculeTravailReporte.designation, travail.designation),
              ),
            );
          if (travailExistant.length === 0) {
            await base.insert(vehiculeTravailReporte).values({
              tenantId,
              vehiculeId: idVehicule,
              designation: travail.designation,
              urgence: travail.urgence,
              securite: travail.securite,
              montantEstimeCentimes: travail.montantEstimeCentimes,
              kmConstat: travail.kmConstat,
              dateConstat: travail.dateConstat,
              statut: 'ouvert',
            });
          }
        }
      }
    }
    journaliser(`  ${String(VEHICULES_DEMO.length)} véhicules (plaques, détentions, kilométrages)`);

    await client.query('commit');

    journaliser('');
    journaliser(`Connexion : ${UTILISATEURS_DEMO[0].email} / ${MOT_DE_PASSE_DEMO}`);

    return { tenantId };
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------------------------
// Point d'entrée CLI
// ---------------------------------------------------------------------------------------------

function estPointDEntree(): boolean {
  const argument = process.argv[1];
  return argument !== undefined && /^seed-dev(\.[cm]?[jt]s)?$/.test(basename(argument));
}

async function principal(): Promise<void> {
  const { chargerFichierEnv } = await import('../../config/charger-fichier-env');
  chargerFichierEnv();
  const { chargerConfig } = await import('../../config/charger-config');
  const config = chargerConfig(process.env);

  await semerDev({
    urlMigration: config.DATABASE_URL_MIGRATION,
    nodeEnv: config.NODE_ENV,
  });
}

if (estPointDEntree()) {
  principal().catch((erreur: unknown) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    process.stderr.write(`\nÉchec du seed : ${message}\n`);
    process.exitCode = 1;
  });
}
