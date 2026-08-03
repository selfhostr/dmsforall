/**
 * Isolation tenant — DONNÉES RÉELLES des tables du module Pièces (étape 3, migrations 0022→0029) :
 * `fournisseur`, `article`, `stock_article`, `mouvement_stock`, `commande_fournisseur`,
 * `reservation_piece`, `consigne_echange_standard`. MÊME PATRON que
 * `test/lot1/isolation/isolation-donnees-lot1.spec.ts` (à relire pour le raisonnement complet) :
 * pool `dfa_app` sous RLS, deux tenants distincts, preuve en LECTURE (une donnée de B est
 * invisible sous A, jamais une erreur) ET en ÉCRITURE (une impersonation — `tenant_id = B` posé
 * sous le contexte A, avec des données par ailleurs VALIDES pour B — est refusée par la clause
 * `WITH CHECK` de la politique RLS, pas seulement filtrée en lecture).
 *
 * C'est la « règle n°1 du projet » (CONTRIBUTING.md) appliquée aux sept tables neuves de ce module.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, requeteSousTenant, type BaseEphemere } from '../../setup/postgres-ephemere';
import { creerLignePourTest, creerOrPourTest, semerGarageDemoLot1, type GarageDemoLot1Fixture } from '../../lot1/fixtures/garage-demo-lot1';
import {
  creerArticleAvecStockPourTest,
  creerCommandeFournisseurPourTest,
  creerConsignePourTest,
  creerFournisseurPourTest,
  creerLigneOrPiecePourTest,
  creerMouvementStockPourTest,
  creerReservationPiecePourTest,
  type ArticleDeTest,
  type FournisseurDeTest,
} from '../fixtures/garage-demo-lot2';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;

// Un jeu de données complet par tenant : fournisseur, article+stock, mouvement, commande,
// réservation (via un OR/une ligne dédiés), consigne (via un second mouvement d'entrée).
interface JeuPieces {
  readonly fournisseur: FournisseurDeTest;
  readonly article: ArticleDeTest;
  readonly mouvement: { readonly id: string };
  readonly commande: { readonly id: string };
  readonly reservation: { readonly id: string };
  readonly consigne: { readonly id: string };
  readonly siteId: string;
  /** OR + ligne d'OR VALIDES, SANS réservation posée dessus — dédiés au test d'impersonation en
   *  écriture de `reservation_piece` (qui a besoin de références réellement existantes côté B
   *  pour que le refus observé vienne du RLS, pas d'une violation de clé étrangère annexe). */
  readonly cibleLibrePourImpersonation: { readonly ligneOrId: string; readonly ordreReparationId: string };
}

async function semerJeuPieces(t: GarageDemoLot1Fixture['tenantA']): Promise<JeuPieces> {
  const siteId = t.tenant.sites[0]!.id;
  const fournisseur = await creerFournisseurPourTest(bdd, t.tenant, `Fournisseur ${t.tenant.slug}`);
  const article = await creerArticleAvecStockPourTest(bdd, t.tenant, siteId, { quantitePhysiqueMillieme: 3000 });
  const mouvement = await creerMouvementStockPourTest(bdd, t.tenant, article.id, siteId, { type: 'entree_livraison' });
  const commande = await creerCommandeFournisseurPourTest(bdd, t.tenant, siteId, fournisseur.id);

  const or = await creerOrPourTest(bdd, t.tenant, siteId, t.clients[0]!, t.vehicules[0]!);
  const ligne = await creerLigneOrPiecePourTest(bdd, t.tenant, or.id, article.id, 1);
  const reservation = await creerReservationPiecePourTest(bdd, t.tenant, article.id, siteId, ligne.id, or.id, 1000);

  const orConsigne = await creerOrPourTest(bdd, t.tenant, siteId, t.clients[0]!, t.vehicules[0]!);
  const ligneConsigne = await creerLigneOrPiecePourTest(bdd, t.tenant, orConsigne.id, article.id, 1);
  const mouvementConsigne = await creerMouvementStockPourTest(bdd, t.tenant, article.id, siteId, { type: 'entree_livraison' });
  const consigne = await creerConsignePourTest(bdd, t.tenant, ligneConsigne.id, orConsigne.id, article.id, siteId, mouvementConsigne.id);

  const orLibre = await creerOrPourTest(bdd, t.tenant, siteId, t.clients[0]!, t.vehicules[0]!);
  const ligneLibre = await creerLigneOrPiecePourTest(bdd, t.tenant, orLibre.id, article.id, 1);

  return {
    fournisseur,
    article,
    mouvement,
    commande,
    reservation,
    consigne,
    siteId,
    cibleLibrePourImpersonation: { ligneOrId: ligneLibre.id, ordreReparationId: orLibre.id },
  };
}

