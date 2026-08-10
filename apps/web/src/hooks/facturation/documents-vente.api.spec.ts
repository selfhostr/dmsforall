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

  it('transporte dateEcheance/enRetard/joursRetard pour une facture en retard (colonne « Retard » de la liste, `IndicateurRetard`)', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({
              dateEcheance: '2026-07-15',
              enRetard: true,
              joursRetard: 20,
            }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    const page = await listerDocumentsVente(
      { typeDocument: ['facture'], tri: 'dateDocument:desc' },
      { limite: 50 },
    );

    expect(page.donnees[0]?.dateEcheance).toBe('2026-07-15');
    expect(page.donnees[0]?.enRetard).toBe(true);
    expect(page.donnees[0]?.joursRetard).toBe(20);
  });

  it('transporte une échéance à venir (`enRetard: false`, `joursRetard: null` — jamais `0`, voir document.ts)', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({
              dateEcheance: '2026-09-01',
              enRetard: false,
              joursRetard: null,
            }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    const page = await listerDocumentsVente(
      { typeDocument: ['facture'], tri: 'dateDocument:desc' },
      { limite: 50 },
    );

    expect(page.donnees[0]?.dateEcheance).toBe('2026-09-01');
    expect(page.donnees[0]?.enRetard).toBe(false);
    expect(page.donnees[0]?.joursRetard).toBeNull();
  });

  it('transporte `dateEcheance: null` (échéance inconnue — facture antérieure au champ, ou client sans délai paramétré) sans jamais la remplacer', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({ dateEcheance: null, enRetard: false, joursRetard: null }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    const page = await listerDocumentsVente(
      { typeDocument: ['facture'], tri: 'dateDocument:desc' },
      { limite: 50 },
    );

    expect(page.donnees[0]?.dateEcheance).toBeNull();
  });

  it('laisse dateEcheance/enRetard/joursRetard absents pour un rôle sans droit aux montants (même masquage que le reste du bloc financier, RF-114→RF-116)', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({
              statutReglement: undefined,
              totalTtcCentimes: undefined,
              dateEcheance: undefined,
              enRetard: undefined,
              joursRetard: undefined,
            }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    const page = await listerDocumentsVente(
      { typeDocument: ['facture'], tri: 'dateDocument:desc' },
      { limite: 50 },
    );

    expect(page.donnees[0]?.dateEcheance).toBeUndefined();
    expect(page.donnees[0]?.enRetard).toBeUndefined();
    expect(page.donnees[0]?.joursRetard).toBeUndefined();
  });
});

describe('listerDocumentsVente — sérialisation des filtres `enRetard`/`relanceNiveau`', () => {
  /**
   * Défaut confirmé : `construireParametres` sérialisait chaque filtre champ par champ, mais
   * n'émettait jamais `enRetard` ni `relanceNiveau` — les deux étaient acceptés par le contrat
   * (`FiltresDocumentsVente`, `document.ts`) et sus de l'écran, mais silencieusement avalés avant
   * d'atteindre le serveur, même famille de bug que `detenteurId` déjà documentée en tête de
   * `documents-vente.api.ts`. `construireParametres` n'est pas exportée : la preuve passe par
   * l'URL réellement reçue par le serveur simulé (MSW), pas par un appel direct à la fonction.
   */
  async function capturerParametresRequete(
    filtres: Parameters<typeof listerDocumentsVente>[0],
  ): Promise<URLSearchParams> {
    let parametresRecus: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/documents-vente', ({ request }) => {
        parametresRecus = new URL(request.url).searchParams;
        return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 });
      }),
    );

    await listerDocumentsVente(filtres, { limite: 50 });

    if (!parametresRecus) {
      throw new Error('Aucune requête interceptée par MSW.');
    }
    return parametresRecus;
  }

  it('transmet `enRetard=true` au serveur (onglet « En retard »)', async () => {
    const parametres = await capturerParametresRequete({
      enRetard: true,
      tri: 'dateDocument:desc',
    });

    expect(parametres.get('enRetard')).toBe('true');
  });

  it('transmet `relanceNiveau=0` au serveur — cas piège : une sérialisation par véracité (`if (valeur)`) perdrait silencieusement ce palier', async () => {
    const parametres = await capturerParametresRequete({
      enRetard: true,
      relanceNiveau: 0,
      tri: 'dateDocument:desc',
    });

    expect(parametres.get('enRetard')).toBe('true');
    expect(parametres.has('relanceNiveau')).toBe(true);
    expect(parametres.get('relanceNiveau')).toBe('0');
  });

  it('transmet un palier de relance non nul (`relanceNiveau=2`)', async () => {
    const parametres = await capturerParametresRequete({
      relanceNiveau: 2,
      tri: 'dateDocument:desc',
    });

    expect(parametres.get('relanceNiveau')).toBe('2');
  });

  it("n'émet ni `enRetard` ni `relanceNiveau` quand aucun des deux filtres n'est fourni (pas de bruit sur les autres onglets)", async () => {
    const parametres = await capturerParametresRequete({ tri: 'dateDocument:desc' });

    expect(parametres.has('enRetard')).toBe(false);
    expect(parametres.has('relanceNiveau')).toBe(false);
  });
});
