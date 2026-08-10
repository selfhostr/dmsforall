import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { schemaParametresRecherche } from '@dfa/shared';

import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';
import { CLE_META_ACTION, GardeDroit } from '../common/droits';
import { GardeLimitationRecherche } from '../common/securite';

import { RechercheController } from './recherche.controller';

/** Rôles qui détiennent une action donnée dans MATRICE_DROITS, triés pour comparaison stable. */
function rolesAyant(action: Action): string[] {
  return (Object.keys(MATRICE_DROITS) as (keyof typeof MATRICE_DROITS)[])
    .filter((role) => (MATRICE_DROITS[role] as readonly Action[]).includes(action))
    .sort();
}

/**
 * `RechercheController` porte ses décorateurs au niveau CLASSE (`@ExigerDroit`/`@UseGuards` juste
 * au-dessus de `export class RechercheController`, pas sur `rechercher()`) — seule route du
 * contrôleur, mais la garde s'applique quand même par la classe. Ce fichier vérifie donc les
 * métadonnées de la CLASSE, pas d'un handler, contrairement au patron des autres contrôleurs de ce
 * lot.
 */
describe('RechercheController — guards et droit au niveau classe (câblage réel)', () => {
  it('porte @UseGuards(GardeDroit, GardeLimitationRecherche) — GardeDroit AVANT la limitation de débit', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, RechercheController) as
      unknown[] | undefined;

    expect(guards).toBeDefined();
    expect(guards).toContain(GardeDroit);
    expect(guards).toContain(GardeLimitationRecherche);
    // Ordre significatif (finding D-01) : un rôle sans droit doit être refusé (403) AVANT de
    // consommer le budget de débit de la limitation — voir l'en-tête de `recherche.controller.ts`.
    expect((guards ?? []).indexOf(GardeDroit)).toBeLessThan(
      (guards ?? []).indexOf(GardeLimitationRecherche),
    );
  });

  it('exige exactement recherche.executer', () => {
    expect(Reflect.getMetadata(CLE_META_ACTION, RechercheController)).toBe('recherche.executer');
  });

  it('recherche.executer est ouvert aux 8 rôles de PERSONNE, la borne (poste_atelier) exclue (RM-112 : outil transversal, pas un usage de comptoir mural)', () => {
    const roles = rolesAyant('recherche.executer');
    expect(roles).toEqual(
      [
        'admin',
        'chef_atelier',
        'comptable',
        'direction',
        'magasinier',
        'receptionnaire',
        'technicien',
        'vendeur',
      ].sort(),
    );
    expect(roles).not.toContain('poste_atelier');
  });
});

describe('RechercheController — validation d’entrée (schéma réel, pas de mock)', () => {
  it('schemaParametresRecherche rejette un q vide — 400, jamais un scan non filtré', () => {
    expect(schemaParametresRecherche.safeParse({ q: '' }).success).toBe(false);
  });

  it('schemaParametresRecherche rejette un q absent', () => {
    expect(schemaParametresRecherche.safeParse({}).success).toBe(false);
  });

  it('schemaParametresRecherche rejette une limite au-delà de 50 (§7.5 : projection, pas une collection paginée)', () => {
    expect(schemaParametresRecherche.safeParse({ q: '123456', limite: 51 }).success).toBe(false);
  });

  it('schemaParametresRecherche rejette une limite à 0', () => {
    expect(schemaParametresRecherche.safeParse({ q: '123456', limite: 0 }).success).toBe(false);
  });

  it('schemaParametresRecherche applique le défaut limite=20 quand absent', () => {
    const resultat = schemaParametresRecherche.safeParse({ q: '123456' });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.limite).toBe(20);
  });

  it('schemaParametresRecherche rejette un type de résultat hors énumération (types déjà en tableau)', () => {
    const resultat = schemaParametresRecherche.safeParse({ q: '123456', types: ['type-invente'] });
    expect(resultat.success).toBe(false);
  });

  /**
   * DÉFAUT DE DOCUMENTATION TROUVÉ (pas un bug de comportement) — signalé au rapport, pas corrigé
   * ici (hors périmètre d'écriture). L'en-tête de `recherche.controller.ts` justifie son
   * `z.preprocess(...)` local (`schemaParametresRechercheRequete`) en affirmant : « Sans ce
   * `preprocess`, `?types=vehicule` échouerait la validation zod ». C'est FAUX, vérifié ici en
   * exécution contre le schéma GELÉ réel : `types` y est défini via
   * `schemaListeQuery(z.enum(TYPES_RESULTAT_RECHERCHE)).optional()` (`packages/shared/src/
   * contrats/atelier/recherche.ts`), et `schemaListeQuery` (`packages/shared/src/contrats/
   * filtres.ts`) applique DÉJÀ `coercionListeQuery` — précisément conçue pour ce cas : « un
   * paramètre de query string, une seule occurrence rendue en chaîne par Express/qs ». Le
   * preprocess local du contrôleur est donc une redondance inoffensive (même résultat, appliqué
   * deux fois), pas un correctif nécessaire — mais son commentaire justificatif induit en erreur
   * un futur lecteur qui pourrait croire, à tort, que le schéma gelé ne gère pas ce cas.
   */
  it('le schéma gelé (sans le preprocess local du contrôleur) accepte DÉJÀ une chaîne nue pour types, via schemaListeQuery — le preprocess du contrôleur est redondant', () => {
    const resultat = schemaParametresRecherche.safeParse({ q: '123456', types: 'vehicule' });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.types).toEqual(['vehicule']);
  });
});
