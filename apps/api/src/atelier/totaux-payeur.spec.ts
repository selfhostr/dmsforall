import { describe, expect, it } from 'vitest';
import type { LigneLigneOr } from '../db/schema';
import { calculerTotauxParPayeur } from './totaux-payeur';

function ligne(surcharge: Partial<LigneLigneOr>): LigneLigneOr {
  return {
    id: 'l', tenantId: 't', ordreReparationId: 'or', numeroOrdre: 1,
    type: 'piece', origine: 'commandee', statut: 'validee', payeur: 'client', payeurClientId: null, blocage: 'aucun',
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

  /**
   * `MD-62` : le regroupement porte sur la paire `(payeur, payeurClientId)`, jamais `payeur` seul.
   * Deux lignes `payeur: 'assurance'` avec deux `payeurClientId` différents (deux assureurs
   * distincts sur le même OR, cas réel carrosserie à deux sinistres croisés) doivent produire DEUX
   * groupes — jamais fusionnés sous prétexte qu'ils partagent `payeur = 'assurance'`, sans quoi la
   * facture du second assureur partirait sur le premier. Colonne `ligne_or.payeur_client_id`
   * disponible depuis la migration `0017` (le champ était `it.todo` avant, faute de colonne — voir
   * l'historique de ce fichier).
   */
  it("groupe par (payeur, payeurClientId) — deux assurances distinctes ne fusionnent jamais (MD-62)", () => {
    const lignes = [
      ligne({ id: 'l1', payeur: 'assurance', payeurClientId: 'assureur-zurich', montantHtCentimes: 10000, montantTvaCentimes: 810, montantTtcCentimes: 10810 }),
      ligne({ id: 'l2', payeur: 'assurance', payeurClientId: 'assureur-axa', montantHtCentimes: 5000, montantTvaCentimes: 405, montantTtcCentimes: 5405 }),
    ];

    const totaux = calculerTotauxParPayeur(lignes, undefined, (payeurClientId) =>
      payeurClientId === 'assureur-zurich'
        ? { clientId: 'assureur-zurich', nomAffiche: 'Zurich Assurances' }
        : payeurClientId === 'assureur-axa'
          ? { clientId: 'assureur-axa', nomAffiche: 'AXA Assurances' }
          : undefined,
    );

    expect(totaux).toHaveLength(2);

    const zurich = totaux.find((t) => t.payeurClientId === 'assureur-zurich');
    expect(zurich).toBeDefined();
    expect(zurich!.payeur).toBe('assurance');
    expect(zurich!.montantTtcCentimes).toBe(10810);
    expect(zurich!.destinataire).toEqual({ clientId: 'assureur-zurich', nomAffiche: 'Zurich Assurances' });

    const axa = totaux.find((t) => t.payeurClientId === 'assureur-axa');
    expect(axa).toBeDefined();
    expect(axa!.payeur).toBe('assurance');
    expect(axa!.montantTtcCentimes).toBe(5405);
    expect(axa!.destinataire).toEqual({ clientId: 'assureur-axa', nomAffiche: 'AXA Assurances' });

    // La somme des deux groupes égale exactement le total des deux lignes, au centime.
    const totalTtc = totaux.reduce((s, t) => s + t.montantTtcCentimes, 0);
    expect(totalTtc).toBe(10810 + 5405);
  });

  /** `RM-70`/`RF-92` : une ligne `payeur = 'garage'` (diagnostic offert, valorisé à 0 côté client)
   *  ne forme jamais son propre groupe — elle rejoint `'client'`, sans en changer le total (déjà à
   *  0 par construction), et `'garage'` ne doit JAMAIS apparaître dans `totauxParPayeur`. */
  it("une ligne payeur = 'garage' rejoint le groupe 'client' — jamais de groupe 'garage' séparé (RM-70, RF-92)", () => {
    const lignes = [
      ligne({ id: 'l1', payeur: 'client', montantHtCentimes: 9250, montantTvaCentimes: 750, montantTtcCentimes: 10000 }),
      ligne({ id: 'l2', payeur: 'garage', montantHtCentimes: 0, montantTvaCentimes: 0, montantTtcCentimes: 0 }),
    ];

    const totaux = calculerTotauxParPayeur(lignes, { clientId: 'client-1', nomAffiche: 'Jean Dupont' });

    expect(totaux).toHaveLength(1);
    expect(totaux[0]!.payeur).toBe('client');
    expect(totaux[0]!.payeurClientId).toBeNull();
    expect(totaux[0]!.destinataire).toEqual({ clientId: 'client-1', nomAffiche: 'Jean Dupont' });
    expect(totaux[0]!.montantTtcCentimes).toBe(10000);
    expect(totaux.some((t) => (t.payeur as string) === 'garage')).toBe(false);
  });
});