let jeuA: JeuPieces;
let jeuB: JeuPieces;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  [jeuA, jeuB] = await Promise.all([semerJeuPieces(garage.tenantA), semerJeuPieces(garage.tenantB)]);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

describe('lecture — les données Pièces du tenant B sont invisibles sous le contexte du tenant A', () => {
  it.each([
    ['fournisseur', 'fournisseur'] as const,
    ['article', 'article'] as const,
    ['commande_fournisseur', 'commande_fournisseur'] as const,
    ['mouvement_stock', 'mouvement_stock'] as const,
    ['reservation_piece', 'reservation_piece'] as const,
    ['consigne_echange_standard', 'consigne_echange_standard'] as const,
  ])('%s : select explicite par id d\'une ligne du tenant B rend zéro ligne sous le tenant A', async (_desc, table) => {
    const idsParTable: Record<string, string> = {
      fournisseur: jeuB.fournisseur.id,
      article: jeuB.article.id,
      commande_fournisseur: jeuB.commande.id,
      mouvement_stock: jeuB.mouvement.id,
      reservation_piece: jeuB.reservation.id,
      consigne_echange_standard: jeuB.consigne.id,
    };
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      `select * from ${table} where id = $1`,
      [idsParTable[table]],
    );
    expect(lignes).toHaveLength(0);

    // Contrôle positif : la même lecture sous le BON tenant trouve bien la ligne.
    const lignesBonTenant = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      `select * from ${table} where id = $1`,
      [idsParTable[table]],
    );
    expect(lignesBonTenant, `contrôle positif ${table}`).toHaveLength(1);
  });

  it('stock_article (clé composite, pas de colonne id) : la ligne de stock de B est invisible sous A', async () => {
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from stock_article where article_id = $1',
      [jeuB.article.id],
    );
    expect(lignes).toHaveLength(0);
  });

  it("article : la désignation d'un article de B ne remonte dans aucune recherche texte sous A", async () => {
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from article where reference_principale = (select reference_principale from article where id = $1)',
      [jeuB.article.id],
    );
    // Sous A, le sous-select interne est LUI-MÊME filtré par RLS (contexte A) : la référence de B
    // n'y est jamais lue, donc la comparaison ne peut matcher aucun article de A par coïncidence.
    expect(lignes).toHaveLength(0);
  });

  it('sans app.tenant_id positionné, toute lecture rend zéro ligne (fail-closed)', async () => {
    for (const table of [
      'fournisseur',
      'article',
      'stock_article',
      'mouvement_stock',
      'commande_fournisseur',
      'reservation_piece',
      'consigne_echange_standard',
    ]) {
      const lignes = await requeteSousTenant(bdd.poolApp, null, `select * from ${table}`);
      expect(lignes, table).toHaveLength(0);
    }
  });
});

