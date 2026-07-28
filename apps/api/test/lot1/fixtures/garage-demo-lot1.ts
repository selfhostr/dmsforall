/**
 * Fixture métier du lot 1 — prolonge `test/fixtures/garage-demo.ts` (tenant/site/utilisateur,
 * étape 0) avec ce que l'atelier et les clients du lot 1 ont besoin :
 *
 *   - les 8 rôles complets (`ROLES_UTILISATEUR`), sur CHACUN des deux tenants — indispensable à
 *     la matrice rôle × action. Le test d'intégration qui la consommera reste BLOQUÉ tant que les
 *     contrôleurs du lot 1 n'existent pas (`@ExigerDroit` posé sur de vraies routes HTTP, voir
 *     `common/droits/garde-droit.ts`) — signalé dans la réponse de tâche de L1-15, à reprendre
 *     après L1-16. La fixture, elle, n'a aucune raison d'attendre : les 8 identités existent dès
 *     maintenant, prêtes à ouvrir une session réelle le jour où ce test s'écrit ;
 *   - des clients réalistes (particuliers et entreprises, IDE suisse valide) ;
 *   - des véhicules avec VIN (17 caractères, alphabet sans I/O/Q — RM-15) et une plaque suisse
 *     HISTORISÉE (`vehicule_plaque`, canton, période) ;
 *   - un historique de relevés kilométriques croissant (`vehicule_kilometrage`, append-only) ;
 *   - un détenteur courant par véhicule (`vehicule_detention`) ;
 *   - deux aides (`creerOrPourTest`, `creerLignePourTest`) qui insèrent un OR / une ligne d'OR
 *     valides, prêts à être transités par les tests de machine à états et d'isolation — sans
 *     dupliquer, dans chaque spec, la connaissance des colonnes NOT NULL de `ordre_reparation` et
 *     `ligne_or`.
 *
 * ÉCRITE VIA `ecrireSousTenant` (pool `dfa_app`, sous RLS), PAS `poolSuperutilisateur` : à la
 * différence de `tenant`/`site` (FORCE ROW LEVEL SECURITY, même le propriétaire ne peut pas y
 * écrire sans contexte), les tables du lot 1 sont accessibles en écriture à `dfa_app` sous
 * contexte tenant — exactement le chemin qu'emprunterait un service applicatif. Amorcer cette
 * fixture EST donc déjà, en soi, une preuve que le RLS et les triggers d'intégrité (contraintes
 * CHECK, EXCLUDE, `verifier_transition`) n'empêchent pas une écriture légitime — une garantie que
 * `garage-demo.ts` (superutilisateur) ne peut pas offrir sur `tenant`/`site`.
 *
 * Deux tenants, pas un seul : condition pour que les tests d'isolation qui consomment cette
 * fixture (`test/lot1/isolation/`) aient un sens, au même titre que `garage-demo.ts`.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ROLES_UTILISATEUR, type RoleUtilisateur } from '@dfa/shared';
import { ecrireSousTenant, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  ajouterUtilisateurFixture,
  semerGarageDemo,
  type GarageDemoFixture,
  type TenantFixture,
  type UtilisateurFixture,
} from '../../fixtures/garage-demo';

// -------------------------------------------------------------------------------------------
// 1. Complétion des 8 rôles sur un tenant qui n'en porte déjà que 2 (garage-demo.ts)
// -------------------------------------------------------------------------------------------

type IdentitesParRole = Readonly<
  Record<RoleUtilisateur, { readonly prenom: string; readonly nom: string }>
>;

/** Identités de complément, DISTINCTES entre les deux tenants : un même nom sur les deux tenants
 *  produirait un email dupliqué (`utilisateur.email` est unique GLOBALEMENT — décision assumée du
 *  socle, voir 0000_socle.sql). Les rôles déjà fournis par `garage-demo.ts` sont documentés ici
 *  mais jamais réinsérés (voir `completerLes8Roles`). */
