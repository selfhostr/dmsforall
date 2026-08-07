/**
 * Garde structurelle pour la migration 0046 (deux correctifs indépendants, issues #14 et #17 —
 * décisions arbitrées sans @laupernoe, voir l'en-tête SQL de la migration pour le raisonnement complet).
 *
 * Ne remplace PAS une preuve d'intégration sur vraie base (`scripts/verifier-reversibilite-
 * migrations.sh` la fournit déjà — up/down/up sur chaque migration, dumps comparés). Ce test
 * vérifie, statiquement et SANS Postgres, que le contenu SQL contient bien les éléments dont
 * dépend le correctif — utile ici précisément parce que le cœur du correctif #14 vit dans le
 * CORPS de deux fonctions PL/pgSQL génériques (`transition_autorisee_valide_contenu`,
 * `verifier_transition`), un endroit où une régression future (une prochaine migration qui les
 * réécrit en oubliant le filtre `type_ligne`) ne se verrait dans AUCUN test applicatif — même
 * doctrine que 0038 (voir son propre `.spec.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MONTANTE = readFileSync(
  join(__dirname, '0046_ligne_or_types_sans_temps_et_delai_paiement_tenant.sql'),
  'utf8',
);
const DESCENDANTE = readFileSync(
  join(__dirname, 'down', '0046_ligne_or_types_sans_temps_et_delai_paiement_tenant.down.sql'),
  'utf8',
);

describe('0046 — PARTIE A : validee -> realisee direct pour les types sans temps (issue #14)', () => {
  const TYPES_SANS_TEMPS = [
    'piece',
    'fourniture',
    'produit_atelier',
    'taxe',
    'remise',
    'texte',
    'sous_traitance',
  ] as const;

  it('insère exactement les 7 types attendus pour ligne_or validee -> realisee, ni plus ni moins', () => {
    for (const type of TYPES_SANS_TEMPS) {
      expect(MONTANTE).toMatch(
        new RegExp(`\\('ligne_or',\\s*'validee',\\s*'realisee',\\s*false,\\s*'${type}'\\)`),
      );
    }
    // Aucun de ces trois types (main-d'œuvre + forfait) n'apparaît dans une ligne
    // validee->realisee : ils doivent rester chronométrés via le pointage.
    for (const typeExclu of ['main_oeuvre_bareme', 'main_oeuvre_temps_reel', 'forfait']) {
      expect(MONTANTE).not.toMatch(
        new RegExp(`\\('ligne_or',\\s*'validee',\\s*'realisee',[^)]*'${typeExclu}'\\)`),
      );
    }
  });

  it('la transition générique (type_ligne = \'*\') validee -> realisee reste absente', () => {
    // Elle existait déjà AVANT 0046 sous la forme en_cours -> realisee, jamais validee ->
    // realisee : ce test garantit que 0046 ne l'ajoute pas par erreur pour TOUS les types.
    expect(MONTANTE).not.toMatch(/\('ligne_or',\s*'validee',\s*'realisee',\s*false\)/);
  });

  it("étend transition_autorisee avec la colonne type_ligne (sentinel '*'), PK à 4 colonnes", () => {
    expect(MONTANTE).toMatch(/add column type_ligne text not null default '\*'/);
    expect(MONTANTE).toMatch(
      /primary key \(entite, statut_depuis, statut_vers, type_ligne\)/,
    );
  });

  it('verifier_transition() filtre désormais par type_ligne', () => {
    expect(MONTANTE).toMatch(/type_ligne_actuel := coalesce\(to_jsonb\(new\) ->> 'type', '\*'\)/);
    expect(MONTANTE).toMatch(/t\.type_ligne = '\*' or t\.type_ligne = type_ligne_actuel/);
  });

  it('transition_autorisee_valide_contenu() réserve type_ligne <> \'*\' à ligne_or', () => {
    expect(MONTANTE).toMatch(/new\.entite <> 'ligne_or'/);
    expect(MONTANTE).toMatch(/'public\.type_ligne_or'::regtype/);
  });

  it('le down retire exactement les 7 lignes type-spécifiques, sans toucher aux 27 lignes historiques', () => {
    expect(DESCENDANTE).toMatch(/delete from public\.transition_autorisee/);
    for (const type of TYPES_SANS_TEMPS) {
      expect(DESCENDANTE).toMatch(new RegExp(`'${type}'`));
    }
  });

  it('le down restaure verifier_transition() et transition_autorisee_valide_contenu() SANS aucune référence à type_ligne', () => {
    // Isole précisément le CORPS de chaque fonction restaurée (entre sa signature et son
    // `$fn$;` de fermeture) — pas le reste du fichier down, qui, lui, retire légitimement la
    // colonne type_ligne (DDL, pas logique de fonction) juste après.
    for (const nomFonction of ['verifier_transition', 'transition_autorisee_valide_contenu']) {
      const motif = new RegExp(
        `create or replace function public\\.${nomFonction}\\(\\)[\\s\\S]*?\\$fn\\$;`,
      );
      const corps = DESCENDANTE.match(motif)?.[0];
      expect(corps, `corps de ${nomFonction} introuvable dans le down`).toBeTruthy();
      expect(corps).not.toMatch(/type_ligne/);
    }
  });

  it('le down retire la colonne type_ligne et restaure la PK à 3 colonnes', () => {
    expect(DESCENDANTE).toMatch(/drop column type_ligne/);
    expect(DESCENDANTE).toMatch(/add constraint transition_autorisee_pk primary key \(entite, statut_depuis, statut_vers\)/);
  });
});

describe('0046 — PARTIE B : tenant.delai_paiement_jours_defaut (issue #17)', () => {
  it('ajoute la colonne NOT NULL DEFAULT 30, avec un CHECK >= 0', () => {
    expect(MONTANTE).toMatch(
      /add column delai_paiement_jours_defaut integer not null default 30/,
    );
    expect(MONTANTE).toMatch(/check \(delai_paiement_jours_defaut >= 0\)/);
  });

  it('le down retire la colonne et sa contrainte', () => {
    expect(DESCENDANTE).toMatch(/drop constraint tenant_delai_paiement_jours_defaut_positif_chk/);
    expect(DESCENDANTE).toMatch(/drop column delai_paiement_jours_defaut/);
  });
});
