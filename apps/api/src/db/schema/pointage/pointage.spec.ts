/**
 * Verrous structurels du schéma `pointage` — introspection Drizzle pure, SANS base réelle (le
 * comportement SQL lui-même — CHECK exécutés, RLS, triggers — n'est prouvé que par
 * `pnpm test:integration` et par la vérification manuelle d'isolation tenant). Ce que ce fichier
 * verrouille : les DEUX décisions de conception documentées dans `pointage.ts`/
 * `verrouillage-site.ts`, pour qu'un renommage ou une suppression accidentelle de colonne/
 * contrainte se voie sans docker.
 */

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { pointage, pointageVerrouillageSite } from './index';

describe('schéma pointage', () => {
  it('porte la table `pointage` avec ses CHECK RM-87/RM-89 documentées', () => {
    const config = getTableConfig(pointage);
    expect(config.name).toBe('pointage');

    const nomsCheck = config.checks.map((c) => c.name);
    // RM-87 : exactement une cible (ligne / OR / activité indirecte) selon `nature`.
    expect(nomsCheck).toContain('pointage_cible_coherente_chk');
    // Cohérence statut <-> présence de finLe.
    expect(nomsCheck).toContain('pointage_fin_coherente_chk');
    expect(nomsCheck).toContain('pointage_periode_coherente_chk');
    expect(nomsCheck).toContain('pointage_anomalie_coherente_chk');
    expect(nomsCheck).toContain('pointage_anomalie_traitee_chk');
    expect(nomsCheck).toContain('pointage_derniere_correction_coherente_chk');
  });

  it('fournit `id` SANS défaut serveur — c\'est le client qui le fixe (idempotence hors ligne)', () => {
    const config = getTableConfig(pointage);
    const colonneId = config.columns.find((c) => c.name === 'id');

    expect(colonneId).toBeDefined();
    expect(colonneId?.hasDefault).toBe(false);
    expect(colonneId?.notNull).toBe(true);
  });

  it('déclare les cinq clés étrangères composites attendues (site, technicien, OR, ligne d\'OR, correcteur) ' +
    'plus la FK simple tenant_id', () => {
    const config = getTableConfig(pointage);
    const noms = config.foreignKeys.map((fk) => fk.getName());

    expect(noms).toContain('pointage_fk_site');
    expect(noms).toContain('pointage_fk_technicien');
    expect(noms).toContain('pointage_fk_ordre_reparation');
    expect(noms).toContain('pointage_fk_ligne_or');
    expect(noms).toContain('pointage_fk_derniere_correction_par');
    // + 1 : la FK tenant_id -> tenant(id), déclarée en ligne via `.references()` (colonnes-communes).
    expect(config.foreignKeys).toHaveLength(6);
  });

  it("n'exprime aucune unicité qui empêcherait plusieurs pointages `en_cours` sur la même " +
    'ligne/OR — question 2 volontairement laissée ouverte (voir pointage.ts)', () => {
    const config = getTableConfig(pointage);
    // Le seul index unique attendu au niveau Drizzle est absent : la contrainte anti-chevauchement
    // PAR TECHNICIEN (pointage_technicien_un_seul_en_cours_uk) est un index PARTIEL posé en SQL
    // brut (migration), non modélisable via pg-core — donc absent d'ici PAR CONSTRUCTION. Ce test
    // verrouille l'absence de toute unicité portant sur `ligneOrId` ou `ordreReparationId` seuls,
    // qui serait, elle, exprimable ici et donc une régression si elle apparaissait.
    const colonnesUniques = config.uniqueConstraints.flatMap((u) => u.columns.map((c) => c.name));
    expect(colonnesUniques).not.toContain('ligne_or_id');
  });
});

describe('schéma pointage_verrouillage_site', () => {
  // Depuis la migration 0035 (correctif du défaut « record "new" has no field "id" » sur
  // auditer_atelier('periode_pointage')) : PK technique à une seule colonne (id), comme
  // tenant_bloc_creancier (0014) — même situation de singleton. L'invariant métier « un seuil par
  // site, pas par pointage » ne dépend plus de LA FORME de la PK : il est désormais porté par le
  // UNIQUE (tenant_id, site_id) vérifié juste en dessous.
  it('porte une PK technique à une seule colonne (id) — pattern tenant_bloc_creancier', () => {
    const config = getTableConfig(pointageVerrouillageSite);
    expect(config.name).toBe('pointage_verrouillage_site');
    // `colonneId()` pose une PK AU NIVEAU COLONNE (`.primaryKey()` chaîné) — comme
    // tenant_bloc_creancier, elle n'apparaît donc PAS dans `config.primaryKeys` (réservé aux
    // `primaryKey({ columns: [...] })` déclarées au niveau table). Le signal exact est
    // `column.primary`.
    const colonnesPk = config.columns.filter((c) => c.primary).map((c) => c.name);
    expect(colonnesPk).toEqual(['id']);
  });

  it('porte un seuil par site, pas par pointage — UNIQUE (tenant_id, site_id)', () => {
    const config = getTableConfig(pointageVerrouillageSite);
    const contrainteSite = config.uniqueConstraints.find((u) => u.name === 'pointage_verrouillage_site_tenant_site_uk');
    expect(contrainteSite).toBeDefined();

    const colonnes = contrainteSite?.columns.map((c) => c.name).sort();
    expect(colonnes).toEqual(['site_id', 'tenant_id']);
  });

  it('déclare les deux clés étrangères (site, dernier utilisateur) et la CHECK de cohérence', () => {
    const config = getTableConfig(pointageVerrouillageSite);
    const noms = config.foreignKeys.map((fk) => fk.getName());
    expect(noms).toContain('pointage_verrouillage_site_fk_site');
    expect(noms).toContain('pointage_verrouillage_site_fk_utilisateur');

    const nomsCheck = config.checks.map((c) => c.name);
    expect(nomsCheck).toContain('pointage_verrouillage_site_derniere_action_coherente_chk');
  });
});
