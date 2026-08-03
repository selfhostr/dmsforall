/**
 * Fixture métier du lot 2 (Pièces, Pointage, Ventes) — prolonge `test/lot1/fixtures/garage-demo-lot1.ts`
 * (qui prolonge elle-même `test/fixtures/garage-demo.ts`) avec les objets dont les tests
 * d'intégration de ce lot ont besoin, SANS dupliquer la connaissance des colonnes NOT NULL des
 * migrations 0022 → 0032 dans chaque fichier de spec.
 *
 * MÊME DOCTRINE que `garage-demo-lot1.ts` : chaque aide écrit via `ecrireSousTenant` (pool
 * `dfa_app`, sous RLS) — jamais `poolSuperutilisateur` — parce qu'aucune des tables du lot 2 n'est
 * sous FORCE ROW LEVEL SECURITY avec restriction du propriétaire lui-même (seules `tenant`/`site`
 * le sont, déjà amorcées par `garage-demo.ts`). Amorcer cette fixture EST donc déjà, en soi, une
 * preuve que le RLS et les contraintes CHECK/FK n'empêchent pas une écriture légitime — la même
 * garantie que `garage-demo-lot1.ts` offre pour l'atelier.
 *
 * PAS d'orchestration globale « semerGarageDemoLot2 » unique comme au lot 1 : les besoins des
 * fichiers de spec de ce lot sont hétérogènes (isolation pièces vs. isolation ventes vs.
 * concurrence pointage) et une orchestration unique grossirait chaque `beforeAll` avec des objets
 * dont la moitié des fichiers n'a pas l'usage. Chaque aide ci-dessous est appelée à la carte,
 * exactement comme `creerOrPourTest`/`creerLignePourTest` le sont déjà au lot 1.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ecrireSousTenant, type BaseEphemere } from '../../setup/postgres-ephemere';
import type { DonneesLot1Tenant } from '../../lot1/fixtures/garage-demo-lot1';

// -------------------------------------------------------------------------------------------
// Pièces — fournisseur, article, stock_article, mouvement_stock, commande_fournisseur,
// reservation_piece, consigne_echange_standard
// -------------------------------------------------------------------------------------------

export interface FournisseurDeTest {
  readonly id: string;
  readonly tenantId: string;
}

export async function creerFournisseurPourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  nom = 'Fournisseur de test SA',
): Promise<FournisseurDeTest> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into fournisseur (id, tenant_id, nom, statut) values ($1, $2, $3, 'actif')`,
      [id, tenant.id, nom],
    );
  });
  return { id, tenantId: tenant.id };
}

export interface ArticleDeTest {
  readonly id: string;
  readonly tenantId: string;
  readonly prixVenteTtcCentimes: number;
}

/** Article avec une ligne de stock déjà posée sur `siteId` — `quantitePhysiqueMillieme` par
 *  défaut à `1000` (1 unité, RP primitives.ts : « 1000 = 1 unité »), suffisant pour les tests de
 *  réservation qui ont besoin d'un dernier exemplaire disputé (CP-02). */
export async function creerArticleAvecStockPourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  siteId: string,
  options: {
    readonly designation?: string;
    readonly categorie?: string;
    readonly prixVenteTtcCentimes?: number;
    readonly quantitePhysiqueMillieme?: number;
  } = {},
): Promise<ArticleDeTest> {
  const id = randomUUID();
  const prixVenteTtcCentimes = options.prixVenteTtcCentimes ?? 4990;
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into article (id, tenant_id, designation, categorie, reference_principale, prix_vente_ttc_centimes)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        tenant.id,
        options.designation ?? 'Plaquette de frein de test',
        options.categorie ?? 'piece_mecanique',
        `REF-${id.slice(0, 8).toUpperCase()}`,
        prixVenteTtcCentimes,
      ],
    );
    await client.query(
      `insert into stock_article (tenant_id, article_id, site_id, quantite_physique_millieme)
       values ($1, $2, $3, $4)`,
      [tenant.id, id, siteId, options.quantitePhysiqueMillieme ?? 1000],
    );
  });
  return { id, tenantId: tenant.id, prixVenteTtcCentimes };
}

