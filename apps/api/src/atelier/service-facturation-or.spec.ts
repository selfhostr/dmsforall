import { describe, expect, it } from 'vitest';
import type { LigneLigneOr } from '../db/schema';
import { ligneAppartientAuGroupe, typeLigneDocumentDepuisOr } from './service-facturation-or';

function ligne(surcharge: Partial<LigneLigneOr>): LigneLigneOr {
  return {
    id: 'l', tenantId: 't', ordreReparationId: 'or', numeroOrdre: 1,
    type: 'piece', origine: 'commandee', statut: 'realisee', payeur: 'client', payeurClientId: null, blocage: 'aucun',
    designation: 'x', referenceTexte: null, articleId: null, quantiteMillieme: 1000,
    tempsBaremeCentiemes: null, tempsBaremeConstructeurCentiemes: null,
    tauxHoraireCentimes: null, prixUnitaireCentimes: 10000, rabaisPourmille: 0, tauxTvaPourmille: 81,
    montantHtCentimes: 10000, montantTvaCentimes: 810, montantTtcCentimes: 10810,
    technicienId: null, codeOperation: null, codeDefaut: null, numeroSinistre: null, numeroAccord: null,
    urgence: null, securite: false, fourniParClient: false, aRestituer: false, restituee: false,
    motifAnnulation: null, factureId: null,
    creeLe: new Date(), modifieLe: new Date(),
    ...surcharge,
  } as LigneLigneOr;
}

describe('ligneAppartientAuGroupe (RF-81, MD-62, RF-92)', () => {
  it("une ligne payeur='client' appartient au groupe {payeur:'client'}", () => {
    expect(ligneAppartientAuGroupe(ligne({ payeur: 'client' }), { payeur: 'client' })).toBe(true);
  });

  it("RF-92 : une ligne payeur='garage' rejoint AUSSI le groupe {payeur:'client'} — jamais un groupe séparé", () => {
    expect(ligneAppartientAuGroupe(ligne({ payeur: 'garage' }), { payeur: 'client' })).toBe(true);
  });

  it("une ligne payeur='assurance' n'appartient PAS au groupe {payeur:'client'}", () => {
    expect(ligneAppartientAuGroupe(ligne({ payeur: 'assurance', payeurClientId: 'zurich' }), { payeur: 'client' })).toBe(false);
  });

  it("MD-62 : deux lignes payeur='assurance' avec des payeurClientId DIFFÉRENTS n'appartiennent PAS au même groupe — c'est le bug historique que RF-81 doit éviter", () => {
    const ligneZurich = ligne({ payeur: 'assurance', payeurClientId: 'zurich' });
    const ligneAxa = ligne({ payeur: 'assurance', payeurClientId: 'axa' });
    const groupeZurich = { payeur: 'assurance', payeurClientId: 'zurich' } as const;

    expect(ligneAppartientAuGroupe(ligneZurich, groupeZurich)).toBe(true);
    expect(ligneAppartientAuGroupe(ligneAxa, groupeZurich)).toBe(false);
  });

  it("une ligne payeur='tiers' avec payeurClientId=X appartient au groupe {payeur:'tiers', payeurClientId:X} exact", () => {
    const l = ligne({ payeur: 'tiers', payeurClientId: 'garagiste-partenaire' });
    expect(ligneAppartientAuGroupe(l, { payeur: 'tiers', payeurClientId: 'garagiste-partenaire' })).toBe(true);
    expect(ligneAppartientAuGroupe(l, { payeur: 'tiers', payeurClientId: 'autre-tiers' })).toBe(false);
  });

  it("une ligne payeur='garage' n'appartient à AUCUN groupe tiers (assurance/constructeur/tiers) — repli 'client' uniquement", () => {
    const l = ligne({ payeur: 'garage' });
    expect(ligneAppartientAuGroupe(l, { payeur: 'assurance', payeurClientId: 'zurich' })).toBe(false);
  });
});

describe('typeLigneDocumentDepuisOr', () => {
  it('reprend à l’identique les neuf types partagés entre ligne_or et ligne_document', () => {
    const partages: ReadonlyArray<LigneLigneOr['type']> = [
      'main_oeuvre_bareme', 'main_oeuvre_temps_reel', 'forfait', 'piece', 'fourniture', 'sous_traitance', 'produit_atelier', 'taxe', 'texte',
    ];
    for (const type of partages) {
      expect(typeLigneDocumentDepuisOr(type)).toBe(type);
    }
  });

  it("'remise' (sans équivalent facturation, RF-45) replie sur 'repartition' — interprétation signalée", () => {
    expect(typeLigneDocumentDepuisOr('remise')).toBe('repartition');
  });
});
