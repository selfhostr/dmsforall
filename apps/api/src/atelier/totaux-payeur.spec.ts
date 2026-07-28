import { describe, expect, it } from 'vitest';
import type { LigneLigneOr } from '../db/schema';
import { calculerTotauxParPayeur } from './totaux-payeur';

function ligne(surcharge: Partial<LigneLigneOr>): LigneLigneOr {
  return {
    id: 'l', tenantId: 't', ordreReparationId: 'or', numeroOrdre: 1,
    type: 'piece', origine: 'commandee', statut: 'validee', payeur: 'client', blocage: 'aucun',
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

describe('calculerTotauxParPayeur', () => {
  it('agrège HT/TVA/TTC par payeur', () => {
    const lignes = [
      ligne({ payeur: 'client', montantHtCentimes: 10000, montantTvaCentimes: 810, montantTtcCentimes: 10810 }),
      ligne({ payeur: 'client', montantHtCentimes: 5000, montantTvaCentimes: 405, montantTtcCentimes: 5405 }),
      ligne({ payeur: 'assurance', montantHtCentimes: 2000, montantTvaCentimes: 162, montantTtcCentimes: 2162 }),
    ];
    const totaux = calculerTotauxParPayeur(lignes);
    const client = totaux.find((t) => t.payeur === 'client')!;
    expect(client.montantHtCentimes).toBe(15000);
    expect(client.montantTvaCentimes).toBe(1215);
    expect(client.montantTtcCentimes).toBe(16215);
    const assurance = totaux.find((t) => t.payeur === 'assurance')!;
    expect(assurance.montantTtcCentimes).toBe(2162);
  });

  it('exclut les lignes annulées et refusées des totaux', () => {
    const lignes = [
      ligne({ payeur: 'client', statut: 'annulee', montantTtcCentimes: 99999 }),
      ligne({ payeur: 'client', statut: 'refusee', montantTtcCentimes: 88888 }),
      ligne({ payeur: 'client', statut: 'validee', montantHtCentimes: 100, montantTvaCentimes: 8, montantTtcCentimes: 108 }),
    ];
    const totaux = calculerTotauxParPayeur(lignes);
    expect(totaux).toHaveLength(1);
    expect(totaux[0]!.montantTtcCentimes).toBe(108);
  });

  it('ventile la TVA par taux distinct', () => {
    const lignes = [
      ligne({ payeur: 'client', tauxTvaPourmille: 81, montantHtCentimes: 100, montantTvaCentimes: 8, montantTtcCentimes: 108 }),
      ligne({ payeur: 'client', tauxTvaPourmille: 26, montantHtCentimes: 200, montantTvaCentimes: 5, montantTtcCentimes: 205 }),
    ];
    const [totaux] = calculerTotauxParPayeur(lignes);
    expect(totaux!.tva).toEqual([
      { tauxPourmille: 26, baseHtCentimes: 200, montantCentimes: 5 },
      { tauxPourmille: 81, baseHtCentimes: 100, montantCentimes: 8 },
    ]);
  });

  it('rend un tableau vide quand toutes les lignes sont exclues', () => {
    expect(calculerTotauxParPayeur([ligne({ statut: 'annulee' })])).toEqual([]);
  });
});
