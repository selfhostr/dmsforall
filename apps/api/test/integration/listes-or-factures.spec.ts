/**
 * Listes `GET /ordres-reparation` et `GET /documents-vente` — chargement par lot + pagination
 * keyset, sur vraie base Postgres éphémère (aucun mock de la couche base : un test qui moquerait
 * `tx` ne prouverait rien sur la requête réelle).
 *
 * Prouve, pour chaque liste :
 *  1. IDENTITÉ : la liste par lot rend, élément par élément, EXACTEMENT ce que rend l'assemblage
 *     unitaire historique (`assemblerDocument(..., pourListe = true)`), pour un rôle qui voit les
 *     montants et un rôle qui ne les voit pas ;
 *  2. PAGINATION : page 1 -> page 2 -> fin, sans doublon ni trou, y compris sur des lignes
 *     ex aequo sur la clé de tri et des clés `NULL`, pour CHAQUE tri du contrat ;
 *  3. CURSEURS : ancien format (offset), forgé, ou d'un autre tri -> `400 curseur_invalide` ;
 *  4. ISOLATION : un autre tenant ne voit jamais ces lignes ;
 *  5. PLAFOND DE REQUÊTES : le nombre de requêtes d'une page ne dépend PAS de sa taille.
 */

import { randomUUID } from 'node:crypto';
import { Client as ClientPg } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRIS_DOCUMENTS_VENTE, TRIS_ORDRES_REPARATION, type RoleUtilisateur } from '@dfa/shared';

import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from '../lot1/fixtures/garage-demo-lot1';
import {
  construireCookiePour,
  creerDocumentVente,
  emettreDocument,
} from './ventes/fixtures-cycle-vente';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../../src/db';
import type { PrincipalAuthentifie } from '../../src/common/contexte/contexte-requete.types';
import { ServiceOr } from '../../src/atelier/service-or';
import { ServiceDocumentsVente } from '../../src/facturation/documents/service-documents';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let garage: GarageDemoLot1Fixture;
let cookiePour: ReturnType<typeof construireCookiePour>;

const NOMBRE_OR = 61;
const NOMBRE_DOCUMENTS = 18;
const orIdsA: string[] = [];

function ctxTenant(tenantId: string): ContexteTenant {
  return { tenantId, utilisateurId: null, requeteId: null };
}
function principal(role: RoleUtilisateur): PrincipalAuthentifie {
  return { role } as PrincipalAuthentifie;
}
const aller = (objet: unknown): unknown => JSON.parse(JSON.stringify(objet));

