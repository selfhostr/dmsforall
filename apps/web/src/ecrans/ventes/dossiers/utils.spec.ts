import { describe, expect, it } from 'vitest';

import type { DocumentVenteResume } from '@dfa/shared';

import { selectionnerPrixDossierVente } from './utils';

/** Fixture minimale mais complète (tous les champs non-optionnels de `DocumentVenteResume`),
 *  surchargeable — même patron que les fixtures de `EcranFicheDossierVente.spec.tsx`. */
function document(overrides: Partial<DocumentVenteResume> = {}): DocumentVenteResume {
  return {
    id: 'doc-1',
    typeDocument: 'bon_commande',
    natureFacture: null,
    numero: null,
    statut: 'brouillon',
    clientId: 'client-1',
    clientDesignation: 'Jean Dupont',
    dateDocument: '2026-08-01',
    devise: 'CHF',
    ...overrides,
  };
}

describe('selectionnerPrixDossierVente', () => {
  // Défaut mesuré en navigateur : un bon de commande brouillon jamais rempli porte
  // `totalTtcCentimes: 0` — la somme d'aucune ligne, pas un prix. Il ne doit plus jamais être
  // sélectionné comme prix « engagé » (rendu proéminent, indistinguable d'un vrai montant).
  it("un bon de commande brouillon vide (total à 0) n'est jamais retenu comme prix engagé", () => {
    const resultat = selectionnerPrixDossierVente([
      document({
        id: 'bc-1',
        typeDocument: 'bon_commande',
        statut: 'brouillon',
        totalTtcCentimes: 0,
      }),
    ]);

    expect(resultat).toEqual({ statut: 'aucun' });
  });

  it('une facture brouillon vide (total à 0) : même règle, aucun prix', () => {
    const resultat = selectionnerPrixDossierVente([
      document({ id: 'f-1', typeDocument: 'facture', statut: 'brouillon', totalTtcCentimes: 0 }),
    ]);

    expect(resultat).toEqual({ statut: 'aucun' });
  });

  it('un document brouillon abandonné (jamais émis) : même règle, aucun prix engagé même avec un total', () => {
    const resultat = selectionnerPrixDossierVente([
      document({
        id: 'bc-1',
        typeDocument: 'bon_commande',
        statut: 'abandonne',
        totalTtcCentimes: 2_190_000,
      }),
    ]);

    expect(resultat).toEqual({ statut: 'aucun' });
  });

  it('un bon de commande émis porte le prix engagé, même à un total réellement nul (cas légitime, distinct du brouillon vide)', () => {
    const doc = document({
      id: 'bc-1',
      typeDocument: 'bon_commande',
      statut: 'emis',
      totalTtcCentimes: 0,
    });

    expect(selectionnerPrixDossierVente([doc])).toEqual({ statut: 'engage', document: doc });
  });

  it('un bon de commande émis avec un total réel porte le prix engagé', () => {
    const doc = document({
      id: 'bc-1',
      typeDocument: 'bon_commande',
      statut: 'emis',
      totalTtcCentimes: 2_190_000,
    });

    expect(selectionnerPrixDossierVente([doc])).toEqual({ statut: 'engage', document: doc });
  });

  it('une facture émise prime sur un bon de commande émis plus ancien (le plus récent gagne)', () => {
    const bonCommande = document({
      id: 'bc-1',
      typeDocument: 'bon_commande',
      statut: 'transforme',
      dateDocument: '2026-08-01',
      totalTtcCentimes: 2_190_000,
    });
    const facture = document({
      id: 'f-1',
      typeDocument: 'facture',
      statut: 'emis',
      dateDocument: '2026-08-05',
      totalTtcCentimes: 2_190_000,
    });

    expect(selectionnerPrixDossierVente([bonCommande, facture])).toEqual({
      statut: 'engage',
      document: facture,
    });
  });

  it('sans document engagé, un devis émis avec un total réel porte un prix indicatif', () => {
    const devis = document({
      id: 'devis-1',
      typeDocument: 'devis',
      statut: 'emis',
      totalTtcCentimes: 1_500_000,
    });

    expect(selectionnerPrixDossierVente([devis])).toEqual({ statut: 'indicatif', document: devis });
  });

  it('un devis brouillon (jamais envoyé) avec un total réel porte quand même un prix indicatif', () => {
    const devis = document({
      id: 'devis-1',
      typeDocument: 'devis',
      statut: 'brouillon',
      totalTtcCentimes: 1_500_000,
    });

    expect(selectionnerPrixDossierVente([devis])).toEqual({ statut: 'indicatif', document: devis });
  });

  it('un devis abandonné ne porte plus de prix indicatif (dossier abandonné avant émission)', () => {
    const resultat = selectionnerPrixDossierVente([
      document({
        id: 'devis-1',
        typeDocument: 'devis',
        statut: 'abandonne',
        totalTtcCentimes: 1_500_000,
      }),
    ]);

    expect(resultat).toEqual({ statut: 'aucun' });
  });

  // Le cœur du point 1 du brief : la distinction n'est pas purement le statut. Un bon de commande
  // encore brouillon, mais avec une saisie déjà avancée (total réel, positif), porte une indication
  // utile — à condition de ne JAMAIS ressembler à un engagement (rendu 'indicatif', jamais 'engage').
  it('un bon de commande brouillon AVEC un total réel (saisie en cours) porte un prix indicatif, pas engagé', () => {
    const bonCommande = document({
      id: 'bc-1',
      typeDocument: 'bon_commande',
      statut: 'brouillon',
      totalTtcCentimes: 2_190_000,
    });

    expect(selectionnerPrixDossierVente([bonCommande])).toEqual({
      statut: 'indicatif',
      document: bonCommande,
    });
  });

  it('un bon de commande brouillon en cours de saisie prime sur un devis plus ancien (le plus récent gagne, quel que soit le type)', () => {
    const devis = document({
      id: 'devis-1',
      typeDocument: 'devis',
      statut: 'emis',
      dateDocument: '2026-07-01',
      totalTtcCentimes: 1_500_000,
    });
    const bonCommande = document({
      id: 'bc-1',
      typeDocument: 'bon_commande',
      statut: 'brouillon',
      dateDocument: '2026-08-01',
      totalTtcCentimes: 2_190_000,
    });

    expect(selectionnerPrixDossierVente([devis, bonCommande])).toEqual({
      statut: 'indicatif',
      document: bonCommande,
    });
  });

  // `totalTtcCentimes` absent (rôle sans droit aux montants) : ne doit JAMAIS être traité comme un
  // total significatif — ni promu en indicatif depuis un brouillon, ni substitué par 0.
  it("un bon de commande brouillon sans totalTtcCentimes visible (rôle masqué) n'est jamais promu en indicatif", () => {
    const resultat = selectionnerPrixDossierVente([
      document({ id: 'bc-1', typeDocument: 'bon_commande', statut: 'brouillon' }),
    ]);

    expect(resultat).toEqual({ statut: 'aucun' });
  });

  it('aucun document : aucun prix', () => {
    expect(selectionnerPrixDossierVente([])).toEqual({ statut: 'aucun' });
  });

  it('uniquement des documents exclus (annulé, refusé) : aucun prix', () => {
    const resultat = selectionnerPrixDossierVente([
      document({
        id: 'bc-1',
        typeDocument: 'bon_commande',
        statut: 'annule',
        totalTtcCentimes: 2_190_000,
      }),
      document({
        id: 'devis-1',
        typeDocument: 'devis',
        statut: 'refuse',
        totalTtcCentimes: 1_500_000,
      }),
    ]);

    expect(resultat).toEqual({ statut: 'aucun' });
  });
});
