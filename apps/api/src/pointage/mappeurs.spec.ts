import { describe, expect, it } from 'vitest';

import type { LignePointage } from '../db/schema';
import { dureeBruteDepuisPeriode, mapperPointage } from './mappeurs';

/**
 * Défaut UX corrigé — `GET /pointages` (et le reste des réponses de pointage) n'exposait que
 * `technicienId`, forçant l'écran « Pointage / Équipe » à afficher un UUID tronqué faute d'un nom
 * à montrer. `mapperPointage` reçoit désormais `technicienNomAffiche` en troisième paramètre,
 * résolu par l'APPELANT (jointure `utilisateur` ou `references.ts::chargerResumeTechnicien`) —
 * ce mappeur reste pur, ces tests prouvent seulement qu'il relaie fidèlement la valeur reçue.
 */

const LIGNE_BASE: LignePointage = {
  id: '55555555-5555-5555-5555-555555555555',
  tenantId: '11111111-1111-1111-1111-111111111111',
  siteId: '66666666-6666-6666-6666-666666666666',
  technicienId: '22222222-2222-2222-2222-222222222222',
  statut: 'en_cours',
  nature: 'indirect',
  ordreReparationId: null,
  ligneOrId: null,
  activiteIndirecte: 'nettoyage',
  source: 'ecran_atelier',
  appareilId: null,
  debutLe: new Date('2026-08-04T08:00:00.000Z'),
  finLe: null,
  dureeArrondieCentiemes: null,
  decalageHorlogeMsDebut: null,
  decalageHorlogeMsFin: null,
  clotureAutomatique: false,
  anomalieMotif: null,
  anomalieDetecteeLe: null,
  anomalieTraiteeLe: null,
  derniereCorrectionMotif: null,
  derniereCorrectionParUtilisateurId: null,
  derniereCorrectionLe: null,
  debutLeOrigine: null,
  finLeOrigine: null,
  creeLe: new Date('2026-08-04T08:00:00.000Z'),
  modifieLe: new Date('2026-08-04T08:00:00.000Z'),
};

describe('mapperPointage — technicienNomAffiche', () => {
  it('relaie le nom affiché reçu de l’appelant, tel quel', () => {
    const reponse = mapperPointage(LIGNE_BASE, null, 'Marco Rossi');
    expect(reponse.technicienId).toBe(LIGNE_BASE.technicienId);
    expect(reponse.technicienNomAffiche).toBe('Marco Rossi');
  });

  it('ne déduit jamais le nom depuis technicienId — deux techniciens différents, deux noms différents', () => {
    const reponseUn = mapperPointage(LIGNE_BASE, null, 'Marco Rossi');
    const reponseDeux = mapperPointage(
      { ...LIGNE_BASE, technicienId: '33333333-3333-3333-3333-333333333333' },
      null,
      'Chiara Bianchi',
    );
    expect(reponseUn.technicienNomAffiche).toBe('Marco Rossi');
    expect(reponseDeux.technicienNomAffiche).toBe('Chiara Bianchi');
  });
});

describe('dureeBruteDepuisPeriode (non régression)', () => {
  it('rend null tant que le pointage est ouvert', () => {
    expect(dureeBruteDepuisPeriode(LIGNE_BASE.debutLe, null)).toBeNull();
  });

  it('calcule la durée brute en secondes une fois fermé', () => {
    const finLe = new Date('2026-08-04T08:30:00.000Z');
    expect(dureeBruteDepuisPeriode(LIGNE_BASE.debutLe, finLe)).toBe(1800);
  });
});
