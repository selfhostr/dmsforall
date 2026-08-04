import { describe, expect, it } from 'vitest';
import type { RoleUtilisateur } from '@dfa/shared';

import type { LigneFinancementVente } from '../db/schema';

import {
  calculerActionsDisponiblesVehiculeStock,
  calculerEcartRepriseVehicule,
  calculerJoursStock,
  versFinancementResponse,
  versFinancementResume,
} from './mappers';

/**
 * Cas limites de `mappers.ts` jugés les plus à risque pour cette livraison :
 *  - `calculerActionsDisponiblesVehiculeStock` — la matrice rôle × action pour `marquer_vendu`
 *    (trou n°2 comblé, voir `service-vehicule-stock.ts::marquerVendu`) : n'apparaît QUE depuis
 *    `reserve`, ET seulement pour un rôle qui détient `ventes.vehicule_stock.corriger` (`direction`,
 *    pas `vendeur`, `matrice-droits.ts`) — même garde que `remettre_disponible`, la correction
 *    exceptionnelle n'est pas un geste comptoir ;
 *  - `calculerEcartRepriseVehicule` — arithmétique argent (centimes, jamais de float) : positif
 *    (reprise gonflée, RV-20), négatif (RV-27), et `null` tant que non négociée ;
 *  - `calculerJoursStock` — dérivé depuis `dateEntreeStock`/`venduLe`, jamais négatif même sur une
 *    entrée du jour même.
 */
describe('calculerActionsDisponiblesVehiculeStock — marquer_vendu (trou n°2 comblé)', () => {
  it('`reserve` + rôle avec `ventes.vehicule_stock.corriger` (direction) : marquer_vendu ET remettre_disponible disponibles', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('reserve', 'direction');
    expect(actions).toContain('marquer_vendu');
    expect(actions).toContain('remettre_disponible');
  });

  it('`reserve` + rôle SANS `ventes.vehicule_stock.corriger` (vendeur) : ni marquer_vendu ni remettre_disponible', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('reserve', 'vendeur');
    expect(actions).not.toContain('marquer_vendu');
    expect(actions).not.toContain('remettre_disponible');
  });

  it('`vendu` : verrouillé, marquer_vendu ne réapparaît pas même pour direction (transition déjà consommée)', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('vendu', 'direction');
    expect(actions).toHaveLength(0);
  });

  it('`disponible` : marquer_vendu absent (transition `reserve -> vendu` uniquement, pas `disponible -> vendu`)', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('disponible', 'direction');
    expect(actions).not.toContain('marquer_vendu');
  });
});

describe('calculerEcartRepriseVehicule — RV-20/RV-21, argent en centimes, jamais de float', () => {
  it('`null` tant que non négociée', () => {
    expect(calculerEcartRepriseVehicule(800_000, null)).toBeNull();
  });

  it('positif : reprise gonflée (RV-20), remise déguisée sur le neuf', () => {
    expect(calculerEcartRepriseVehicule(800_000, 850_000)).toBe(50_000);
  });

  it('négatif : reprise revue à la baisse après expertise physique (RV-27)', () => {
    expect(calculerEcartRepriseVehicule(800_000, 720_000)).toBe(-80_000);
  });

  it('zéro : valeur négociée strictement égale à l’estimation', () => {
    expect(calculerEcartRepriseVehicule(800_000, 800_000)).toBe(0);
  });
});

describe('calculerJoursStock — RV-07, dérivé, jamais négatif', () => {
  it('toujours en stock (venduLe null) : jours écoulés jusqu’à `maintenant`', () => {
    const jours = calculerJoursStock('2026-07-01', null, new Date('2026-07-31T00:00:00.000Z'));
    expect(jours).toBe(30);
  });

  it('vendu : jours écoulés jusqu’à `venduLe`, PAS jusqu’à `maintenant` (un véhicule vendu il y a un mois ne vieillit plus au compteur)', () => {
    const jours = calculerJoursStock(
      '2026-07-01',
      new Date('2026-07-11T00:00:00.000Z'),
      new Date('2026-07-31T00:00:00.000Z'),
    );
    expect(jours).toBe(10);
  });

  it('entrée du jour même : 0, jamais négatif', () => {
    const jours = calculerJoursStock('2026-07-31', null, new Date('2026-07-31T08:00:00.000Z'));
    expect(jours).toBe(0);
  });
});

