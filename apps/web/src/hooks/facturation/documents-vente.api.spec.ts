import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ReponseDocumentVente } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';

import { listerDocumentsVente } from './documents-vente.api';

/**
 * Preuve du bug confirmé en exécution (voir l'ÉCART SIGNALÉ dans `documents-vente.api.ts`) :
 * `GET /documents-vente` renvoie des `ReponseDocumentVente` COMPLETS (désignation client sous
 * `figees.clientDesignation`), jamais la projection `DocumentVenteResume` (désignation au premier
 * niveau) que le contrat annonce. Vérifié en direct (`curl` authentifié contre l'API du dépôt,
 * comptes `admin@garage-martin.ch` et `comptable@garage-martin.ch`) avant d'écrire ce test — la
 * fixture ci-dessous reproduit fidèlement cette forme réelle, PAS la forme du contrat.
 */
function construireDocumentBrut(
  overrides: Partial<ReponseDocumentVente> = {},
): ReponseDocumentVente {
  return {
    id: 'doc-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: '2026-00007',
    numeroSequence: 7,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: 'regle',
    siteId: 'site-1',
    clientId: 'cl-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      // Emplacement RÉEL de la désignation client sur `GET /documents-vente` — jamais au premier
      // niveau, contrairement à ce que `DocumentVenteResume` annonce.
      clientDesignation: 'Dupont Claire',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      conditionsPaiement: null,
      plaque: null,
    },
    dateDocument: '2026-08-04',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 4931,
    totalTvaCentimes: 401,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 5332,
    ventilationTva: [],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 5332,
    soldeCentimes: 0,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: null,
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [],
    nombreLignes: 1,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-08-04T08:39:02.200Z',
    emisPar: { utilisateurId: 'u1', nomAffiche: 'Isabelle Bonvin' },
    creeLe: '2026-08-04T08:38:14.341Z',
    modifieLe: '2026-08-04T08:39:17.740Z',
    modifiePar: null,
    ...overrides,
  };
}

describe('listerDocumentsVente', () => {
  it('projette la désignation client depuis `figees.clientDesignation` (forme réelle du serveur), pas depuis un champ de premier niveau qui n’existe pas', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [construireDocumentBrut()],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    const page = await listerDocumentsVente(
      { typeDocument: ['facture'], tri: 'dateDocument:desc' },
      {
        limite: 50,
      },
    );

    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.clientDesignation).toBe('Dupont Claire');
    // Le champ de premier niveau que `DocumentVenteResume` annonce n'existe pas côté serveur —
    // toute lecture directe de `document_.clientDesignation` sur la réponse brute serait
    // `undefined`. Preuve que la fixture reproduit bien la forme réelle (pas une forme conforme
    // au contrat qui masquerait le bug).
    expect(
      (construireDocumentBrut() as { clientDesignation?: unknown }).clientDesignation,
    ).toBeUndefined();
  });

  it('conserve montant TTC et statut de règlement (déjà au premier niveau dans les deux formes)', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [construireDocumentBrut()],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    const page = await listerDocumentsVente(
      { typeDocument: ['facture'], tri: 'dateDocument:desc' },
      {
        limite: 50,
      },
    );

    expect(page.donnees[0]?.totalTtcCentimes).toBe(5332);
    expect(page.donnees[0]?.statutReglement).toBe('regle');
  });

  it('laisse `statutReglement`/`totalTtcCentimes` absents pour un rôle sans droit aux montants (RF-114→RF-116, comportement voulu — pas un bug)', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({ statutReglement: undefined, totalTtcCentimes: undefined }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    const page = await listerDocumentsVente(
      { typeDocument: ['facture'], tri: 'dateDocument:desc' },
      {
        limite: 50,
      },
    );

    expect(page.donnees[0]?.statutReglement).toBeUndefined();
    expect(page.donnees[0]?.totalTtcCentimes).toBeUndefined();
    // La désignation client, elle, ne dépend d'aucun droit — toujours projetée.
    expect(page.donnees[0]?.clientDesignation).toBe('Dupont Claire');
  });
});