/** Insère un mouvement de stock — passe TOUJOURS par cette table (jamais un UPDATE direct de
 *  `stock_article`, qui n'est qu'un solde dérivé, voir 0025 §tête). */
export async function creerMouvementStockPourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  articleId: string,
  siteId: string,
  options: {
    readonly type?: string;
    readonly quantiteMillieme?: number;
    readonly motif?: string | null;
  } = {},
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  const type = options.type ?? 'entree_livraison';
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into mouvement_stock (id, tenant_id, article_id, type, quantite_millieme, site_id, motif)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenant.id, articleId, type, options.quantiteMillieme ?? 1000, siteId, options.motif ?? null],
    );
  });
  return { id, tenantId: tenant.id };
}

export async function creerCommandeFournisseurPourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  siteId: string,
  fournisseurId: string,
  statut = 'brouillon',
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into commande_fournisseur (id, tenant_id, fournisseur_id, site_id, statut)
       values ($1, $2, $3, $4, $5)`,
      [id, tenant.id, fournisseurId, siteId, statut],
    );
  });
  return { id, tenantId: tenant.id };
}

/** Ligne d'OR de type `piece`, référençant `articleId` (0029, RP-19) — condition d'entrée d'une
 *  réservation (`reservation_piece_fk_ligne_or`). L'OR porteur reste `planifie` : aucun trigger de
 *  ce lot ne dépend de son statut pour poser une réservation. */
export async function creerLigneOrPiecePourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  ordreReparationId: string,
  articleId: string,
  numeroOrdre: number,
): Promise<{ id: string; tenantId: string; ordreReparationId: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into ligne_or
         (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut,
          designation, article_id, quantite_millieme, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes)
       values ($1, $2, $3, $4, 'piece', 'commandee', 'proposee', $5, $6, 1000, 4620, 370, 4990)`,
      [id, tenant.id, ordreReparationId, numeroOrdre, `Pièce de test #${String(numeroOrdre)}`, articleId],
    );
  });
  return { id, tenantId: tenant.id, ordreReparationId };
}

export async function creerReservationPiecePourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  articleId: string,
  siteId: string,
  ligneOrId: string,
  ordreReparationId: string,
  quantiteMillieme = 1000,
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into reservation_piece (id, tenant_id, article_id, site_id, ligne_or_id, ordre_reparation_id, quantite_millieme)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenant.id, articleId, siteId, ligneOrId, ordreReparationId, quantiteMillieme],
    );
  });
  return { id, tenantId: tenant.id };
}

export async function creerConsignePourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  ligneOrId: string,
  ordreReparationId: string,
  articleId: string,
  siteId: string,
  mouvementEntreeId: string,
  montantConsigneTtcCentimes = 8000,
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into consigne_echange_standard
         (id, tenant_id, ligne_or_id, ordre_reparation_id, article_id, site_id, montant_consigne_ttc_centimes, mouvement_entree_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, tenant.id, ligneOrId, ordreReparationId, articleId, siteId, montantConsigneTtcCentimes, mouvementEntreeId],
    );
  });
  return { id, tenantId: tenant.id };
}

// -------------------------------------------------------------------------------------------
// Pointage
// -------------------------------------------------------------------------------------------

export interface OptionsPointageDeTest {
  readonly nature?: 'productif_ligne' | 'productif_or' | 'indirect';
  readonly ordreReparationId?: string | null;
  readonly ligneOrId?: string | null;
  readonly activiteIndirecte?: string | null;
  readonly statut?: string;
  readonly debutLe?: Date;
  readonly finLe?: Date | null;
}

/** Insère un pointage — `id` TOUJOURS fourni par l'appelant (jamais généré ici) : c'est
 *  exactement la clé d'idempotence hors ligne dont les tests de rejeu ont besoin de garder le
 *  contrôle (RM-87, 0030 §tête). Par défaut, cible `indirect`/`pause` : la cible la plus simple à
 *  satisfaire (aucune dépendance vers un OR/une ligne), pour que les tests qui ne portent pas sur
 *  RM-87 elle-même n'aient pas à construire un OR à chaque fois. */