async function get(
  tenant: 'A' | 'B',
  role: RoleUtilisateur,
  chemin: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const cookie = await cookiePour(tenant === 'A' ? garage.tenantA : garage.tenantB, role);
  const reponse = await ctx.requete
    .get(chemin)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

interface Page {
  donnees: { id: string }[];
  curseurSuivant: string | null;
}

/** Parcourt toute la liste page par page et rend les ids dans l'ordre. */
async function parcourir(base: string, role: RoleUtilisateur, limite: number): Promise<string[]> {
  const ids: string[] = [];
  let curseur: string | null = null;
  for (let garde = 0; garde < 500; garde += 1) {
    const sep = base.includes('?') ? '&' : '?';
    const url: string = `${base}${sep}limite=${String(limite)}${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ''}`;
    const r = await get('A', role, url);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const page = r.body as unknown as Page;
    ids.push(...page.donnees.map((d) => d.id));
    if (!page.curseurSuivant) return ids;
    curseur = page.curseurSuivant;
  }
  throw new Error('pagination sans fin');
}

/** Compte les requêtes SQL émises par `fn` (hors begin/commit/set_config). */
async function compterRequetes<T>(
  fn: () => Promise<T>,
): Promise<{ resultat: T; requetes: number }> {
  const original = ClientPg.prototype.query;
  let compteur = 0;
  (ClientPg.prototype as unknown as { query: (...a: unknown[]) => unknown }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    const premier = args[0];
    const texte =
      typeof premier === 'string' ? premier : ((premier as { text?: string })?.text ?? '');
    if (!/^\s*(begin|commit|rollback|select set_config|set )/i.test(texte)) compteur += 1;
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  };
  try {
    const resultat = await fn();
    return { resultat, requetes: compteur };
  } finally {
    ClientPg.prototype.query = original;
  }
}

async function semerOrdres(): Promise<void> {
  const tenant = garage.tenantA.tenant;
  const site = tenant.sites[0]!.id;
  const clients = garage.tenantA.clients;
  const vehicules = garage.tenantA.vehicules;
  const utilisateur = garage.tenantA.utilisateursParRole.direction.id;
  const statuts = ['planifie', 'ouvert', 'en_cours', 'termine', 'facture'] as const;
  const c = await bdd.poolSuperutilisateur.connect();
  try {
    // Insertion de fixtures directe : triggers de machine à états désactivés (le sujet ici est la
    // LISTE, pas les transitions, couvertes ailleurs).
    await c.query("set session_replication_role = 'replica'");
    for (let i = 0; i < NOMBRE_OR; i += 1) {
      const id = randomUUID();
      orIdsA.push(id);
      const statut = statuts[i % statuts.length]!;
      const client = clients[i % clients.length]!;
      const vehicule = vehicules[i % vehicules.length]!;
      // Trois OR consécutifs partagent EXACTEMENT le même `ouvert_le` (ex aequo) ; les `planifie`
      // n'en ont pas (clé NULL). Microsecondes non nulles : piège `timestamptz` -> `Date`.
      const ouvertLe =
        statut === 'planifie'
          ? null
          : `2026-03-01 08:00:00.${String(100000 + Math.floor(i / 3) * 7)}+00`;
      await c.query(
        `insert into ordre_reparation
           (id, tenant_id, numero, site_id, type, statut, client_id, vehicule_id,
            client_designation_figee, adresse_facturation_figee, conditions_figees,
            ouvert_le, termine_le, restitution_promise_le)
         values ($1,$2,$3,$4,'reparation',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          tenant.id,
          `OR-LISTE-${String(i).padStart(4, '0')}`,
          site,
          statut,
          client.id,
          vehicule.id,
          client.designation,
          { rue: 'Test', npa: '1000', localite: 'Lausanne', pays: 'CH' },
          { conditionsGenerales: 'CGV' },
          ouvertLe,
          statut === 'termine' || statut === 'facture'
            ? `2026-03-0${String(1 + (i % 5))} 10:00:00.${String(200000 + i)}+00`
            : null,
          i % 4 === 0 ? `2026-04-01 12:00:00.${String(300000 + (i % 6))}+00` : null,
        ],
      );
      // Lignes : certaines avec un payeur tiers (assurance), pour exercer `totauxParPayeur`.
      const nbLignes = i % 4;
      for (let l = 1; l <= nbLignes; l += 1) {
        const tiers = l === 2 ? clients[(i + 1) % clients.length]! : null;
        await c.query(
          `insert into ligne_or
             (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut, payeur,
              payeur_client_id, designation, motif_annulation, montant_ht_centimes,
              montant_tva_centimes, montant_ttc_centimes)
           values ($1,$2,$3,$4,'forfait','commandee',$5,$6,$7,$8,$9,10000,810,10810)`,
          [
            randomUUID(),
            tenant.id,
            id,
            l,
            l === 3 ? 'annulee' : 'proposee',
            tiers ? 'assurance' : 'client',
            tiers?.id ?? null,
            `Ligne ${String(l)} de l'OR ${String(i)}`,
            l === 3 ? 'Annulée pour le test' : null,
          ],
        );
      }
      if (i % 3 === 0) {
        await c.query(
          `insert into ordre_reparation_demande (id, tenant_id, ordre_reparation_id, ordre, verbatim, saisi_par_id)
           values ($1,$2,$3,1,$4,$5)`,
          [randomUUID(), tenant.id, id, `Bruit au freinage ${String(i)}`, utilisateur],
        );
      }
      if (i % 5 === 0) {
        const devisId = randomUUID();
        await c.query(
          `insert into devis_complementaire (id, tenant_id, ordre_reparation_id, numero_ordre, montant_ttc_centimes, emetteur_id)
           values ($1,$2,$3,1,25000,$4)`,
          [devisId, tenant.id, id, utilisateur],
        );
      }
      if (i % 7 === 0) {
        await c.query(
          `insert into or_controle_qualite (id, tenant_id, ordre_reparation_id, controleur_id, conforme)
           values ($1,$2,$3,$4,true)`,
          [randomUUID(), tenant.id, id, utilisateur],
        );
      }
    }
  } finally {
    await c.query("set session_replication_role = 'origin'").catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  redis = await demarrerRedisEphemere();
  garage = await semerGarageDemoLot1(bdd);
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
  await semerOrdres();

  // Documents via la vraie API (triggers de numérotation/TVA) : 3 jours, 6 documents par jour
  // (ex aequo sur `date_document`), un tiers émis.
  const cookie = await cookiePour(garage.tenantA, 'direction');
  const site = garage.tenantA.tenant.sites[0]!.id;
  for (let i = 0; i < NOMBRE_DOCUMENTS; i += 1) {
    const jour = `2026-02-${String(10 + (i % 3))}`;
    const cree = await creerDocumentVente(ctx, cookie, {
      typeDocument: 'facture',
      siteId: site,
      clientId: garage.tenantA.clients[i % garage.tenantA.clients.length]!.id,
      dateDocument: jour,
      nombreLignesPrimitives: 1 + (i % 2),
    });
    expect(cree.status, JSON.stringify(cree.body)).toBe(201);
    if (i % 3 === 0) {
      const emis = await emettreDocument(ctx, cookie, (cree.body.donnees as { id: string }).id);
      expect(emis.status, JSON.stringify(emis.body)).toBe(200);
    }
  }
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('GET /ordres-reparation — chargement par lot', () => {
  it.each(['direction', 'technicien'] as const)(
    'rend exactement ce que rend l’assemblage unitaire historique (rôle %s)',
    async (role) => {
      const service = ctx.app.get(ServiceOr);
      const acces = ctx.app.get<AccesBase>(JETON_DB);
      const c = ctxTenant(garage.tenantA.tenant.id);

      const liste = await service.lister(
        c,
        principal(role),
        { tri: 'ouvertLe:desc' } as never,
        200,
        undefined,
      );
      expect(liste.donnees).toHaveLength(NOMBRE_OR);

      const reference = await acces.enTenant(c, async (tx) => {
        const sortie = [];
        for (const or of liste.donnees) {
          sortie.push(await service.assemblerDocument(tx, c, role, or.id, true));
        }
        return sortie;
      });
      expect(aller(liste.donnees)).toEqual(aller(reference));
      // Garde-fou : la fixture exerce bien les chemins sensibles (sinon l'égalité ne prouverait rien).
      const json = aller(liste.donnees) as {
        lignes: unknown[];
        demandes: unknown[];
        devisComplementaires: unknown[];
        controleQualite: unknown;
      }[];
      expect(json.some((o) => o.lignes.length > 0)).toBe(true);
      expect(json.some((o) => o.demandes.length > 0)).toBe(true);
      expect(json.some((o) => o.devisComplementaires.length > 0)).toBe(true);
      expect(json.some((o) => o.controleQualite !== null)).toBe(true);
      if (role === 'direction') {
        expect(
          (aller(liste.donnees) as { totauxParPayeur?: { payeur: string }[] }[]).some((o) =>
            o.totauxParPayeur?.some((t) => t.payeur !== 'client'),
          ),
        ).toBe(true);
      }
    },
    60_000,
  );

  it.each(TRIS_ORDRES_REPARATION)(
    'pagine sans doublon ni trou, tri %s (page de 7 == page unique de 200)',
    async (tri) => {
      const unique = await parcourir(`/api/v1/ordres-reparation?tri=${tri}`, 'direction', 200);
      const pagine = await parcourir(`/api/v1/ordres-reparation?tri=${tri}`, 'direction', 7);
      expect(new Set(pagine).size).toBe(pagine.length);
      expect(pagine).toHaveLength(NOMBRE_OR);
      expect(pagine).toEqual(unique);
      expect(new Set(pagine)).toEqual(new Set(orIdsA));
    },
    60_000,
  );

  it('trie ouvertLe:desc avec les OR sans date en dernier', async () => {
    const ids = await parcourir('/api/v1/ordres-reparation?tri=ouvertLe:desc', 'direction', 200);
    const r = await get('A', 'direction', '/api/v1/ordres-reparation?limite=200');
    const dates = (r.body as unknown as { donnees: { ouvertLe: string | null }[] }).donnees.map(
      (d) => d.ouvertLe,
    );
    expect(ids).toHaveLength(NOMBRE_OR);
    const premierNull = dates.indexOf(null);
    expect(premierNull).toBeGreaterThan(0);
    expect(dates.slice(premierNull).every((d) => d === null)).toBe(true);
    const datees = dates.slice(0, premierNull) as string[];
    expect([...datees].sort().reverse()).toEqual(datees);
  });

  it('refuse un curseur ancien format, forgé ou d’un autre tri (400 curseur_invalide)', async () => {
    const ancien = Buffer.from('50', 'utf8').toString('base64url');
    const autreTri = (
      (await get('A', 'direction', '/api/v1/ordres-reparation?limite=2&tri=ouvertLe:asc'))
        .body as unknown as Page
    ).curseurSuivant!;
    const forge = Buffer.from(
      JSON.stringify({ t: 'ouvertLe:desc', v: 'pas-une-date', i: randomUUID() }),
      'utf8',
    ).toString('base64url');
    for (const curseur of [ancien, autreTri, forge, 'n’importe quoi']) {
      const r = await get(
        'A',
        'direction',
        `/api/v1/ordres-reparation?tri=ouvertLe:desc&curseur=${encodeURIComponent(curseur)}`,
      );
      expect(r.status, curseur).toBe(400);
    }
  });

  it('isole les tenants : B ne voit aucun OR de A, et un ID inexistant rend une liste vide', async () => {
    const b = await get('B', 'direction', '/api/v1/ordres-reparation?limite=200');
    expect(b.status).toBe(200);
    const idsB = (b.body as unknown as Page).donnees.map((d) => d.id);
    expect(idsB.filter((id) => orIdsA.includes(id))).toEqual([]);
    const vide = await get('A', 'direction', `/api/v1/ordres-reparation?clientId=${randomUUID()}`);
    expect((vide.body as unknown as Page).donnees).toEqual([]);
  });

  it('le nombre de requêtes d’une page ne dépend pas de sa taille', async () => {
    const service = ctx.app.get(ServiceOr);
    const acces = ctx.app.get<AccesBase>(JETON_DB);
    const c = ctxTenant(garage.tenantA.tenant.id);
    const filtres = { tri: 'ouvertLe:desc' } as never;

    const petite = await compterRequetes(() =>
      service.lister(c, principal('direction'), filtres, 5, undefined),
    );
    const grande = await compterRequetes(() =>
      service.lister(c, principal('direction'), filtres, 50, undefined),
    );
    // Avant : une cascade de ~12 requêtes PAR OR (`assemblerDocument` boucle).
    const avant = await compterRequetes(() =>
      acces.enTenant(c, async (tx) => {
        const page = await service.lister(c, principal('direction'), filtres, 50, undefined);
        for (const or of page.donnees)
          await service.assemblerDocument(tx, c, 'direction', or.id, true);
      }),
    );
    console.warn(
      `[mesure] OR : page de 5 = ${String(petite.requetes)} requêtes, page de 50 = ${String(grande.requetes)} ; ancien chemin (50 x assemblerDocument) = ${String(avant.requetes - grande.requetes)}`,
    );
    // Indépendant de la taille : seules des requêtes CONDITIONNELLES (devis, payeurs tiers) peuvent
    // manquer sur une petite page, jamais une requête par OR.
    expect(grande.requetes - petite.requetes).toBeLessThanOrEqual(3);
    expect(grande.requetes).toBeLessThanOrEqual(14);
    expect(avant.requetes - grande.requetes).toBeGreaterThan(300);
  }, 60_000);
});

describe('GET /documents-vente — chargement par lot', () => {
  it.each(['direction', 'technicien'] as const)(
    'rend exactement ce que rend l’assemblage unitaire historique (rôle %s)',
    async (role) => {
      const service = ctx.app.get(ServiceDocumentsVente);
      const acces = ctx.app.get<AccesBase>(JETON_DB);
      const c = ctxTenant(garage.tenantA.tenant.id);
      const liste = await service.lister(
        c,
        principal(role),
        { tri: 'dateDocument:desc' } as never,
        200,
        undefined,
      );
      expect(liste.donnees).toHaveLength(NOMBRE_DOCUMENTS);
      const reference = await acces.enTenant(c, async (tx) => {
        const sortie = [];
        for (const d of liste.donnees) {
          sortie.push(await service.assemblerDocument(tx, c, role, d.id, true));
        }
        return sortie;
      });
      expect(aller(liste.donnees)).toEqual(aller(reference));
    },
    60_000,
  );

  it.each(TRIS_DOCUMENTS_VENTE)(
    'pagine sans doublon ni trou, tri %s (page de 4 == page unique de 200)',
    async (tri) => {
      const unique = await parcourir(`/api/v1/documents-vente?tri=${tri}`, 'direction', 200);
      const pagine = await parcourir(`/api/v1/documents-vente?tri=${tri}`, 'direction', 4);
      expect(new Set(pagine).size).toBe(pagine.length);
      expect(pagine).toHaveLength(NOMBRE_DOCUMENTS);
      expect(pagine).toEqual(unique);
    },
    60_000,
  );

  it('trie dateDocument:desc, le plus récemment créé d’abord à date égale', async () => {
    const r = await get('A', 'direction', '/api/v1/documents-vente?limite=200');
    const docs = (r.body as unknown as { donnees: { dateDocument: string; creeLe: string }[] })
      .donnees;
    for (let i = 1; i < docs.length; i += 1) {
      const a = docs[i - 1]!;
      const b = docs[i]!;
      expect(a.dateDocument >= b.dateDocument).toBe(true);
      if (a.dateDocument === b.dateDocument) expect(a.creeLe >= b.creeLe).toBe(true);
    }
  });

  it('refuse un curseur ancien format, forgé ou d’un autre tri (400 curseur_invalide)', async () => {
    const ancien = Buffer.from('10', 'utf8').toString('base64url');
    const autreTri = (
      (await get('A', 'direction', '/api/v1/documents-vente?limite=2&tri=dateDocument:asc'))
        .body as unknown as Page
    ).curseurSuivant!;
    const forges = [
      {
        t: 'dateDocument:desc',
        v: 'pas-une-date|2026-01-01T00:00:00.000000+00:00',
        i: randomUUID(),
      },
      { t: 'dateDocument:desc', v: '2026-02-10|pas-un-horodatage', i: randomUUID() },
      { t: 'dateDocument:desc', v: 'sans-separateur', i: randomUUID() },
    ].map((o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url'));
    for (const curseur of [ancien, autreTri, ...forges]) {
      const r = await get(
        'A',
        'direction',
        `/api/v1/documents-vente?curseur=${encodeURIComponent(curseur)}`,
      );
      expect(r.status, curseur).toBe(400);
    }
  });

  it('isole les tenants et applique les filtres (ID inexistant -> liste vide)', async () => {
    const b = await get('B', 'direction', '/api/v1/documents-vente?limite=200');
    expect(b.status).toBe(200);
    expect((b.body as unknown as Page).donnees).toEqual([]);
    const vide = await get('A', 'direction', `/api/v1/documents-vente?clientId=${randomUUID()}`);
    expect((vide.body as unknown as Page).donnees).toEqual([]);
  });

  it('le nombre de requêtes d’une page ne dépend pas de sa taille', async () => {
    const service = ctx.app.get(ServiceDocumentsVente);
    const acces = ctx.app.get<AccesBase>(JETON_DB);
    const c = ctxTenant(garage.tenantA.tenant.id);
    const filtres = { tri: 'dateDocument:desc' } as never;
    const petite = await compterRequetes(() =>
      service.lister(c, principal('direction'), filtres, 3, undefined),
    );
    const grande = await compterRequetes(() =>
      service.lister(c, principal('direction'), filtres, 18, undefined),
    );
    const avant = await compterRequetes(() =>
      acces.enTenant(c, async (tx) => {
        const page = await service.lister(c, principal('direction'), filtres, 18, undefined);
        for (const d of page.donnees)
          await service.assemblerDocument(tx, c, 'direction', d.id, true);
      }),
    );
    console.warn(
      `[mesure] factures : page de 3 = ${String(petite.requetes)} requêtes, page de 18 = ${String(grande.requetes)} ; ancien chemin (18 x assemblerDocument) = ${String(avant.requetes - grande.requetes)}`,
    );
    expect(grande.requetes - petite.requetes).toBeLessThanOrEqual(1);
    expect(grande.requetes).toBeLessThanOrEqual(5);
  }, 60_000);
});