const IDENTITES_COMPLEMENT_TENANT_A: IdentitesParRole = {
  admin: { prenom: 'Sophie', nom: 'Martin' }, // déjà présent (garage-demo.ts)
  technicien: { prenom: 'Marco', nom: 'Rossi' }, // déjà présent
  direction: { prenom: 'Henri', nom: 'Blanc' },
  vendeur: { prenom: 'Laura', nom: 'Pittet' },
  receptionnaire: { prenom: 'Yannick', nom: 'Currat' },
  chef_atelier: { prenom: 'Denis', nom: 'Oberson' },
  magasinier: { prenom: 'Fabrice', nom: 'Gillard' },
  comptable: { prenom: 'Nadia', nom: 'Zimmermann' },
};

const IDENTITES_COMPLEMENT_TENANT_B: IdentitesParRole = {
  direction: { prenom: 'Julien', nom: 'Dupont' }, // déjà présent (garage-demo.ts)
  chef_atelier: { prenom: 'Aline', nom: 'Fontaine' }, // déjà présent
  admin: { prenom: 'Marc', nom: 'Cherpillod' },
  vendeur: { prenom: 'Céline', nom: 'Berset' },
  receptionnaire: { prenom: 'Thibault', nom: 'Voumard' },
  technicien: { prenom: 'Igor', nom: 'Perroud' },
  magasinier: { prenom: 'Samuel', nom: 'Dubey' },
  comptable: { prenom: 'Roxane', nom: 'Wicht' },
};

async function completerLes8Roles(
  bdd: BaseEphemere,
  tenant: TenantFixture,
  identites: IdentitesParRole,
): Promise<Record<RoleUtilisateur, UtilisateurFixture>> {
  const parRole = {} as Record<RoleUtilisateur, UtilisateurFixture>;
  for (const utilisateur of tenant.utilisateurs) {
    parRole[utilisateur.role] = utilisateur;
  }
  for (const role of ROLES_UTILISATEUR) {
    if (parRole[role]) continue; // déjà fourni par garage-demo.ts
    const identite = identites[role];
    const email = `${identite.prenom}.${identite.nom}@${tenant.slug}.test`.toLowerCase();

    parRole[role] = await ajouterUtilisateurFixture(bdd, tenant.id, { ...identite, role, email });
  }
  return parRole;
}

// -------------------------------------------------------------------------------------------
// 2. VIN déterministes (RM-15 : `vin ~ '^[A-HJ-NPR-Z0-9]{17}$'`, alphabet SANS I/O/Q)
// -------------------------------------------------------------------------------------------

const ALPHABET_VIN = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

/** VIN de 17 caractères, déterministe à partir d'une graine — reproductible entre exécutions,
 *  sans jamais produire I/O/Q. Ce n'est PAS un VIN réel (pas de check-digit ISO 3779) : suffisant
 *  pour un test qui vérifie le FORMAT et l'unicité, pas la validité constructeur. */
function construireVin(graine: string): string {
  let acc = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < graine.length; i += 1) {
    acc ^= graine.charCodeAt(i);
    acc = Math.imul(acc, 16777619) >>> 0;
  }
  let vin = '';
  for (let i = 0; i < 17; i += 1) {
    acc = (Math.imul(acc, 1103515245) + 12345) >>> 0;
    vin += ALPHABET_VIN[acc % ALPHABET_VIN.length];
  }
  return vin;
}

// -------------------------------------------------------------------------------------------
// 3. Clients
// -------------------------------------------------------------------------------------------

export interface ClientFixtureLot1 {
  readonly id: string;
  readonly tenantId: string;
  readonly numero: string;
  readonly type: 'particulier' | 'entreprise';
  readonly designation: string;
}

interface ClientAInserer {
  readonly numero: string;
  readonly type: 'particulier' | 'entreprise';
  readonly civilite?: string;
  readonly nom?: string;
  readonly prenom?: string;
  readonly raisonSociale?: string;
  readonly ide?: string;
  readonly email?: string;
  readonly telephoneE164?: string;
}

