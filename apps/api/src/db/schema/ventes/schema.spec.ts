/**
 * Tests unitaires du schéma Drizzle de l'étape 4 (ventes VN/VO) — sans base réelle, même esprit
 * que `db/acces-base.posture.spec.ts` : ce qui peut être vérifié statiquement l'est ici,
 * l'application des politiques RLS et des CHECK en conditions réelles reste du ressort des tests
 * d'intégration (testcontainers, hors périmètre de cette suite).
 *
 * Deux familles de garanties :
 *   1. Dérive contrat ↔ base : les valeurs de chaque `pgEnum` restent EXACTEMENT celles publiées
 *      par `@dfa/shared` (`contrats/ventes/enums.ts`) — mêmes valeurs, même ORDRE (l'ordre d'un
 *      enum Postgres est sa sémantique de tri, jamais alphabétique par accident).
 *   2. Règle n°1 du projet (isolation tenant) : chaque table du module porte `tenant_id NOT
 *      NULL` et une FK composite `(tenant_id, ...)` vers chacune de ses tables parentes — jamais
 *      une FK sur le seul `id` de l'étranger, qui rendrait un rattachement inter-tenant
 *      structurellement possible.
 */

import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  STATUTS_COMMERCIAUX_VEHICULE,
  STATUTS_CONFIRMATION_FINANCEMENT,
  STATUTS_DOSSIER_VENTE,
  STATUTS_REPRISE,
  TYPES_FINANCEMENT_VENTE,
} from '@dfa/shared';

import {
  statutCommercialVehiculeEnum,
  statutConfirmationFinancementEnum,
  statutDossierVenteEnum,
  statutRepriseEnum,
  typeFinancementVenteEnum,
} from './enums';
import { vehiculeStock } from './vehicule-stock';
import { dossierVente } from './dossier-vente';
import { dossierVenteDocumentRequis } from './document-requis';
import { reprise } from './reprise';
import { financementVente } from './financement';

describe('schema/ventes — enums : mêmes valeurs, même ordre que @dfa/shared', () => {
  it('statutCommercialVehiculeEnum ≡ STATUTS_COMMERCIAUX_VEHICULE (RV-09)', () => {
    expect(statutCommercialVehiculeEnum.enumValues).toEqual(STATUTS_COMMERCIAUX_VEHICULE);
  });

  it('statutDossierVenteEnum ≡ STATUTS_DOSSIER_VENTE (§6.2)', () => {
    expect(statutDossierVenteEnum.enumValues).toEqual(STATUTS_DOSSIER_VENTE);
  });

  it('statutRepriseEnum ≡ STATUTS_REPRISE (§6.3)', () => {
    expect(statutRepriseEnum.enumValues).toEqual(STATUTS_REPRISE);
  });

  it('typeFinancementVenteEnum ≡ TYPES_FINANCEMENT_VENTE (RV-39/44)', () => {
    expect(typeFinancementVenteEnum.enumValues).toEqual(TYPES_FINANCEMENT_VENTE);
  });

  it('statutConfirmationFinancementEnum ≡ STATUTS_CONFIRMATION_FINANCEMENT (CV-03)', () => {
    expect(statutConfirmationFinancementEnum.enumValues).toEqual(STATUTS_CONFIRMATION_FINANCEMENT);
  });
});

describe('schema/ventes — vehicule_stock (RV-01→RV-14)', () => {
  const cfg = getTableConfig(vehiculeStock);

  it("s'appelle vehicule_stock", () => {
    expect(cfg.name).toBe('vehicule_stock');
  });

  it('porte tenant_id NOT NULL (règle n°1)', () => {
    const col = cfg.columns.find((c) => c.name === 'tenant_id');
    expect(col?.notNull).toBe(true);
  });

  it("id N'A AUCUN défaut — RV-01, littéral : « il n'existe pas de second identifiant », la valeur doit être vehicule.id fourni par le service", () => {
    const col = cfg.columns.find((c) => c.name === 'id');
    expect(col?.hasDefault).toBe(false);
    expect(col?.primary).toBe(true);
  });

  it('la colonne de statut s\'appelle littéralement "statut" — verifier_transition() (0003) lit new.statut/old.statut sans indirection', () => {
    const col = cfg.columns.find((c) => c.name === 'statut');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
  });

  it('déclare les FK composites (tenant_id, …) attendues vers vehicule et site', () => {
    const noms = cfg.foreignKeys.map((fk) => fk.getName());
    expect(noms).toEqual(
      expect.arrayContaining(['vehicule_stock_fk_vehicule', 'vehicule_stock_fk_site']),
    );
  });

  it("ne modélise PAS la FK vers dossier_vente côté Drizzle (cycle d'import évité, posée en SQL brut dans 0032 §4 — voir le commentaire en tête du fichier)", () => {
    const noms = cfg.foreignKeys.map((fk) => fk.getName());
    expect(noms).not.toContain('vehicule_stock_fk_origine_reprise');
  });

  it('unique(tenant_id, id) — cible possible de FK composites depuis les autres tables', () => {
    expect(cfg.uniqueConstraints.map((u) => u.name)).toContain('vehicule_stock_tenant_id_uk');
  });

  it('les CHECK attendus sont posés (présence, pas le contenu — le SQL de 0032 fait foi)', () => {
    const noms = cfg.checks.map((c) => c.name);
    expect(noms).toEqual(
      expect.arrayContaining([
        'vehicule_stock_provenance_non_vide_chk',
        'vehicule_stock_prix_achat_chk',
        'vehicule_stock_prix_vente_affiche_chk',
        'vehicule_stock_origine_reprise_coherente_chk',
        'vehicule_stock_en_commande_provenance_chk',
      ]),
    );
  });
});

