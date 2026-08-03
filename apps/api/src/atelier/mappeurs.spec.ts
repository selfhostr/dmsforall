import { describe, expect, it } from 'vitest';
import type { LigneDevisComplementaire, LigneLigneOr } from '../db/schema';
import { mapperDevis, mapperLigneOr, roleVoitLesMontants } from './mappeurs';

function ligneOrDeBase(surcharge: Partial<LigneLigneOr> = {}): LigneLigneOr {
  return {
    id: 'ligne-1',
    tenantId: 'tenant-1',
    ordreReparationId: 'or-1',
    numeroOrdre: 1,
    type: 'main_oeuvre_bareme',
    origine: 'constatee',
    statut: 'proposee',
    payeur: 'client',
    blocage: 'aucun',
    designation: 'Disques de frein avant',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: 120,
    tempsBaremeConstructeurCentiemes: null,
    tauxHoraireCentimes: 12000,
    prixUnitaireCentimes: null,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    montantHtCentimes: 14400,
    montantTvaCentimes: 1166,
    montantTtcCentimes: 15566,
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: null,
    securite: false,
    fourniParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    creeLe: new Date('2026-07-27T09:00:00.000Z'),
    modifieLe: new Date('2026-07-27T09:00:00.000Z'),
    ...surcharge,
  } as LigneLigneOr;
}

describe('roleVoitLesMontants', () => {
  it('refuse les montants au technicien (invariant frontend n°10)', () => {
    expect(roleVoitLesMontants('technicien')).toBe(false);
  });

  it('accorde les montants aux autres rôles', () => {
    expect(roleVoitLesMontants('receptionnaire')).toBe(true);
    expect(roleVoitLesMontants('chef_atelier')).toBe(true);
    expect(roleVoitLesMontants('direction')).toBe(true);
  });
});

describe('mapperLigneOr — filtrage des montants par rôle', () => {
  it('omet montants/tauxHoraireCentimes/prixUnitaireCentimes pour un technicien', () => {
    const reponse = mapperLigneOr(ligneOrDeBase(), 'technicien');
    expect(reponse.montants).toBeUndefined();
    expect(reponse.tauxHoraireCentimes).toBeUndefined();
    expect(reponse.prixUnitaireCentimes).toBeUndefined();
    expect('montants' in reponse).toBe(false);
  });

  it('inclut les montants exacts pour un réceptionnaire', () => {
    const reponse = mapperLigneOr(ligneOrDeBase(), 'receptionnaire');
    expect(reponse.montants).toEqual({
      montantHtCentimes: 14400,
      montantTvaCentimes: 1166,
      montantTtcCentimes: 15566,
    });
    expect(reponse.tauxHoraireCentimes).toBe(12000);
  });

  it("ne renvoie jamais un montant à zéro à la place d'une omission", () => {
    const reponse = mapperLigneOr(ligneOrDeBase(), 'technicien');
    // La règle du contrat est d'OMETTRE le champ, jamais d'envoyer 0 — un technicien qui recevrait
    // `montants: { montantTtcCentimes: 0 }` croirait à une ligne gratuite plutôt qu'à une donnée
    // masquée.
    expect(reponse).not.toHaveProperty('montants.montantTtcCentimes');
  });
});

function devisDeBase(surcharge: Partial<LigneDevisComplementaire> = {}): LigneDevisComplementaire {
  return {
    id: 'devis-1',
    tenantId: 'tenant-1',
    ordreReparationId: 'or-1',
    numeroOrdre: 1,
    montantTtcCentimes: 37000,
    nouveauPlafondCentimes: 37000,
    impactRestitutionLe: null,
    envoyeLe: new Date('2026-07-27T09:00:00.000Z'),
    canal: 'telephone',
    emetteurId: null,
    interlocuteurNom: null,
    reponduLe: null,
    decision: null,
    retranscription: null,
    preuve: { destinataireContactId: 'contact-1' },
    creeLe: new Date('2026-07-27T09:00:00.000Z'),
    modifieLe: new Date('2026-07-27T09:00:00.000Z'),
    ...surcharge,
  } as LigneDevisComplementaire;
}

describe('mapperDevis', () => {
  it('omet le montant pour un technicien', () => {
    const reponse = mapperDevis(devisDeBase(), [], null, 'technicien');
    expect(reponse.montantTtcCentimes).toBeUndefined();
  });

  it('lit destinataireContactId depuis la colonne preuve réutilisée', () => {
    const reponse = mapperDevis(devisDeBase(), [], null, 'direction');
    expect(reponse.destinataireContactId).toBe('contact-1');
    expect(reponse.montantTtcCentimes).toBe(37000);
  });

  it('rend destinataireContactId null quand preuve est vide', () => {
    const reponse = mapperDevis(devisDeBase({ preuve: null }), [], null, 'direction');
    expect(reponse.destinataireContactId).toBeNull();
  });
});
