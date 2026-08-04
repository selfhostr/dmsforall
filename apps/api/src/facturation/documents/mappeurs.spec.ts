import type { RoleUtilisateur } from '@dfa/shared';
import { describe, expect, it } from 'vitest';

import type { LigneLigneDocument } from '../../db/schema';

import { mapperLigneDocument, roleVoitLesMontants } from './mappeurs';

/**
 * Régression de l'audit RF-115/RF-116 : `mappeurs.ts` n'était importé par AUCUN `.spec.ts`, d'où un
 * trou de couverture — les champs MONÉTAIRES de ligne (`prixUnitaireTtcCentimes`,
 * `remiseMontantCentimes`, `remiseGlobaleRepartieCentimes`) restaient exposés pour `technicien`/`admin`
 * alors que l'agrégat `montants` était masqué : il suffisait de multiplier le prix par la quantité
 * pour reconstituer chaque montant. Ces tests verrouillent le masquage cohérent des QUATRE champs.
 */

const CHAMPS_MONETAIRES_LIGNE = [
  'prixUnitaireTtcCentimes',
  'remiseMontantCentimes',
  'remiseGlobaleRepartieCentimes',
  'montants',
] as const;

function ligneFixture(): LigneLigneDocument {
  const maintenant = new Date('2026-08-04T10:00:00.000Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    documentId: '33333333-3333-4333-8333-333333333333',
    numeroOrdre: 1,
    typeLigne: 'forfait',
    designation: 'Vidange moteur',
    referenceTexte: 'REF-42',
    ligneOrId: null,
    documentAcompteId: null,
    categorieComptable: null,
    modeCalculTva: 'ttc',
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-04',
    quantiteMillieme: 2000,
    prixUnitaireCentimes: 12000,
    remisePourmille: 50,
    remiseMontantCentimes: 500,
    remiseGlobaleRepartieCentimes: 200,
    baseCentimes: 24000,
    htCentimes: 22200,
    tvaCentimes: 1798,
    ttcCentimes: 23998,
    montantValoriseCentimes: 23998,
    creeLe: maintenant,
    modifieLe: maintenant,
  };
}

describe('roleVoitLesMontants', () => {
  it('exclut technicien ET admin (RF-116), autorise comptable et direction', () => {
    expect(roleVoitLesMontants('technicien')).toBe(false);
    expect(roleVoitLesMontants('admin')).toBe(false);
    expect(roleVoitLesMontants('comptable')).toBe(true);
    expect(roleVoitLesMontants('direction')).toBe(true);
  });
});

describe('mapperLigneDocument — fuite de montants par rôle', () => {
  for (const role of ['comptable', 'direction'] as const) {
    it(`expose tous les champs monétaires pour ${role}`, () => {
      const ligne = mapperLigneDocument(ligneFixture(), role);
      expect(ligne.prixUnitaireTtcCentimes).toBe(12000);
      expect(ligne.remiseMontantCentimes).toBe(500);
      expect(ligne.remiseGlobaleRepartieCentimes).toBe(200);
      expect(ligne.montants).toEqual({
        montantHtCentimes: 22200,
        montantTvaCentimes: 1798,
        montantTtcCentimes: 23998,
        montantFacturableCentimes: 23998,
        montantValoriseCentimes: 23998,
      });
    });
  }

  for (const role of ['technicien', 'admin'] as const) {
    it(`retire TOUS les champs monétaires de ligne pour ${role} (absents, pas null)`, () => {
      const ligne = mapperLigneDocument(ligneFixture(), role);

      // Aucun champ monétaire ne doit être présent — même traitement que l'agrégat masqué.
      for (const champ of CHAMPS_MONETAIRES_LIGNE) {
        expect(champ in ligne).toBe(false);
      }
      // Absents, jamais mis à `null` de façon incohérente.
      expect(ligne.prixUnitaireTtcCentimes).toBeUndefined();
      expect(ligne.remiseMontantCentimes).toBeUndefined();
      expect(ligne.remiseGlobaleRepartieCentimes).toBeUndefined();
      expect(ligne.montants).toBeUndefined();

      // Sérialisé : le montant ne doit apparaître nulle part dans la réponse (ni reconstituable).
      const json = JSON.stringify(ligne);
      expect(json).not.toContain('12000');
      expect(json).not.toContain('23998');
      expect(json).not.toContain('500');
    });

    it(`conserve les champs NON monétaires (taux, quantité, régime) pour ${role}`, () => {
      const ligne = mapperLigneDocument(ligneFixture(), role);
      // Un taux ou une quantité seuls ne révèlent aucun montant : ils restent visibles.
      expect(ligne.quantiteMillieme).toBe(2000);
      expect(ligne.tauxTvaPourmille).toBe(81);
      expect(ligne.regimeTva).toBe('normal');
      expect(ligne.remisePourmille).toBe(50);
      expect(ligne.designation).toBe('Vidange moteur');
    });
  }
});

// Garde-fou : si un rôle nouveau est ajouté, ce tableau force à décider explicitement s'il voit les
// montants (le test échoue tant qu'il n'est pas classé).
describe('mapperLigneDocument — matrice rôle exhaustive', () => {
  // RF-115/RF-116 : `ROLES_SANS_MONTANT_FACTURATION` = {technicien, poste_atelier} + admin.
  const attendu: Readonly<Record<RoleUtilisateur, boolean>> = {
    admin: false,
    technicien: false,
    poste_atelier: false,
    direction: true,
    vendeur: true,
    receptionnaire: true,
    chef_atelier: true,
    magasinier: true,
    comptable: true,
  };

  for (const [role, voit] of Object.entries(attendu) as [RoleUtilisateur, boolean][]) {
    it(`${role} → montants ${voit ? 'visibles' : 'masqués'}`, () => {
      const ligne = mapperLigneDocument(ligneFixture(), role);
      expect('montants' in ligne).toBe(voit);
      expect('prixUnitaireTtcCentimes' in ligne).toBe(voit);
    });
  }
});
