/**
 * Fixture métier réutilisable : un « garage de démo » complet et RÉALISTE, avec DEUX tenants
 * bien distincts. Ce n'est pas un détail — c'est la condition pour que les tests d'isolation
 * (rls.spec.ts, isolation-api.spec.ts) aient un sens : un test d'isolation avec un seul tenant
 * ne peut, par construction, jamais détecter une fuite.
 *
 * Chaque tenant a 2 sites et 2 utilisateurs, avec des rôles différents pour pouvoir alimenter
 * plus tard la matrice rôle × action (étape 1+).
 *
 * Écrit avec le rôle SUPERUTILISATEUR du conteneur (bdd.poolSuperutilisateur), pas
 * `dfa_migrator` : `tenant` et `site` sont sous FORCE ROW LEVEL SECURITY (contrat §3), donc
 * même leur propriétaire ne peut pas y insérer de ligne sans contexte tenant déjà posé — et
 * poser un contexte tenant pour créer CE tenant est un problème de l'œuf et de la poule.
 * Amorcer les toutes premières données d'un tenant est structurellement une opération
 * privilégiée, en test comme en production (où ce serait un script d'admin type `db:seed`,
 * jamais l'API applicative elle-même).
 */

import { randomUUID } from 'node:crypto';
import { hash as hacherArgon2 } from '@node-rs/argon2';
import type { RoleUtilisateur, StatutTenant, StatutUtilisateur, Langue } from '@dfa/shared';
import type { BaseEphemere } from '../setup/postgres-ephemere';

export interface SiteFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly nom: string;
  readonly actif: boolean;
}

export interface UtilisateurFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  /** Conservé UNIQUEMENT côté fixture de test, jamais en base — sert à se connecter dans les
   *  tests d'auth via le vrai endpoint HTTP. */
  readonly motDePasseClair: string;
  readonly prenom: string;
  readonly nom: string;
  readonly role: RoleUtilisateur;
  readonly statut: StatutUtilisateur;
}

export interface TenantFixture {
  readonly id: string;
  readonly slug: string;
  readonly raisonSociale: string;
  readonly statut: StatutTenant;
  readonly langueDefaut: Langue;
  readonly sites: readonly SiteFixture[];
  readonly utilisateurs: readonly UtilisateurFixture[];
}

export interface GarageDemoFixture {
  readonly tenantA: TenantFixture;
  readonly tenantB: TenantFixture;
}

async function hacherMotDePasseDeTest(motDePasseClair: string): Promise<string> {
  // Paramètres par défaut d'argon2id : suffisant pour des fixtures de test (les hash argon2
  // encodent leurs propres paramètres, `ServiceMotDePasse.verifier` les vérifie quels qu'ils
  // soient — pas besoin de faire correspondre exactement ARGON2_MEMOIRE_KIB/ITERATIONS/
  // PARALLELISME de la config applicative).
  // `algorithm: 2` = Argon2id (voir la constante ARGON2ID de mot-de-passe.service.ts : le
  // membre d'énumération lui-même est inaccessible sous isolatedModules).
  return hacherArgon2(motDePasseClair, { algorithm: 2 });
}

interface TenantAInserer {
  readonly slug: string;
  readonly raisonSociale: string;
  readonly langueDefaut: Langue;
  readonly sites: ReadonlyArray<{ code: string; nom: string }>;
  readonly utilisateurs: ReadonlyArray<{
    prenom: string;
    nom: string;
    role: RoleUtilisateur;
    email: string;
  }>;
}

const MOT_DE_PASSE_FIXTURE = 'CorrectHorseBatteryStaple!42';

const DEFINITION_TENANT_A: TenantAInserer = {
  slug: 'garage-martin',
  raisonSociale: 'Garage Martin SA',
  langueDefaut: 'fr',
  sites: [
    { code: 'LAU', nom: 'Garage Martin — Atelier Lausanne' },
    { code: 'REN', nom: 'Garage Martin — Carrosserie Renens' },
  ],
  utilisateurs: [
    { prenom: 'Sophie', nom: 'Martin', role: 'admin', email: 'sophie.martin@garage-martin.test' },
    { prenom: 'Marco', nom: 'Rossi', role: 'technicien', email: 'marco.rossi@garage-martin.test' },
  ],
};