describe('schema/ventes — dossier_vente (RV-29→RV-38)', () => {
  const cfg = getTableConfig(dossierVente);

  it('porte tenant_id NOT NULL (règle n°1)', () => {
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
  });

  it('vehicule_id est NULLABLE (RV-30 : dossier possible sans véhicule tant que prospection)', () => {
    expect(cfg.columns.find((c) => c.name === 'vehicule_id')?.notNull).toBe(false);
  });

  it('client_acheteur_id est NOT NULL — un dossier a toujours un acheteur', () => {
    expect(cfg.columns.find((c) => c.name === 'client_acheteur_id')?.notNull).toBe(true);
  });

  it('déclare une FK composite distincte pour chacun des trois rôles client (RV-36)', () => {
    const noms = cfg.foreignKeys.map((fk) => fk.getName());
    expect(noms).toEqual(
      expect.arrayContaining([
        'dossier_vente_fk_client_acheteur',
        'dossier_vente_fk_client_facture',
        'dossier_vente_fk_client_conducteur',
        'dossier_vente_fk_vehicule_stock',
      ]),
    );
  });

  it('porte le verrou anti-double-engagement (RV-10/CV-01) : index unique PARTIEL sur (tenant_id, vehicule_id)', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'dossier_vente_vehicule_engage_uk');
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
  });

  it('le CHECK RV-30 (véhicule requis dès engage) est posé', () => {
    expect(cfg.checks.map((c) => c.name)).toContain('dossier_vente_vehicule_requis_engage_chk');
  });

  it('porte un horodatage NULLABLE par état entrant du diagramme §6.2 (hors prospection == cree_le)', () => {
    for (const nom of [
      'engage_le',
      'en_preparation_le',
      'pret_a_livrer_le',
      'livre_le',
      'clos_le',
      'annule_le',
      'abandonne_le',
    ]) {
      const col = cfg.columns.find((c) => c.name === nom);
      expect(col, `colonne ${nom} manquante`).toBeDefined();
      expect(col?.notNull).toBe(false);
    }
  });

  it("ne porte PAS de colonne prospection_le — TOUJOURS égal à cree_le, jamais dupliqué", () => {
    expect(cfg.columns.find((c) => c.name === 'prospection_le')).toBeUndefined();
  });

  it('identite_piece_type / identite_verifiee_le (RV-34) sont NULLABLES', () => {
    expect(cfg.columns.find((c) => c.name === 'identite_piece_type')?.notNull).toBe(false);
    expect(cfg.columns.find((c) => c.name === 'identite_verifiee_le')?.notNull).toBe(false);
  });
});

describe('schema/ventes — reprise (RV-19→RV-28)', () => {
  const cfg = getTableConfig(reprise);

  it('porte tenant_id NOT NULL (règle n°1)', () => {
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
  });

  it('au plus une reprise par dossier : unique(tenant_id, dossier_vente_id)', () => {
    expect(cfg.uniqueConstraints.map((u) => u.name)).toContain('reprise_tenant_dossier_uk');
  });

  it('valeur_estimee_centimes est NOT NULL, valeur_negociee_centimes est NULLABLE (RV-19 : deux valeurs distinctes, jamais fusionnées)', () => {
    expect(cfg.columns.find((c) => c.name === 'valeur_estimee_centimes')?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === 'valeur_negociee_centimes')?.notNull).toBe(false);
  });

  it('vehicule_reprise_id référence vehicule (pas vehicule_stock) — RV-24 : entre en stock seulement à la livraison', () => {
    const fk = cfg.foreignKeys.find((f) => f.getName() === 'reprise_fk_vehicule_reprise');
    expect(fk).toBeDefined();
  });

  it("ecart_reprise_vehicule_centimes n'est PAS une colonne — dérivé, calculé à la lecture (voir le commentaire de reprise.ts)", () => {
    expect(cfg.columns.find((c) => c.name === 'ecart_reprise_vehicule_centimes')).toBeUndefined();
  });
});

