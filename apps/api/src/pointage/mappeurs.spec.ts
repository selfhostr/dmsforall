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

/** Cible d'affichage neutre, réutilisée par les tests qui ne portent pas sur ce sous-objet. */
const CIBLE_VIDE = { ordreReparationNumero: null, ligneOrDesignation: null };

describe('mapperPointage — technicienNomAffiche', () => {
  it('relaie le nom affiché reçu de l’appelant, tel quel', () => {
    const reponse = mapperPointage(LIGNE_BASE, null, 'Marco Rossi', CIBLE_VIDE);
    expect(reponse.technicienId).toBe(LIGNE_BASE.technicienId);
    expect(reponse.technicienNomAffiche).toBe('Marco Rossi');
  });

  it('ne déduit jamais le nom depuis technicienId — deux techniciens différents, deux noms différents', () => {
    const reponseUn = mapperPointage(LIGNE_BASE, null, 'Marco Rossi', CIBLE_VIDE);
    const reponseDeux = mapperPointage(
      { ...LIGNE_BASE, technicienId: '33333333-3333-3333-3333-333333333333' },
      null,
      'Chiara Bianchi',
      CIBLE_VIDE,
    );
    expect(reponseUn.technicienNomAffiche).toBe('Marco Rossi');
    expect(reponseDeux.technicienNomAffiche).toBe('Chiara Bianchi');
  });
});

/**
 * Défaut UX corrigé (constat écran réel) — la colonne « Cible » d'`EcranEquipePointage` n'affichait
 * jamais le numéro d'OR faute de ce champ sur `ReponsePointage`. `mapperPointage` reçoit désormais
 * `cible: CibleAffichagePointage` (numéro d'OR + désignation de ligne) en quatrième paramètre,
 * résolu par l'APPELANT (`references.ts::resoudreCibleAffichagePointage` pour une lecture unitaire,
 * `leftJoin` direct pour `lister`) — ces tests prouvent que le mappeur RELAIE fidèlement ce qu'il
 * reçoit, JAMAIS ne le déduit depuis `ordreReparationId`/`ligneOrId`.
 */
describe('mapperPointage — ordreReparationNumero / ligneOrDesignation', () => {
  it('relaie le numéro d’OR et la désignation de ligne reçus, tels quels', () => {
    const ligne = {
      ...LIGNE_BASE,
      nature: 'productif_ligne' as const,
      ordreReparationId: '77777777-7777-7777-7777-777777777777',
      ligneOrId: '88888888-8888-8888-8888-888888888888',
      activiteIndirecte: null,
    };
    const reponse = mapperPointage(ligne, null, 'Marco Rossi', {
      ordreReparationNumero: 'OR-2026-00042',
      ligneOrDesignation: 'Remplacement plaquettes avant',
    });
    expect(reponse.ordreReparationNumero).toBe('OR-2026-00042');
    expect(reponse.ligneOrDesignation).toBe('Remplacement plaquettes avant');
  });

  it('ne déduit RIEN d’un identifiant présent — deux pointages visant le même OR, deux numéros différents fournis, deux résultats différents', () => {
    const ligneCommune = {
      ...LIGNE_BASE,
      nature: 'productif_or' as const,
      ordreReparationId: '77777777-7777-7777-7777-777777777777',
      activiteIndirecte: null,
    };
    const reponseUn = mapperPointage(ligneCommune, null, 'Marco Rossi', {
      ordreReparationNumero: 'OR-2026-00001',
      ligneOrDesignation: null,
    });
    const reponseDeux = mapperPointage(ligneCommune, null, 'Marco Rossi', {
      ordreReparationNumero: 'OR-2026-00002',
      ligneOrDesignation: null,
    });
    // Même `ordreReparationId` sur les deux lignes source : si le mappeur déduisait le numéro de
    // l'identifiant plutôt que de relayer `cible`, ces deux valeurs seraient identiques à tort.
    expect(reponseUn.ordreReparationNumero).toBe('OR-2026-00001');
    expect(reponseDeux.ordreReparationNumero).toBe('OR-2026-00002');
  });

  it('nature indirect (sans OR ni ligne) : les deux champs restent null, jamais une chaîne vide', () => {
    const reponse = mapperPointage(LIGNE_BASE, null, 'Marco Rossi', CIBLE_VIDE);
    expect(reponse.ordreReparationId).toBeNull();
    expect(reponse.ligneOrId).toBeNull();
    expect(reponse.ordreReparationNumero).toBeNull();
    expect(reponse.ligneOrDesignation).toBeNull();
  });

  it('nature productif_or (OR entier, sans ligne précise) : ligneOrDesignation reste null même si ordreReparationNumero est renseigné', () => {
    const ligne = {
      ...LIGNE_BASE,
      nature: 'productif_or' as const,
      ordreReparationId: '77777777-7777-7777-7777-777777777777',
      activiteIndirecte: null,
    };
    const reponse = mapperPointage(ligne, null, 'Marco Rossi', {
      ordreReparationNumero: 'OR-2026-00042',
      ligneOrDesignation: null,
    });
    expect(reponse.ordreReparationNumero).toBe('OR-2026-00042');
    expect(reponse.ligneOrDesignation).toBeNull();
  });

  it('ligne ciblée sans désignation saisie (colonne nullable en base) : ligneOrDesignation reste null même si ligneOrId est renseigné', () => {
    const ligne = {
      ...LIGNE_BASE,
      nature: 'productif_ligne' as const,
      ordreReparationId: '77777777-7777-7777-7777-777777777777',
      ligneOrId: '88888888-8888-8888-8888-888888888888',
      activiteIndirecte: null,
    };
    const reponse = mapperPointage(ligne, null, 'Marco Rossi', {
      ordreReparationNumero: 'OR-2026-00042',
      ligneOrDesignation: null,
    });
    expect(reponse.ligneOrId).toBe('88888888-8888-8888-8888-888888888888');
    expect(reponse.ligneOrDesignation).toBeNull();
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