export async function creerPointagePourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  id: string,
  siteId: string,
  technicienId: string,
  options: OptionsPointageDeTest = {},
): Promise<{ id: string; tenantId: string }> {
  const nature = options.nature ?? 'indirect';
  const statut = options.statut ?? 'en_cours';
  const debutLe = options.debutLe ?? new Date();
  const finLe = statut === 'en_cours' ? null : (options.finLe ?? new Date(debutLe.getTime() + 3_600_000));
  const activiteIndirecte = nature === 'indirect' ? (options.activiteIndirecte ?? 'pause') : null;

  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into pointage
         (id, tenant_id, site_id, technicien_id, statut, nature, ordre_reparation_id, ligne_or_id,
          activite_indirecte, debut_le, fin_le)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        tenant.id,
        siteId,
        technicienId,
        statut,
        nature,
        options.ordreReparationId ?? null,
        options.ligneOrId ?? null,
        activiteIndirecte,
        debutLe,
        finLe,
      ],
    );
  });
  return { id, tenantId: tenant.id };
}

// -------------------------------------------------------------------------------------------
// Ventes — vehicule_stock, dossier_vente, reprise, financement_vente
// -------------------------------------------------------------------------------------------

/** Marque un véhicule (déjà créé par la fixture lot 1, `tenant.vehicules[i]`) comme véhicule EN
 *  STOCK — RV-01, littéral : « vehicule_stock.id EST vehicule.id ». `vehiculeId` doit donc être
 *  l'id d'un véhicule EXISTANT sur ce même tenant (jamais un nouvel id généré ici). */
export async function creerVehiculeStockPourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  siteId: string,
  vehiculeId: string,
  options: { readonly statut?: string; readonly provenance?: string; readonly prixAchatCentimes?: number } = {},
): Promise<{ id: string; tenantId: string }> {
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into vehicule_stock (id, tenant_id, site_id, provenance, date_entree_stock, prix_achat_centimes, statut)
       values ($1, $2, $3, $4, current_date, $5, $6)`,
      [
        vehiculeId,
        tenant.id,
        siteId,
        options.provenance ?? 'occasion_reprise',
        options.prixAchatCentimes ?? 1_500_000,
        options.statut ?? 'disponible',
      ],
    );
  });
  return { id: vehiculeId, tenantId: tenant.id };
}

export async function creerDossierVentePourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  siteId: string,
  clientAcheteurId: string,
  options: { readonly vehiculeId?: string | null; readonly statut?: string } = {},
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into dossier_vente (id, tenant_id, site_id, statut, vehicule_id, client_acheteur_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, tenant.id, siteId, options.statut ?? 'prospection', options.vehiculeId ?? null, clientAcheteurId],
    );
  });
  return { id, tenantId: tenant.id };
}

export async function creerRepriseSurDossierPourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  dossierVenteId: string,
  vehiculeRepriseId: string,
  valeurEstimeeCentimes = 500_000,
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into reprise (id, tenant_id, dossier_vente_id, vehicule_reprise_id, valeur_estimee_centimes)
       values ($1, $2, $3, $4, $5)`,
      [id, tenant.id, dossierVenteId, vehiculeRepriseId, valeurEstimeeCentimes],
    );
  });
  return { id, tenantId: tenant.id };
}

export async function creerFinancementVentePourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  dossierVenteId: string,
  options: { readonly type?: string; readonly statut?: string; readonly organismeId?: string | null } = {},
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  const type = options.type ?? 'comptant';
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into financement_vente (id, tenant_id, dossier_vente_id, type, organisme_id, statut)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, tenant.id, dossierVenteId, type, options.organismeId ?? null, options.statut ?? (type === 'comptant' ? 'confirme' : 'en_attente')],
    );
  });
  return { id, tenantId: tenant.id };
}

export async function creerDocumentRequisPourTest(
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant['tenant'],
  dossierVenteId: string,
  code = 'permis_circulation',
  libelle = 'Permis de circulation',
): Promise<{ id: string; tenantId: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into dossier_vente_document_requis (id, tenant_id, dossier_vente_id, code, libelle)
       values ($1, $2, $3, $4, $5)`,
      [id, tenant.id, dossierVenteId, code, libelle],
    );
  });
  return { id, tenantId: tenant.id };
}