const CLIENTS_TENANT_A: readonly ClientAInserer[] = [
  {
    numero: 'CLI-0001',
    type: 'particulier',
    civilite: 'M.',
    nom: 'Bertrand',
    prenom: 'Nicolas',
    email: 'nicolas.bertrand@example.ch',
    telephoneE164: '+41791234501',
  },
  {
    numero: 'CLI-0002',
    type: 'entreprise',
    raisonSociale: 'Transports Follonier Sàrl',
    ide: 'CHE-123.456.789',
    email: 'contact@follonier-transports.ch',
  },
  {
    numero: 'CLI-0003',
    type: 'particulier',
    civilite: 'Mme',
    nom: 'Kunz',
    prenom: 'Elena',
    email: 'elena.kunz@example.ch',
  },
];

const CLIENTS_TENANT_B: readonly ClientAInserer[] = [
  {
    numero: 'CLI-0001',
    type: 'particulier',
    civilite: 'Mme',
    nom: 'Moreau',
    prenom: 'Sophie',
    email: 'sophie.moreau@example.ch',
    telephoneE164: '+41791234502',
  },
  {
    numero: 'CLI-0002',
    type: 'entreprise',
    raisonSociale: 'Régie Lac Léman SA',
    ide: 'CHE-987.654.321',
    email: 'info@regie-lacleman.ch',
  },
];

async function semerClients(
  bdd: BaseEphemere,
  tenant: TenantFixture,
  clients: readonly ClientAInserer[],
): Promise<ClientFixtureLot1[]> {
  return ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    const resultat: ClientFixtureLot1[] = [];
    for (const c of clients) {
      const id = randomUUID();

      await client.query(
        `insert into client (id, tenant_id, numero, type, civilite, nom, prenom, raison_sociale, ide, langue, email, telephone_e164, statut)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'fr', $10, $11, 'actif')`,
        [
          id,
          tenant.id,
          c.numero,
          c.type,
          c.civilite ?? null,
          c.nom ?? null,
          c.prenom ?? null,
          c.raisonSociale ?? null,
          c.ide ?? null,
          c.email ?? null,
          c.telephoneE164 ?? null,
        ],
      );
      resultat.push({
        id,
        tenantId: tenant.id,
        numero: c.numero,
        type: c.type,
        designation: c.raisonSociale ?? `${c.nom} ${c.prenom}`,
      });
    }
    return resultat;
  });
}

// -------------------------------------------------------------------------------------------
// 4. Véhicules — VIN, plaque suisse courante, détenteur, historique kilométrique
// -------------------------------------------------------------------------------------------

export interface VehiculeFixtureLot1 {
  readonly id: string;
  readonly tenantId: string;
  readonly vin: string;
  readonly marque: string;
  readonly modele: string;
  readonly plaqueCourante: string;
  readonly detenteurClientId: string;
}

interface VehiculeAInserer {
  readonly graineVin: string;
  readonly marque: string;
  readonly modele: string;
  readonly plaque: string;
  readonly canton: string;
  readonly detenteurIndex: number; // index dans le tableau de clients du même tenant
  /** Trois relevés croissants, du plus ancien au plus récent, en km. */
  readonly historiqueKm: readonly [number, number, number];
}

function definirVehiculesTenantA(): readonly VehiculeAInserer[] {
  return [
    {
      graineVin: 'garage-martin-veh-1',
      marque: 'Volkswagen',
      modele: 'Golf',
      plaque: "VD 123'456",
      canton: 'VD',
      detenteurIndex: 0,
      historiqueKm: [12_400, 28_900, 41_200],
    },
    {
      graineVin: 'garage-martin-veh-2',
      marque: 'Skoda',
      modele: 'Octavia',
      plaque: "VD 654'321",
      canton: 'VD',
      detenteurIndex: 1,
      historiqueKm: [5_100, 19_800, 33_450],
    },
    {
      graineVin: 'garage-martin-veh-3',
      marque: 'Renault',
      modele: 'Clio',
      plaque: "NE 45'678",
      canton: 'NE',
      detenteurIndex: 2,
      historiqueKm: [800, 6_200, 14_900],
    },
  ];
}

