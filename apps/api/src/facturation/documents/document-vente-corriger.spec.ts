/**
 * REMPLACE `document-vente-corriger-absent.spec.ts` (14.08.2026), comme sa propre docstring
 * l'exigeait : « CE TEST DOIT ÊTRE REMPLACÉ, pas seulement mis à jour, le jour où l'endpoint est
 * implémenté ». `POST /documents-vente/{id}/corriger` existe maintenant
 * (`DocumentVenteTransitionsController.corriger`) — ce fichier verrouille la matrice rôle × action
 * HTTP annoncée par l'ancien test :
 *
 *  - la route existe, gardée par `GardeDroit` (héritage `@UseGuards(GardeDroit)` de la classe) ;
 *  - elle porte l'action DÉDIÉE `facturation.document.corriger` (`CLE_META_ACTION`), jamais
 *    `facturation.document.emettre_avoir`/`facturation.avoir.creer` (qui incluent à tort
 *    `receptionnaire` pour ce geste plus engageant) ;
 *  - `MATRICE_DROITS` (source de vérité RÉELLE consultée par `GardeDroit`, pas une copie locale)
 *    n'accorde cette action qu'à `direction`/`comptable` — les sept autres rôles (`vendeur`,
 *    `receptionnaire`, `chef_atelier`, `magasinier`, `technicien`, `admin`, `poste_atelier`)
 *    recevraient `403 DROIT_INSUFFISANT` en exécution réelle.
 *
 * PUREMENT STATIQUE (même technique que le fichier remplacé et que
 * `common/droits/toutes-les-routes-decorees.spec.ts`) : lit les décorateurs Nest via
 * `Reflect.getMetadata`/`MATRICE_DROITS` importée telle quelle, n'instancie ni contrôleur ni
 * service, n'ouvre aucune connexion Postgres/Redis.
 */
import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { ROLES_UTILISATEUR, type RoleUtilisateur } from '@dfa/shared';

import { MATRICE_DROITS } from '../../auth/matrice-droits';
import { CLE_META_ACTION } from '../../common/droits/garde-droit';

import { DocumentVenteTransitionsController } from './document-vente-transitions.controller';

const ROLES_AUTORISES: readonly RoleUtilisateur[] = ['direction', 'comptable'];

describe('POST /documents-vente/{factureId}/corriger — route réelle', () => {
  it("la route ':factureId/corriger' existe, en POST, sur DocumentVenteTransitionsController", () => {
    const handler = DocumentVenteTransitionsController.prototype.corriger;
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':factureId/corriger');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it("porte l'action DÉDIÉE 'facturation.document.corriger' (pas emettre_avoir/avoir.creer)", () => {
    const handler = DocumentVenteTransitionsController.prototype.corriger;
    expect(Reflect.getMetadata(CLE_META_ACTION, handler)).toBe('facturation.document.corriger');
  });

  it.each(ROLES_UTILISATEUR.map((role) => [role] as const))(
    'MATRICE_DROITS["%s"] — corriger une facture accordé UNIQUEMENT à direction/comptable',
    (role) => {
      const accorde = MATRICE_DROITS[role].includes('facturation.document.corriger');
      expect(accorde).toBe(ROLES_AUTORISES.includes(role));
    },
  );
});
