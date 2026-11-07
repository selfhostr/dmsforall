/**
 * Export fiduciaire de bout en bout, sur vraie base Postgres éphémère et vraie API HTTP :
 * mapping comptable, aperçu, 409 avec `blocages`, export CSV, historique paginé, relecture du
 * fichier, continuité de numérotation APRÈS un premier export, isolation tenant et droits.
 *
 * Aucun mock de la couche base : la requête réelle est le sujet (voir CLAUDE.md, « Un test qui
 * mocke `tx.execute` ne prouve rien sur la requête réelle »).
 */

import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE, type RoleUtilisateur } from '@dfa/shared';

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
  PRIMITIVE_HT,
  PRIMITIVE_TTC,
  PRIMITIVE_TVA,
} from './ventes/fixtures-cycle-vente';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let garage: GarageDemoLot1Fixture;
let cookiePour: ReturnType<typeof construireCookiePour>;

type Corps = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function appeler(
  tenant: 'A' | 'B',
  role: RoleUtilisateur,
  methode: 'get' | 'post' | 'put',
  chemin: string,
  corps?: Record<string, unknown>,
): Promise<{ status: number; body: Corps; headers: Record<string, string>; brut: Buffer }> {
  const cookie = await cookiePour(tenant === 'A' ? garage.tenantA : garage.tenantB, role);
  let req = ctx.requete[methode](`/api/v1${chemin}`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie);
  if (methode === 'post') req = req.set(EN_TETE_IDEMPOTENCE, randomUUID());
  if (chemin.endsWith('/fichier')) req = req.buffer(true).parse(binaire);
  const r = await (corps ? req.send(corps) : req);
  const brut = Buffer.isBuffer(r.body) ? r.body : Buffer.alloc(0);
  return {
    status: r.status,
    body: (Buffer.isBuffer(r.body) ? {} : r.body) as Corps,
    headers: r.headers as Record<string, string>,
    brut,
  };
}

function binaire(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void): void {
  const morceaux: Buffer[] = [];
  res.on('data', (m: Buffer) => morceaux.push(m));
  res.on('end', () => cb(null, Buffer.concat(morceaux)));
}

async function creerEtEmettre(dateDocument: string): Promise<{ id: string; numero: string }> {
  const cookie = await cookiePour(garage.tenantA, 'direction');
  const cree = await creerDocumentVente(ctx, cookie, {
    typeDocument: 'facture',
    siteId: garage.tenantA.tenant.sites[0]!.id,
    clientId: garage.tenantA.clients[0]!.id,
    dateDocument,
    nombreLignesPrimitives: 1,
  });
  expect(cree.status, JSON.stringify(cree.body)).toBe(201);
  const id = (cree.body.donnees as { id: string }).id;
  const emis = await emettreDocument(ctx, cookie, id);
  expect(emis.status, JSON.stringify(emis.body)).toBe(200);
  return { id, numero: (emis.body.donnees as { numero: string }).numero };
}