function definirVehiculesTenantB(): readonly VehiculeAInserer[] {
  return [
    {
      graineVin: 'carrosserie-dupont-veh-1',
      marque: 'BMW',
      modele: '320d',
      plaque: "GE 998'214",
      canton: 'GE',
      detenteurIndex: 0,
      historiqueKm: [22_000, 35_600, 47_300],
    },
    {
      graineVin: 'carrosserie-dupont-veh-2',
      marque: 'Mercedes-Benz',
      modele: 'Sprinter',
      plaque: "GE 445'566",
      canton: 'GE',
      detenteurIndex: 1,
      historiqueKm: [61_200, 88_400, 103_750],
    },
  ];
}

async function semerVehicules(
  bdd: BaseEphemere,
  tenant: TenantFixture,
  clients: readonly ClientFixtureLot1[],
  definitions: readonly VehiculeAInserer[],
): Promise<VehiculeFixtureLot1[]> {
  return ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    const resultat: VehiculeFixtureLot1[] = [];
    for (const def of definitions) {
      const detenteur = clients[def.detenteurIndex];
      if (!detenteur) {
        throw new Error(
          `Fixture lot 1 : aucun client à l'index ${def.detenteurIndex} pour le véhicule "${def.marque} ${def.modele}".`,
        );
      }
      const vehiculeId = randomUUID();
      const vin = construireVin(def.graineVin);

      await client.query(
        `insert into vehicule (id, tenant_id, vin, marque, modele, statut) values ($1, $2, $3, $4, $5, 'actif')`,
        [vehiculeId, tenant.id, vin, def.marque, def.modele],
      );

      await client.query(
        `insert into vehicule_plaque (id, tenant_id, vehicule_id, valeur, canton, pays, du, au)
         values ($1, $2, $3, $4, $5, 'CH', current_date - interval '3 years', null)`,
        [randomUUID(), tenant.id, vehiculeId, def.plaque, def.canton],
      );

      await client.query(
        `insert into vehicule_detention (id, tenant_id, vehicule_id, client_id, du, au)
         values ($1, $2, $3, $4, current_date - interval '3 years', null)`,
        [randomUUID(), tenant.id, vehiculeId, detenteur.id],
      );

      // Historique kilométrique croissant (RM-23/24), append-only : trois relevés espacés dans le
      // temps, chacun via une source différente pour rester réaliste (déclaratif à la vente,
      // relevé de réception, relevé lors d'un OR précédent).
      const sources: readonly [string, string, string] = [
        'declaratif',
        'reception',
        'ordre_reparation',
      ];
      const decalagesMois: readonly [number, number, number] = [30, 12, 2];
      for (let i = 0; i < 3; i += 1) {
        await client.query(
          `insert into vehicule_kilometrage (id, tenant_id, vehicule_id, valeur, unite, releve_le, source)
           values ($1, $2, $3, $4, 'km', now() - ($5 || ' months')::interval, $6)`,
          [randomUUID(), tenant.id, vehiculeId, def.historiqueKm[i], decalagesMois[i], sources[i]],
        );
      }

      resultat.push({
        id: vehiculeId,
        tenantId: tenant.id,
        vin,
        marque: def.marque,
        modele: def.modele,
        plaqueCourante: def.plaque,
        detenteurClientId: detenteur.id,
      });
    }
    return resultat;
  });
}

// -------------------------------------------------------------------------------------------
// 5. Aides « OR valide » / « ligne d'OR valide » — réutilisées par les tests de machine à états
//    et d'isolation, pour ne pas disperser la connaissance des colonnes NOT NULL de 0008_atelier.sql
//    dans chaque fichier de spec.
// -------------------------------------------------------------------------------------------

export interface OrDeTest {
  readonly id: string;
  readonly tenantId: string;
  readonly numero: string;
}

/** Insère un OR valide, statut initial `planifie` (seul statut sans transition entrante — c'est
 *  l'état où toute machine à états démarre, voir 0003_prealables_etape1.sql §5.1). */