const DEFINITION_TENANT_B: TenantAInserer = {
  slug: 'carrosserie-dupont',
  raisonSociale: 'Carrosserie Dupont Sàrl',
  langueDefaut: 'fr',
  sites: [
    { code: 'GVA', nom: 'Carrosserie Dupont — Genève' },
    { code: 'NYO', nom: 'Carrosserie Dupont — Nyon' },
  ],
  utilisateurs: [
    {
      prenom: 'Julien',
      nom: 'Dupont',
      role: 'direction',
      email: 'julien.dupont@carrosserie-dupont.test',
    },
    {
      prenom: 'Aline',
      nom: 'Fontaine',
      role: 'chef_atelier',
      email: 'aline.fontaine@carrosserie-dupont.test',
    },
  ],
};

async function semerTenant(
  bdd: BaseEphemere,
  definition: TenantAInserer,
  motDePasseHash: string,
): Promise<TenantFixture> {
  const tenantId = randomUUID();
  await bdd.poolSuperutilisateur.query(
    `insert into tenant (id, slug, raison_sociale, numero_tva, pays, langue_defaut, statut)
     values ($1, $2, $3, null, 'CH', $4, 'actif')`,
    [tenantId, definition.slug, definition.raisonSociale, definition.langueDefaut],
  );

  const sites: SiteFixture[] = [];
  for (const site of definition.sites) {
    const siteId = randomUUID();
    await bdd.poolSuperutilisateur.query(
      `insert into site (id, tenant_id, code, nom, rue, npa, localite, pays, actif)
       values ($1, $2, $3, $4, null, null, null, 'CH', true)`,
      [siteId, tenantId, site.code, site.nom],
    );
    sites.push({ id: siteId, tenantId, code: site.code, nom: site.nom, actif: true });
  }

  const utilisateurs: UtilisateurFixture[] = [];
  for (const utilisateur of definition.utilisateurs) {
    const utilisateurId = randomUUID();
    await bdd.poolSuperutilisateur.query(
      `insert into utilisateur
         (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut, echecs_connexion, verrouille_jusqu_a)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'actif', 0, null)`,
      [
        utilisateurId,
        tenantId,
        utilisateur.email,
        motDePasseHash,
        utilisateur.prenom,
        utilisateur.nom,
        definition.langueDefaut,
        utilisateur.role,
      ],
    );
    utilisateurs.push({
      id: utilisateurId,
      tenantId,
      email: utilisateur.email,
      motDePasseClair: MOT_DE_PASSE_FIXTURE,
      prenom: utilisateur.prenom,
      nom: utilisateur.nom,
      role: utilisateur.role,
      statut: 'actif',
    });
  }

  return {
    id: tenantId,
    slug: definition.slug,
    raisonSociale: definition.raisonSociale,
    statut: 'actif',
    langueDefaut: definition.langueDefaut,
    sites,
    utilisateurs,
  };
}

export async function semerGarageDemo(bdd: BaseEphemere): Promise<GarageDemoFixture> {
  const motDePasseHash = await hacherMotDePasseDeTest(MOT_DE_PASSE_FIXTURE);
  const [tenantA, tenantB] = await Promise.all([
    semerTenant(bdd, DEFINITION_TENANT_A, motDePasseHash),
    semerTenant(bdd, DEFINITION_TENANT_B, motDePasseHash),
  ]);
  return { tenantA, tenantB };
}

/** Ajoute un utilisateur supplémentaire à un tenant existant — utile pour des scénarios de
 *  test isolés qui ne doivent pas polluer les utilisateurs "génériques" de la fixture partagée
 *  (typiquement : un test de verrouillage de compte par échecs de connexion répétés). */
export async function ajouterUtilisateurFixture(
  bdd: BaseEphemere,
  tenantId: string,
  options: {
    readonly prenom: string;
    readonly nom: string;
    readonly role: RoleUtilisateur;
    readonly email: string;
  },
): Promise<UtilisateurFixture> {
  const motDePasseHash = await hacherMotDePasseDeTest(MOT_DE_PASSE_FIXTURE);
  const utilisateurId = randomUUID();
  await bdd.poolSuperutilisateur.query(
    `insert into utilisateur
       (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut, echecs_connexion, verrouille_jusqu_a)
     values ($1, $2, $3, $4, $5, $6, 'fr', $7, 'actif', 0, null)`,
    [
      utilisateurId,
      tenantId,
      options.email,
      motDePasseHash,
      options.prenom,
      options.nom,
      options.role,
    ],
  );
  return {
    id: utilisateurId,
    tenantId,
    email: options.email,
    motDePasseClair: MOT_DE_PASSE_FIXTURE,
    prenom: options.prenom,
    nom: options.nom,
    role: options.role,
    statut: 'actif',
  };
}
