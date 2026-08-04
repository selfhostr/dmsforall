import { describe, expect, it } from 'vitest';
import { interpreterContrainteVehicule } from './erreurs-contraintes';

/**
 * Défaut HAUT confirmé à l'audit (2026-08-04) : les trois contraintes ci-dessous remontaient en
 * `500 ERREUR_INTERNE` au lieu d'une `ErreurMetier` propre. Deux causes cumulées :
 *  - `vehicule_vin_format_chk` et `vehicule_detention_periode_chk` (SQLSTATE `23514`, CHECK)
 *    n'étaient simplement pas dans la table de contraintes reconnues (seuls `23505`/`23P01`
 *    l'étaient) ;
 *  - même une contrainte déjà « câblée » (`vehicule_plaque_collision_excl`) ne remontait jamais,
 *    parce que Drizzle (`pg-core/session.js`) enveloppe systématiquement l'erreur `pg` brute dans
 *    une `DrizzleQueryError` dont le SQLSTATE/nom de contrainte vit sous `.cause`, jamais en
 *    surface — et l'ancienne implémentation ne lisait que la surface.
 *
 * Ce fichier prouve les deux formes réellement observées en pratique (brute ET enveloppée sous
 * `.cause`), pour ne jamais régresser silencieusement sur l'une des deux.
 */

/** Reproduit la forme réelle d'un `DatabaseError` du pilote `pg` pour une violation de contrainte. */
function erreurPgBrute(
  code: string,
  constraint: string,
): Error & { code: string; constraint: string } {
  const erreur = new Error(`erreur pg simulée : ${constraint}`) as Error & {
    code: string;
    constraint: string;
  };
  erreur.code = code;
  erreur.constraint = constraint;
  return erreur;
}

/** Reproduit la forme réelle d'une `DrizzleQueryError` (`drizzle-orm/pg-core/session.js`). */
function erreurDrizzleEnveloppee(code: string, constraint: string): Error & { cause: unknown } {
  const enveloppe = new Error('Failed query') as Error & { cause: unknown };
  enveloppe.cause = erreurPgBrute(code, constraint);
  return enveloppe;
}

describe('interpreterContrainteVehicule', () => {
  describe('forme enveloppée sous .cause (Drizzle — la forme réelle en production)', () => {
    it('reconnaît vehicule_vin_format_chk (23514 CHECK) en VALIDATION_ECHOUEE', () => {
      const resultat = interpreterContrainteVehicule(
        erreurDrizzleEnveloppee('23514', 'vehicule_vin_format_chk'),
      );
      expect(resultat).toEqual({
        code: 'VALIDATION_ECHOUEE',
        contrainte: 'vehicule_vin_format_chk',
      });
    });

    it('reconnaît vehicule_plaque_collision_excl (23P01 EXCLUSION) en VEHICULE_PLAQUE_COLLISION', () => {
      const resultat = interpreterContrainteVehicule(
        erreurDrizzleEnveloppee('23P01', 'vehicule_plaque_collision_excl'),
      );
      expect(resultat).toEqual({
        code: 'VEHICULE_PLAQUE_COLLISION',
        contrainte: 'vehicule_plaque_collision_excl',
      });
    });

    it('reconnaît vehicule_detention_periode_chk (23514 CHECK) en VALIDATION_ECHOUEE', () => {
      const resultat = interpreterContrainteVehicule(
        erreurDrizzleEnveloppee('23514', 'vehicule_detention_periode_chk'),
      );
      expect(resultat).toEqual({
        code: 'VALIDATION_ECHOUEE',
        contrainte: 'vehicule_detention_periode_chk',
      });
    });

    it('reconnaît vehicule_detention_unicite_excl (23P01 EXCLUSION) en VALIDATION_ECHOUEE (§7.4)', () => {
      const resultat = interpreterContrainteVehicule(
        erreurDrizzleEnveloppee('23P01', 'vehicule_detention_unicite_excl'),
      );
      expect(resultat).toEqual({
        code: 'VALIDATION_ECHOUEE',
        contrainte: 'vehicule_detention_unicite_excl',
      });
    });

    it('reconnaît vehicule_vin_actif_uk (23505 UNIQUE) en VEHICULE_VIN_EXISTANT', () => {
      const resultat = interpreterContrainteVehicule(
        erreurDrizzleEnveloppee('23505', 'vehicule_vin_actif_uk'),
      );
      expect(resultat).toEqual({
        code: 'VEHICULE_VIN_EXISTANT',
        contrainte: 'vehicule_vin_actif_uk',
      });
    });
  });

  describe('forme brute (pilote pg directement, sans passer par Drizzle)', () => {
    it('reconnaît une contrainte CHECK non enveloppée', () => {
      const resultat = interpreterContrainteVehicule(
        erreurPgBrute('23514', 'vehicule_vin_format_chk'),
      );
      expect(resultat).toEqual({
        code: 'VALIDATION_ECHOUEE',
        contrainte: 'vehicule_vin_format_chk',
      });
    });
  });

  describe('non-reconnaissance — repli sur le traitement générique de l’appelant', () => {
    it('rend null pour un SQLSTATE non couvert par ce module', () => {
      expect(
        interpreterContrainteVehicule(erreurDrizzleEnveloppee('23503', 'vehicule_plaque_fk')),
      ).toBeNull();
    });

    it('rend null pour une contrainte CHECK reconnue en SQLSTATE mais inconnue par son nom', () => {
      expect(
        interpreterContrainteVehicule(
          erreurDrizzleEnveloppee('23514', 'vehicule_marque_non_vide_chk'),
        ),
      ).toBeNull();
    });

    it('rend null pour une exception sans .cause ni code exploitable', () => {
      expect(interpreterContrainteVehicule(new Error('boom'))).toBeNull();
    });

    it('rend null pour une valeur non-objet', () => {
      expect(interpreterContrainteVehicule('boom')).toBeNull();
      expect(interpreterContrainteVehicule(null)).toBeNull();
      expect(interpreterContrainteVehicule(undefined)).toBeNull();
    });

    it('ne boucle jamais à l’infini sur une chaîne .cause cyclique', () => {
      const cyclique = new Error('cyclique') as Error & { cause: unknown };
      cyclique.cause = cyclique;
      expect(interpreterContrainteVehicule(cyclique)).toBeNull();
    });
  });
});