export async function creerOrPourTest(
  bdd: BaseEphemere,
  tenant: TenantFixture,
  siteId: string,
  client: ClientFixtureLot1,
  vehicule: VehiculeFixtureLot1,
): Promise<OrDeTest> {
  const id = randomUUID();
  const numero = `OR-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (pgClient: PoolClient) => {
    await pgClient.query(
      `insert into ordre_reparation
         (id, tenant_id, numero, site_id, type, statut, client_id, vehicule_id,
          client_designation_figee, adresse_facturation_figee, conditions_figees)
       values ($1, $2, $3, $4, 'reparation', 'planifie', $5, $6, $7, $8, $9)`,
      [
        id,
        tenant.id,
        numero,
        siteId,
        client.id,
        vehicule.id,
        client.designation,
        { rue: 'Test', npa: '1000', localite: 'Lausanne', pays: 'CH' },
        { conditionsGenerales: 'CGV standard de test' },
      ],
    );
  });
  return { id, tenantId: tenant.id, numero };
}

export interface LigneOrDeTest {
  readonly id: string;
  readonly tenantId: string;
  readonly ordreReparationId: string;
}

/** Insère une ligne d'OR valide, statut initial `proposee`. `type: 'forfait'` évite d'avoir à
 *  fournir `taux_horaire_centimes` (exigé seulement pour les types main d'œuvre, voir
 *  `ligne_or_taux_horaire_requis_chk`). Montants cohérents avec `taux_tva_pourmille` par défaut
 *  (81 ‰) : HT 10 000 c. + TVA 810 c. = TTC 10 810 c. */
export async function creerLignePourTest(
  bdd: BaseEphemere,
  tenant: TenantFixture,
  ordreReparationId: string,
  numeroOrdre = 1,
): Promise<LigneOrDeTest> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (pgClient: PoolClient) => {
    await pgClient.query(
      `insert into ligne_or
         (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut,
          designation, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes)
       values ($1, $2, $3, $4, 'forfait', 'commandee', 'proposee', $5, 10000, 810, 10810)`,
      [id, tenant.id, ordreReparationId, numeroOrdre, `Ligne de test #${numeroOrdre}`],
    );
  });
  return { id, tenantId: tenant.id, ordreReparationId };
}

// -------------------------------------------------------------------------------------------
// 6. Orchestration
// -------------------------------------------------------------------------------------------

export interface DonneesLot1Tenant {
  readonly tenant: TenantFixture;
  readonly utilisateursParRole: Record<RoleUtilisateur, UtilisateurFixture>;
  readonly clients: readonly ClientFixtureLot1[];
  readonly vehicules: readonly VehiculeFixtureLot1[];
}

export interface GarageDemoLot1Fixture {
  readonly socle: GarageDemoFixture;
  readonly tenantA: DonneesLot1Tenant;
  readonly tenantB: DonneesLot1Tenant;
}

/** Amorce le socle étape 0 (`semerGarageDemo`) PUIS les données lot 1. À appeler UNE fois par
 *  fichier de spec (`beforeAll`), au même titre que `semerGarageDemo` pour `rls.spec.ts`. */
export async function semerGarageDemoLot1(bdd: BaseEphemere): Promise<GarageDemoLot1Fixture> {
  const socle = await semerGarageDemo(bdd);

  const [utilisateursA, utilisateursB] = await Promise.all([
    completerLes8Roles(bdd, socle.tenantA, IDENTITES_COMPLEMENT_TENANT_A),
    completerLes8Roles(bdd, socle.tenantB, IDENTITES_COMPLEMENT_TENANT_B),
  ]);

  const clientsA = await semerClients(bdd, socle.tenantA, CLIENTS_TENANT_A);
  const clientsB = await semerClients(bdd, socle.tenantB, CLIENTS_TENANT_B);

  const [vehiculesA, vehiculesB] = await Promise.all([
    semerVehicules(bdd, socle.tenantA, clientsA, definirVehiculesTenantA()),
    semerVehicules(bdd, socle.tenantB, clientsB, definirVehiculesTenantB()),
  ]);

  return {
    socle,
    tenantA: {
      tenant: socle.tenantA,
      utilisateursParRole: utilisateursA,
      clients: clientsA,
      vehicules: vehiculesA,
    },
    tenantB: {
      tenant: socle.tenantB,
      utilisateursParRole: utilisateursB,
      clients: clientsB,
      vehicules: vehiculesB,
    },
  };
}