/**
 * Trou comblé (audit préalable, migration 0042) : `financement_vente` n'exposait aucune donnée
 * monétaire (`montantFinanceCentimes`/`acompteCentimes`/`mensualiteCentimes`/
 * `tauxInteretPourmille`/`dureeMois`). Ces tests prouvent que `versFinancementResponse` et
 * `versFinancementResume` (1) exposent bien les cinq champs quand le rôle voit les montants, et
 * (2) les OMETTENT (pas `null` — absents de l'objet) pour un rôle qui n'en a pas le droit — même
 * doctrine que `versDocumentVenteResume` (RF-116) déjà exercée par ce module.
 */
function ligneFinancementFixture(
  champs: Partial<LigneFinancementVente> = {},
): LigneFinancementVente {
  return {
    id: 'fin-1',
    tenantId: 'tid-1',
    dossierVenteId: 'dossier-1',
    type: 'leasing',
    organismeId: 'organisme-1',
    referenceContrat: 'LSG-2026-042',
    montantFinanceCentimes: 2_500_000,
    acompteCentimes: 300_000,
    mensualiteCentimes: 45_000,
    tauxInteretPourmille: 39,
    dureeMois: 48,
    statut: 'en_attente',
    confirmeLe: null,
    refuseLe: null,
    motifRefus: null,
    version: 1,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
    ...champs,
  } as LigneFinancementVente;
}

describe('versFinancementResponse — détail monétaire (0042), visibilité par rôle (RF-116)', () => {
  it.each<RoleUtilisateur>(['direction', 'vendeur', 'comptable'])(
    'rôle %s (voit les montants) : les cinq champs sont exposés tels quels',
    (role) => {
      const reponse = versFinancementResponse(ligneFinancementFixture(), null, role);
      expect(reponse.montantFinanceCentimes).toBe(2_500_000);
      expect(reponse.acompteCentimes).toBe(300_000);
      expect(reponse.mensualiteCentimes).toBe(45_000);
      expect(reponse.tauxInteretPourmille).toBe(39);
      expect(reponse.dureeMois).toBe(48);
    },
  );

  it.each<RoleUtilisateur>(['technicien', 'admin'])(
    'rôle %s (ne voit pas les montants) : les cinq champs sont OMIS, pas à `null`',
    (role) => {
      const reponse = versFinancementResponse(ligneFinancementFixture(), null, role);
      expect('montantFinanceCentimes' in reponse).toBe(false);
      expect('acompteCentimes' in reponse).toBe(false);
      expect('mensualiteCentimes' in reponse).toBe(false);
      expect('tauxInteretPourmille' in reponse).toBe(false);
      expect('dureeMois' in reponse).toBe(false);
    },
  );

  it('une colonne réellement NULL (jamais saisie) reste `null` pour un rôle qui voit les montants — ne se confond pas avec une omission', () => {
    const reponse = versFinancementResponse(
      ligneFinancementFixture({ montantFinanceCentimes: null }),
      null,
      'direction',
    );
    expect('montantFinanceCentimes' in reponse).toBe(true);
    expect(reponse.montantFinanceCentimes).toBeNull();
  });
});

describe('versFinancementResume — même doctrine d’omission que versFinancementResponse (0042)', () => {
  it('rôle qui voit les montants : les cinq champs sont exposés dans le résumé embarqué', () => {
    const resume = versFinancementResume(ligneFinancementFixture(), null, 'direction');
    expect(resume).toMatchObject({
      montantFinanceCentimes: 2_500_000,
      acompteCentimes: 300_000,
      mensualiteCentimes: 45_000,
      tauxInteretPourmille: 39,
      dureeMois: 48,
    });
  });

  it('rôle sans droit sur les montants : omis du résumé embarqué (dossier-vente.ts::ReponseDossierVente.financement)', () => {
    const resume = versFinancementResume(ligneFinancementFixture(), null, 'technicien');
    expect('montantFinanceCentimes' in resume).toBe(false);
    expect('mensualiteCentimes' in resume).toBe(false);
  });
});