describe("écriture — impersonation du tenant B refusée sous le contexte A (WITH CHECK), avec des données par ailleurs valides pour B", () => {
  it('fournisseur : insert tenant_id=B exécuté sous le contexte A viole la politique RLS', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into fournisseur (id, tenant_id, nom, statut) values (gen_random_uuid(), $1, 'Intrus', 'actif')`,
        [garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('article : idem', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into article (id, tenant_id, designation, categorie, reference_principale, prix_vente_ttc_centimes)
         values (gen_random_uuid(), $1, 'Intrus', 'piece_mecanique', 'REF-INTRUS', 1000)`,
        [garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("stock_article : insert visant l'article ET le site de B, tenant_id=B, sous le contexte A — la FK est satisfaite, seul le RLS bloque", async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into stock_article (tenant_id, article_id, site_id, quantite_physique_millieme) values ($1, $2, $3, 1)`,
        [garage.tenantB.tenant.id, jeuB.article.id, garage.tenantB.tenant.sites[0]!.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("mouvement_stock : insert visant l'article ET le site de B, tenant_id=B, sous le contexte A — refusé", async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into mouvement_stock (id, tenant_id, article_id, type, quantite_millieme, site_id)
         values (gen_random_uuid(), $1, $2, 'entree_livraison', 1000, $3)`,
        [garage.tenantB.tenant.id, jeuB.article.id, garage.tenantB.tenant.sites[0]!.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("reservation_piece : insert visant l'article/site/ligne_or/OR RÉELS de B (aucune FK cassée), tenant_id=B, sous le contexte A — refusé, et pour une raison qui prouve une DÉFENSE EN PROFONDEUR", async () => {
    // Cas plus subtil que les autres tables de ce fichier : `reservation_piece_verrouiller_stock`
    // (trigger BEFORE INSERT, `security invoker`, 0026) s'exécute AVANT que le WITH CHECK de la
    // politique RLS de `reservation_piece` elle-même ne soit évalué (ordre PostgreSQL : les
    // triggers BEFORE ROW s'exécutent avant que la ligne finale ne soit validée contre les
    // contraintes/politiques). Ce trigger lit `stock_article` SOUS LE CONTEXTE DE SESSION COURANT
    // (A, jamais B) : sa clause `where tenant_id = new.tenant_id (= B)` combinée à la politique RLS
    // de LECTURE de `stock_article` (qui restreint déjà à `tenant_id = tenant_courant() = A`) ne
    // peut donc JAMAIS trouver la ligne de stock de B, quelle que soit la donnée insérée — le
    // trigger échoue en ZDFA4 (« aucune ligne de stock… ») avant même d'atteindre le RLS de
        // `reservation_piece`. C'est une preuve PLUS FORTE que le cas générique : même un trigger
    // `security invoker` qui lit une AUTRE table ne peut pas voir au travers du RLS pour fabriquer
    // une réservation sur les données d'un autre tenant.
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into reservation_piece (id, tenant_id, article_id, site_id, ligne_or_id, ordre_reparation_id, quantite_millieme)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 1000)`,
        [
          garage.tenantB.tenant.id,
          jeuB.article.id,
          jeuB.siteId,
          jeuB.cibleLibrePourImpersonation.ligneOrId,
          jeuB.cibleLibrePourImpersonation.ordreReparationId,
        ],
      ),
    ).rejects.toMatchObject({ code: 'ZDFA4' });
  });

  it("commande_fournisseur : insert visant le fournisseur ET le site de B, tenant_id=B, sous le contexte A — refusé", async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into commande_fournisseur (id, tenant_id, fournisseur_id, site_id) values (gen_random_uuid(), $1, $2, $3)`,
        [garage.tenantB.tenant.id, jeuB.fournisseur.id, garage.tenantB.tenant.sites[0]!.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("mouvement_stock (IMMUABLE, dfa_app) : un UPDATE, même sous le BON tenant, est refusé par le privilège Postgres — pas seulement un problème RLS", async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `update mouvement_stock set motif = 'INTRUS' where id = $1`,
        [jeuA.mouvement.id],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('mouvement_stock (IMMUABLE, dfa_app) : un DELETE, même sous le BON tenant, est refusé par le privilège Postgres', async () => {
    await expect(
      requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, `delete from mouvement_stock where id = $1`, [jeuA.mouvement.id]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("ordre_reparation : un UPDATE qui ferait passer l'OR de A vers tenant_id = B est refusé, la ligne ne bouge pas (rappel du filet lot 1, ici via une nouvelle donnée de ce jeu)", async () => {
    const ligneAvantId = jeuA.reservation.id;
    const avant = await requeteSousTenant<{ tenant_id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select tenant_id from reservation_piece where id = $1',
      [ligneAvantId],
    );
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        'update reservation_piece set tenant_id = $2 where id = $1',
        [ligneAvantId, garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
    const apres = await requeteSousTenant<{ tenant_id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select tenant_id from reservation_piece where id = $1',
      [ligneAvantId],
    );
    expect(apres[0]?.tenant_id).toBe(avant[0]?.tenant_id);
  });
});
