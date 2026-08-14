import { describe, expect, it } from 'vitest';

import type { LigneDocumentVente } from '../db/schema';

import { repartirTotalTtcAfficheParDocument, type LigneDocumentPourTotal } from './references';

/**
 * #127 : « Montant TTC 0.00 » sur la carte Documents d'un dossier pour un bon de commande dont le
 * montant réel (ouvert directement) était CHF 41'900.00. Cause racine prouvée : `document_vente.
 * total_ttc_centimes` n'est figé QU'À L'ÉMISSION (`MD-45`) — un `brouillon` y porte `0`, sa valeur
 * par défaut. `repartirTotalTtcAfficheParDocument` est la partie PURE du correctif (voir
 * `totauxTtcAffichesDocumentsDossier` pour la requête batchée qui l'alimente) : ces tests couvrent
 * exactement le cas qui manquait (⚠️ codegraph : aucun test ne couvrait `versDocumentVenteResume`
 * ni cette fonction avant ce correctif).
 */
function documentFixture(champs: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: 'doc-1',
    statut: 'brouillon',
    totalTtcCentimes: 0n,
    ...champs,
  } as LigneDocumentVente;
}

function ligneFixture(champs: Partial<LigneDocumentPourTotal> = {}): LigneDocumentPourTotal {
  return {
    documentId: 'doc-1',
    htCentimes: 0,
    tvaCentimes: 0,
    ttcCentimes: 0,
    ...champs,
  };
}

describe('repartirTotalTtcAfficheParDocument — #127, montant TTC 0.00 sur un bon de commande', () => {
  it('recalcule EN DIRECT depuis les lignes pour un document brouillon (colonne stockée à 0, non fiable)', () => {
    const bonDeCommande = documentFixture({
      id: 'doc-bon-commande',
      statut: 'brouillon',
      // Valeur par défaut de la colonne (`document-vente.ts:115`) — jamais mise à jour avant
      // l'émission : lire cette colonne directement est EXACTEMENT le bug #127.
      totalTtcCentimes: 0n,
    });
    const lignes = [
      ligneFixture({
        documentId: 'doc-bon-commande',
        htCentimes: 3_875_000,
        tvaCentimes: 314_000,
        ttcCentimes: 4_189_000,
      }),
    ];

    const resultat = repartirTotalTtcAfficheParDocument([bonDeCommande], lignes);

    expect(resultat.get('doc-bon-commande')).toBe(4_189_000); // CHF 41'900.00, en centimes
  });

  it('somme plusieurs lignes brouillon pour le MÊME document (jamais une par ligne)', () => {
    const doc = documentFixture({
      id: 'doc-multi-lignes',
      statut: 'brouillon',
      totalTtcCentimes: 0n,
    });
    const lignes = [
      ligneFixture({ documentId: 'doc-multi-lignes', ttcCentimes: 100_000 }),
      ligneFixture({ documentId: 'doc-multi-lignes', ttcCentimes: 250_000 }),
    ];

    const resultat = repartirTotalTtcAfficheParDocument([doc], lignes);

    expect(resultat.get('doc-multi-lignes')).toBe(350_000);
  });

  it('un document brouillon SANS aucune ligne affiche 0, pas une valeur périmée', () => {
    const doc = documentFixture({ id: 'doc-vide', statut: 'brouillon', totalTtcCentimes: 0n });

    const resultat = repartirTotalTtcAfficheParDocument([doc], []);

    expect(resultat.get('doc-vide')).toBe(0);
  });

  it('lit la colonne stockée pour un document ÉMIS (figée à MD-45, jamais recalculée ici)', () => {
    const facture = documentFixture({
      id: 'doc-facture',
      statut: 'emis',
      totalTtcCentimes: 4_189_000n,
    });
    // Des lignes brouillon d'un AUTRE document ne doivent jamais contaminer une facture émise —
    // même si, par accident, elles étaient passées ici (ne devrait pas arriver : l'appelant ne
    // batch que les documents `brouillon`).
    const lignesAutreDocument = [
      ligneFixture({ documentId: 'doc-brouillon-sans-rapport', ttcCentimes: 999 }),
    ];

    const resultat = repartirTotalTtcAfficheParDocument([facture], lignesAutreDocument);

    expect(resultat.get('doc-facture')).toBe(4_189_000);
  });

  it("n'affecte jamais les lignes d'un document brouillon aux totaux d'un AUTRE document brouillon", () => {
    const docA = documentFixture({ id: 'doc-a', statut: 'brouillon', totalTtcCentimes: 0n });
    const docB = documentFixture({ id: 'doc-b', statut: 'brouillon', totalTtcCentimes: 0n });
    const lignes = [
      ligneFixture({ documentId: 'doc-a', ttcCentimes: 100_000 }),
      ligneFixture({ documentId: 'doc-b', ttcCentimes: 200_000 }),
    ];

    const resultat = repartirTotalTtcAfficheParDocument([docA, docB], lignes);

    expect(resultat.get('doc-a')).toBe(100_000);
    expect(resultat.get('doc-b')).toBe(200_000);
  });

  it('rend une entrée par document passé en entrée, même une liste vide', () => {
    expect(repartirTotalTtcAfficheParDocument([], []).size).toBe(0);
  });
});