describe('schema/ventes — financement_vente (RV-39→RV-45)', () => {
  const cfg = getTableConfig(financementVente);

  it('porte tenant_id NOT NULL (règle n°1)', () => {
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
  });

  it("ne porte PAS de colonne actif — contrats/ventes/financement.ts n'expose aucun drapeau, le \"courant\" est une dérivation en lecture (tri par cree_le)", () => {
    expect(cfg.columns.find((c) => c.name === 'actif')).toBeUndefined();
  });

  it('credit ET leasing exigent un organisme (contrat, littéral) — CHECK posé', () => {
    expect(cfg.checks.map((c) => c.name)).toContain('financement_vente_organisme_requis_chk');
  });

  it('un financement refusé porte un motif (CV-03) — CHECK posé', () => {
    expect(cfg.checks.map((c) => c.name)).toContain('financement_vente_motif_refus_chk');
  });

  it('statut est NOT NULL SANS défaut — CV-03 : la valeur initiale dépend du type (comptant = confirme direct, credit/leasing = en_attente), pas d\'un défaut de colonne unique', () => {
    const col = cfg.columns.find((c) => c.name === 'statut');
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(false);
  });

  it("l'index (tenant_id, dossier_vente_id, cree_le desc) sert la dérivation du financement courant", () => {
    const noms = cfg.indexes.map((i) => i.config.name);
    expect(noms).toContain('financement_vente_dossier_idx');
  });
});

describe('schema/ventes — dossier_vente_document_requis (RV-35)', () => {
  const cfg = getTableConfig(dossierVenteDocumentRequis);

  it('porte tenant_id NOT NULL (règle n°1)', () => {
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
  });

  it('au plus un item par (dossier, code)', () => {
    expect(cfg.uniqueConstraints.map((u) => u.name)).toContain(
      'dossier_vente_document_requis_tenant_dossier_code_uk',
    );
  });

  it('fourni/fourni_le sont cohérents par CHECK', () => {
    expect(cfg.checks.map((c) => c.name)).toContain(
      'dossier_vente_document_requis_fourni_coherent_chk',
    );
  });
});

describe('schema/ventes — isolation tenant : chaque table du module (règle n°1)', () => {
  const tables = [
    ['vehicule_stock', vehiculeStock],
    ['dossier_vente', dossierVente],
    ['dossier_vente_document_requis', dossierVenteDocumentRequis],
    ['reprise', reprise],
    ['financement_vente', financementVente],
  ] as const;

  it.each(tables)('%s porte tenant_id NOT NULL', (_nom, table) => {
    const cfg = getTableConfig(table);
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
  });

  it.each(tables)('%s ne déclare AUCUNE FK sur le seul id de l\'étranger (toujours (tenant_id, …))', (_nom, table) => {
    const cfg = getTableConfig(table);
    for (const fk of cfg.foreignKeys) {
      const reference = fk.reference();
      // Exception UNIQUE et volontaire, posée par `colonneTenantId().references(() =>
      // tenant.id, …)` (même patron que schema/atelier/vehicule.ts et tout le dépôt) : la colonne
      // `tenant_id` elle-même référence `tenant.id` en mono-colonne — ce n'est pas le trou que ce
      // test cherche (il n'existe qu'un seul tenant possible pour cette FK précise, la table
      // `tenant` elle-même).
      const estAutoReferenceTenant =
        reference.columns.length === 1 &&
        reference.columns[0]?.name === 'tenant_id' &&
        reference.foreignColumns.length === 1 &&
        reference.foreignColumns[0]?.name === 'id' &&
        getTableConfig(reference.foreignTable as typeof table).name === 'tenant';
      if (estAutoReferenceTenant) continue;

      // Toute AUTRE FK de ce module doit être composite (au moins 2 colonnes), avec tenant_id en
      // tête — une FK mono-colonne sur un id étranger permettrait de rattacher une ligne d'un
      // tenant A à une ligne d'un tenant B partageant le même UUID d'id (improbable en pratique,
      // mais STRUCTURELLEMENT possible sans la composition — exactement ce que ce test interdit).
      expect(reference.columns.length).toBeGreaterThanOrEqual(2);
      expect(reference.columns[0]?.name).toBe('tenant_id');
      expect(reference.foreignColumns[0]?.name).toBe('tenant_id');
    }
  });
});