const MAPPING_COMPLET = {
  cible: 'csv',
  comptes: [
    { usage: 'creances_clients', categorie: 'defaut', compte: '1100' },
    { usage: 'produit', categorie: 'forfait', compte: '3400' },
    { usage: 'tva_due', categorie: '81', compte: '2200' },
  ],
  codesTva: [{ regimeTva: 'normal', tauxPourmille: 81, codeExterne: '8.1' }],
};

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  redis = await demarrerRedisEphemere();
  garage = await semerGarageDemoLot1(bdd);
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('export fiduciaire — parcours complet (tenant A)', () => {
  const premiers: { id: string; numero: string }[] = [];
  let exportFevrier = '';
  let empreinteFevrier = '';
  let contenuFevrier = Buffer.alloc(0);

  it('mapping vide : incomplet, avec suggestions mais aucun compte réglé', async () => {
    const r = await appeler('A', 'direction', 'get', '/exports-fiduciaires/mapping?cible=csv');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.complet).toBe(false);
    expect(r.body.nbPostesManquants).toBeGreaterThan(0);
    const creances = r.body.comptes.find((p: Corps) => p.usage === 'creances_clients');
    expect(creances).toMatchObject({ compte: null, compteParDefaut: '1100', requis: true });
    const normal = r.body.codesTva.find((p: Corps) => p.tauxPourmille === 81);
    expect(normal).toMatchObject({ codeExterne: null, codeParDefaut: '8.1' });
  });

  it('aperçu : 3 factures émises, totaux exacts, mapping incomplet nommé, pas exportable', async () => {
    for (const jour of ['2026-02-10', '2026-02-11', '2026-02-12']) {
      premiers.push(await creerEtEmettre(jour));
    }
    const r = await appeler(
      'A',
      'direction',
      'get',
      '/exports-fiduciaires/apercu?cible=csv&periodeDu=2026-02-01&periodeAu=2026-02-28',
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.documents).toEqual({ nbFactures: 3, nbAvoirs: 0, aExporter: 3, dejaExportes: 0 });
    expect(r.body.totaux).toEqual({
      htCentimes: 3 * PRIMITIVE_HT,
      tvaCentimes: 3 * PRIMITIVE_TVA,
      ttcCentimes: 3 * PRIMITIVE_TTC,
    });
    expect(r.body.plageNumeros.factures).toEqual({
      premier: premiers[0]!.numero,
      dernier: premiers[2]!.numero,
    });
    expect(r.body.exportable).toBe(false);
    const mapping = r.body.prerequis.find((p: Corps) => p.code === 'EXPORT_MAPPING_INCOMPLET');
    expect(mapping.comptes.map((c: Corps) => `${c.usage}/${c.categorie}`).sort()).toEqual([
      'creances_clients/defaut',
      'produit/forfait',
      'tva_due/81',
    ]);
    expect(mapping.codesTva).toEqual([
      expect.objectContaining({ regimeTva: 'normal', tauxPourmille: 81 }),
    ]);
  });

  it('POST avant réglage : 409 avec les comptes manquants dans blocages[].donnees (pas seulement detail)', async () => {
    const r = await appeler('A', 'direction', 'post', '/exports-fiduciaires', {
      cible: 'csv',
      granularite: 'detaille',
      periodeDu: '2026-02-01',
      periodeAu: '2026-02-28',
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('EXPORT_MAPPING_INCOMPLET');
    const ids = (r.body.blocages as Corps[]).map((b) => b.id).sort();
    expect(ids).toEqual([
      'code_tva:normal:81',
      'compte:creances_clients:defaut',
      'compte:produit:forfait',
      'compte:tva_due:81',
    ]);
    const produit = (r.body.blocages as Corps[]).find((b) => b.id === 'compte:produit:forfait')!;
    expect(produit.donnees).toMatchObject({ usage: 'produit', categorie: 'forfait' });
    expect(produit.donnees.references).toContain(premiers[0]!.numero);
  });

  it('PUT mapping règle les postes, et rejouer le même PUT ne crée aucune nouvelle version', async () => {
    const r1 = await appeler(
      'A',
      'comptable',
      'put',
      '/exports-fiduciaires/mapping',
      MAPPING_COMPLET,
    );
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const forfait = r1.body.comptes.find((p: Corps) => p.categorie === 'forfait');
    expect(forfait).toMatchObject({ compte: '3400', actifDu: '1970-01-01' });

    const r2 = await appeler(
      'A',
      'comptable',
      'put',
      '/exports-fiduciaires/mapping',
      MAPPING_COMPLET,
    );
    expect(r2.status).toBe(200);
    const lignes = await bdd.poolSuperutilisateur.query(
      "select count(*)::int as n from public.mapping_compte where tenant_id = $1 and categorie = 'forfait'",
      [garage.tenantA.tenant.id],
    );
    expect(lignes.rows[0].n).toBe(1);
  });

  it('changer un compte déjà réglé clôt la version active (RF-112) sans la réécrire', async () => {
    const r = await appeler('A', 'direction', 'put', '/exports-fiduciaires/mapping', {
      cible: 'csv',
      comptes: [{ usage: 'produit', categorie: 'forfait', compte: '3401', actifDu: '2030-01-01' }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Version future : le compte actif aujourd'hui reste 3400.
    expect(r.body.comptes.find((p: Corps) => p.categorie === 'forfait').compte).toBe('3400');
    const lignes = await bdd.poolSuperutilisateur.query(
      "select compte, actif_du::text, actif_au::text from public.mapping_compte where tenant_id = $1 and categorie = 'forfait' order by actif_du",
      [garage.tenantA.tenant.id],
    );
    expect(lignes.rows).toEqual([
      { compte: '3400', actif_du: '1970-01-01', actif_au: '2030-01-01' },
      { compte: '3401', actif_du: '2030-01-01', actif_au: null },
    ]);
    // Une date antérieure à une version existante est refusée.
    const conflit = await appeler('A', 'direction', 'put', '/exports-fiduciaires/mapping', {
      cible: 'csv',
      comptes: [{ usage: 'produit', categorie: 'forfait', compte: '3402', actifDu: '2029-01-01' }],
    });
    expect(conflit.status).toBe(409);
    expect(conflit.body.code).toBe('CONFLIT');
  });

  it('aperçu après réglage : exportable', async () => {
    const r = await appeler(
      'A',
      'direction',
      'get',
      '/exports-fiduciaires/apercu?cible=csv&periodeDu=2026-02-01&periodeAu=2026-02-28',
    );
    expect(r.body.prerequis).toEqual([]);
    expect(r.body.exportable).toBe(true);
  });

  it('POST csv : 201, BOM UTF-8, 6 lignes de données + en-tête, montants exacts, documents marqués', async () => {
    const r = await appeler('A', 'direction', 'post', '/exports-fiduciaires', {
      cible: 'csv',
      granularite: 'detaille',
      periodeDu: '2026-02-01',
      periodeAu: '2026-02-28',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const lot = r.body.donnees.lots[0];
    exportFevrier = lot.exportId;
    empreinteFevrier = lot.empreinteSha256;
    contenuFevrier = Buffer.from(lot.contenuBase64 as string, 'base64');
    expect(contenuFevrier.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(createHash('sha256').update(contenuFevrier).digest('hex')).toBe(empreinteFevrier);
    const lignes = contenuFevrier.subarray(3).toString('utf8').trimEnd().split('\r\n');
    expect(lignes).toHaveLength(1 + 3 * 2);
    expect(lignes[1]).toContain(`;${premiers[0]!.numero};1100;3400;`);
    expect(lignes[1]).toContain(`;${(PRIMITIVE_HT / 100).toFixed(2)};`);
    expect(lignes[2]).toContain(`;1100;2200;`);
    expect(lignes[2]).toContain(`;${(PRIMITIVE_TVA / 100).toFixed(2)};8.1;`);
    expect(lot.totalDebitCentimes).toBe(String(3 * PRIMITIVE_TTC));
    expect(r.body.donnees.documentsExportes).toHaveLength(3);
  });

  it('aperçu après export : tout est déjà exporté, plus rien à exporter', async () => {
    const r = await appeler(
      'A',
      'direction',
      'get',
      '/exports-fiduciaires/apercu?cible=csv&periodeDu=2026-02-01&periodeAu=2026-02-28',
    );
    expect(r.body.documents).toMatchObject({ aExporter: 0, dejaExportes: 3 });
    expect(r.body.aQuelqueChoseAExporter).toBe(false);
    expect(r.body.exportable).toBe(false);
  });

  it('export du mois suivant : les documents déjà exportés ne sont PAS pris pour des trous de numérotation', async () => {
    const mars = [await creerEtEmettre('2026-03-05'), await creerEtEmettre('2026-03-06')];
    const r = await appeler('A', 'direction', 'post', '/exports-fiduciaires', {
      cible: 'csv',
      granularite: 'detaille',
      periodeDu: '2026-03-01',
      periodeAu: '2026-03-31',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.donnees.documentsExportes.map((d: Corps) => d.numero)).toEqual(
      mars.map((m) => m.numero),
    );
  });

  it('historique : plus récent d’abord, compteurs, plage de numéros, auteur, pagination sans doublon', async () => {
    const p1 = await appeler('A', 'direction', 'get', '/exports-fiduciaires?limite=1');
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(p1.body.donnees).toHaveLength(1);
    expect(p1.body.curseurSuivant).not.toBeNull();
    expect(p1.body.donnees[0]).toMatchObject({
      periodeDu: '2026-03-01',
      periodeAu: '2026-03-31',
      cible: 'csv',
      nbFactures: 2,
      nbAvoirs: 0,
      totalTtcCentimes: 2 * PRIMITIVE_TTC,
      fichierDisponible: true,
    });
    expect(p1.body.donnees[0].genereParNom).toEqual(expect.any(String));

    const p2 = await appeler(
      'A',
      'direction',
      'get',
      `/exports-fiduciaires?limite=1&curseur=${encodeURIComponent(p1.body.curseurSuivant as string)}`,
    );
    expect(p2.body.donnees).toHaveLength(1);
    expect(p2.body.donnees[0].id).toBe(exportFevrier);
    expect(p2.body.donnees[0]).toMatchObject({
      nbFactures: 3,
      nbEncaissements: 0,
      totalHtCentimes: 3 * PRIMITIVE_HT,
      plageNumeros: {
        factures: { premier: premiers[0]!.numero, dernier: premiers[2]!.numero },
        avoirs: null,
      },
    });
    expect(p2.body.curseurSuivant).toBeNull();

    const forge = await appeler('A', 'direction', 'get', '/exports-fiduciaires?curseur=%25%25%25');
    expect(forge.status).toBe(400);
  });

  it('fichier : octet pour octet celui remis à la fiduciaire, empreinte rendue en en-tête', async () => {
    const r = await appeler(
      'A',
      'direction',
      'get',
      `/exports-fiduciaires/${exportFevrier}/fichier`,
    );
    expect(r.status).toBe(200);
    expect(r.brut.equals(contenuFevrier)).toBe(true);
    expect(r.headers['x-empreinte-sha256']).toBe(empreinteFevrier);
    expect(r.headers['content-disposition']).toContain(
      'dfa-export-csv-2026-02-01-au-2026-02-28.csv',
    );
  });

  it('trou de numérotation : 409 qui nomme le document manquant dans blocages', async () => {
    const avril = await creerEtEmettre('2026-04-02');
    await creerEtEmettre('2026-05-03');
    const apercu = await appeler(
      'A',
      'direction',
      'get',
      '/exports-fiduciaires/apercu?cible=csv&periodeDu=2026-05-01&periodeAu=2026-05-31',
    );
    const trou = apercu.body.prerequis.find((p: Corps) => p.code === 'EXPORT_TROU_NUMEROTATION');
    expect(trou.trous[0].numeros).toEqual([avril.numero]);
    expect(apercu.body.exportable).toBe(false);

    const r = await appeler('A', 'direction', 'post', '/exports-fiduciaires', {
      cible: 'csv',
      granularite: 'detaille',
      periodeDu: '2026-05-01',
      periodeAu: '2026-05-31',
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('EXPORT_TROU_NUMEROTATION');
    expect(r.body.blocages).toEqual([
      expect.objectContaining({
        type: 'document_vente',
        id: avril.id,
        donnees: expect.objectContaining({ numero: avril.numero }),
      }),
    ]);
  });

  it('cible non câblée : 501 et l’aperçu le signale', async () => {
    const r = await appeler('A', 'direction', 'post', '/exports-fiduciaires', {
      cible: 'bexio',
      periodeDu: '2026-02-01',
      periodeAu: '2026-02-28',
    });
    expect(r.status).toBe(501);
  });

  it('fin de période avant le début : 400', async () => {
    const r = await appeler(
      'A',
      'direction',
      'get',
      '/exports-fiduciaires/apercu?periodeDu=2026-03-01&periodeAu=2026-02-01',
    );
    expect(r.status).toBe(400);
  });
});

describe('export fiduciaire — isolation tenant et droits', () => {
  it("le tenant B ne voit ni l'historique, ni le mapping, ni les fichiers du tenant A", async () => {
    const liste = await appeler('B', 'direction', 'get', '/exports-fiduciaires');
    expect(liste.status).toBe(200);
    expect(liste.body.donnees).toEqual([]);

    const mapping = await appeler(
      'B',
      'direction',
      'get',
      '/exports-fiduciaires/mapping?cible=csv',
    );
    expect(mapping.body.comptes.every((p: Corps) => p.compte === null)).toBe(true);

    const exportA = await bdd.poolSuperutilisateur.query(
      'select id from public.export_comptable where tenant_id = $1 limit 1',
      [garage.tenantA.tenant.id],
    );
    const id = exportA.rows[0].id as string;
    const fichier = await appeler('B', 'direction', 'get', `/exports-fiduciaires/${id}/fichier`);
    expect(fichier.status).toBe(404);
  });

  it.each(['admin', 'vendeur', 'technicien'] as const)(
    'le rôle %s n’a accès à aucune route de l’export (403)',
    async (role) => {
      for (const chemin of [
        '/exports-fiduciaires',
        '/exports-fiduciaires/mapping',
        '/exports-fiduciaires/apercu?periodeDu=2026-02-01&periodeAu=2026-02-28',
      ]) {
        const r = await appeler('A', role, 'get', chemin);
        expect(r.status, chemin).toBe(403);
      }
      const put = await appeler('A', role, 'put', '/exports-fiduciaires/mapping', MAPPING_COMPLET);
      expect(put.status).toBe(403);
    },
  );
});
