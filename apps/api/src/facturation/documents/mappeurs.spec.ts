import type { RoleUtilisateur } from '@dfa/shared';
import { describe, expect, it } from 'vitest';

import type { LigneDocumentVente, LigneLigneDocument } from '../../db/schema';

import { mapperDocument, mapperLigneDocument, roleVoitLesMontants } from './mappeurs';
import type { EntreeMapperDocument } from './mappeurs';

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

/**
 * `mapperDocument` — échéance et retard (RF-04/PF-04, colonne « Retard » de l'écran liste des
 * factures, jusqu'ici TOUJOURS vide faute de `date_echeance` renseignée en base). Deux choses
 * prouvées ensemble : l'ARITHMÉTIQUE du retard (déléguée à `echeance.ts`, déjà couverte
 * exhaustivement par `echeance.spec.ts` — pas re-testée ici en détail) et le MASQUAGE, RF-115/116,
 * qui est la responsabilité propre de CE module. `dateEcheance`/`enRetard`/`joursRetard` sont une
 * donnée financière au même titre qu'un montant : ils vivent dans le MÊME bloc conditionnel
 * `voitMontants` que `soldeCentimes`/`totalTtcCentimes`, et doivent donc disparaître pour
 * `technicien`/`poste_atelier`/`admin` exactement comme eux (`ROLES_SANS_MONTANT_FACTURATION`).
 */
describe('mapperDocument — dateEcheance/enRetard/joursRetard', () => {
  const MAINTENANT = new Date('2026-08-04T10:00:00.000Z');

  function documentFixture(overrides: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
    return {
      id: 'doc-1',
      tenantId: 'tenant-a',
      siteId: 'site-1',
      typeDocument: 'facture',
      natureFacture: 'ordinaire',
      origine: 'dfa',
      numero: '2026-00042',
      numeroSequence: 42,
      numeroOrigine: null,
      exercice: 2026,
      statut: 'emis',
      statutReglement: 'non_regle',
      clientId: 'client-1',
      vehiculeId: null,
      ordreReparationId: null,
      dossierVenteId: null,
      documentSourceId: null,
      factureAnnuleeId: null,
      annuleParAvoirId: null,
      remplaceId: null,
      clientDesignationFigee: 'Jean Dupont',
      clientIdeFige: null,
      langueFigee: 'fr',
      conditionsPaiementFigees: { delaiPaiementJours: 30 },
      dateDocument: '2026-07-01',
      dateEcheance: '2026-07-31',
      devise: 'CHF',
      tvaNonVentilee: false,
      tauxTvaPourmille: null,
      mentionTvaInterdite: false,
      remiseGlobaleSaisieCentimes: null,
      remiseGlobalePourmille: null,
      montantRegleCentimes: 0n,
      soldeCentimes: 12_000n,
      relanceNiveau: 0,
      relanceLe: null,
      motifAvoir: null,
      motifAvoirLibre: null,
      porteeAvoir: null,
      qrPayload: null,
      pdfCle: null,
      pdfSha256: null,
      exporteLe: null,
      exportId: null,
      contentieux: false,
      creeLe: MAINTENANT,
      modifieLe: MAINTENANT,
      ...overrides,
    } as unknown as LigneDocumentVente;
  }

  function entreeFixture(
    role: RoleUtilisateur,
    docOverrides: Partial<LigneDocumentVente> = {},
  ): EntreeMapperDocument {
    return {
      doc: documentFixture(docOverrides),
      lignesToutes: [],
      ventilationTva: [],
      role,
      figeesAdresse: null,
      figeesPlaque: null,
      emisPar: null,
      modifiePar: null,
      totaux: {
        totalHtCentimes: 0,
        totalTvaCentimes: 0,
        totalTtcCentimes: 0,
        ecartRepriseCentimes: 0,
      },
      version: 1,
      maintenant: MAINTENANT,
    };
  }

  it('facture échue et non soldée : enRetard=true, joursRetard exact, dateEcheance exposée (comptable)', () => {
    const reponse = mapperDocument(
      entreeFixture('comptable', { dateEcheance: '2026-07-25', soldeCentimes: 12_000n }),
    );
    expect(reponse.dateEcheance).toBe('2026-07-25');
    expect(reponse.enRetard).toBe(true);
    expect(reponse.joursRetard).toBe(10);
  });

  it('facture soldée : jamais en retard même très échue — dateEcheance reste exposée, seul le retard est faux', () => {
    const reponse = mapperDocument(
      entreeFixture('direction', { dateEcheance: '2026-01-01', soldeCentimes: 0n }),
    );
    expect(reponse.dateEcheance).toBe('2026-01-01');
    expect(reponse.enRetard).toBe(false);
    expect(reponse.joursRetard).toBeNull();
  });

  it('facture sans échéance connue (client sans conditions de paiement figées) : dateEcheance null, jamais en retard', () => {
    const reponse = mapperDocument(
      entreeFixture('comptable', { dateEcheance: null, soldeCentimes: 12_000n }),
    );
    expect(reponse.dateEcheance).toBeNull();
    expect(reponse.enRetard).toBe(false);
    expect(reponse.joursRetard).toBeNull();
  });

  it(
    'facture ANNULÉE PAR AVOIR (RF-32) : jamais en retard même si `dateEcheance`/`soldeCentimes` ' +
      "restent, en base, ceux d'avant l'annulation (RF-32 ne les nettoie pas) — bogue constaté : " +
      '`calculerRetardDocument` ne vérifiait pas `statut` avant ce correctif, et aurait rendu ' +
      '`enRetard=true` pour un montant qui n’est plus dû',
    () => {
      const reponse = mapperDocument(
        entreeFixture('comptable', {
          statut: 'annule_par_avoir',
          dateEcheance: '2026-07-25',
          soldeCentimes: 12_000n,
        }),
      );
      expect(reponse.dateEcheance).toBe('2026-07-25');
      expect(reponse.enRetard).toBe(false);
      expect(reponse.joursRetard).toBeNull();
    },
  );

  for (const role of ['technicien', 'poste_atelier', 'admin'] as const) {
    it(`${role} (RF-115/116) : dateEcheance/enRetard/joursRetard ABSENTS, pas null — même masquage que les montants`, () => {
      const reponse = mapperDocument(
        entreeFixture(role, { dateEcheance: '2026-07-25', soldeCentimes: 12_000n }),
      );
      expect('dateEcheance' in reponse).toBe(false);
      expect('enRetard' in reponse).toBe(false);
      expect('joursRetard' in reponse).toBe(false);

      // Sérialisé : l'échéance ne doit apparaître nulle part dans la réponse.
      const json = JSON.stringify(reponse);
      expect(json).not.toContain('2026-07-25');
    });
  }

  for (const role of [
    'comptable',
    'direction',
    'vendeur',
    'receptionnaire',
    'chef_atelier',
    'magasinier',
  ] as const) {
    it(`${role} : dateEcheance/enRetard/joursRetard exposés`, () => {
      const reponse = mapperDocument(
        entreeFixture(role, { dateEcheance: '2026-07-25', soldeCentimes: 12_000n }),
      );
      expect(reponse.dateEcheance).toBe('2026-07-25');
      expect(reponse.enRetard).toBe(true);
      expect(reponse.joursRetard).toBe(10);
    });
  }
});
