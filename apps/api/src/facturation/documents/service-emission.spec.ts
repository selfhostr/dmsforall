import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente, type LigneDocumentVente, type LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * `RF-117` : ferme le dégradé documenté dans `auth/matrice-droits.ts` (§EMISSION_AVOIR,
 * « RF-117 NON IMPLÉMENTÉ, SIGNALÉ ») — `receptionnaire` détenait `facturation.document.emettre_avoir`
 * SANS AUCUNE LIMITE. Ce fichier prouve, sans base réelle (fonctions de requête et transaction
 * MOQUÉES — même doctrine que `atelier/service-or.spec.ts` pour `atelier.or.plafond_modifier`),
 * que `ServiceEmissionDocument.emettre()` :
 *  1. refuse `AVOIR_PLAFOND_DEPASSE` à un `receptionnaire` dont l'avoir (cumulé sur la facture
 *     d'origine, RF-117 ne tranchant pas le cas partiel — lecture la plus prudente retenue)
 *     dépasse `parametre_atelier.plafond_avoir_receptionnaire_centimes` ;
 *  2. sur un refus, N'ALLOUE AUCUN NUMÉRO (`compteurs.prochainNumero` jamais appelé) et N'ÉCRIT
 *     JAMAIS `document_vente` (le document reste en `brouillon`, RF-23/24) ;
 *  3. ne plafonne JAMAIS `direction`/`comptable`, quel que soit le montant ;
 *  4. laisse `receptionnaire` émettre SANS LIMITE quand `plafondCentimes` vaut `NULL` — la
 *     non-régression qui protège tous les tenants n'ayant rien paramétré (migration 0018 §3).
 *
 * Le montant comparé est le TTC en VALEUR ABSOLUE : un avoir porte un `totalTtcCentimes <= 0` par
 * construction (`ligne.prixUnitaireCentimes` négatif, voir `service-avoir.ts`) — les lignes de
 * fixture ci-dessous portent donc des montants négatifs, comme un avoir réel.
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  listerLignesDocumentPourEcriture: vi.fn(),
  chargerPlafondAvoirReceptionnaire: vi.fn(),
  sommerAvoirsEmisPourFacture: vi.fn(),
}));

import { ServiceEmissionDocument } from './service-emission';
import * as documentRequetes from './document-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const AVOIR_ID = 'avoir-1';
const CLE_IDEMPOTENCE = '11111111-1111-4111-8111-111111111111';

function principal(role: PrincipalAuthentifie['role']): PrincipalAuthentifie {
  return { sessionId: 'session-1', tenantId: 'tenant-a', utilisateurId: 'user-1', role, langue: 'fr' };
}

function avoirFixture(overrides: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: AVOIR_ID,
    tenantId: 'tenant-a',
    siteId: 'site-1',
    typeDocument: 'avoir',
    statut: 'brouillon',
    numero: null,
    numeroSequence: null,
    exercice: null,
    dateDocument: null,
    clientId: 'client-1',
    clientDesignationFigee: 'Jean Dupont',
    langueFigee: 'fr',
    adresseFacturationFigee: {},
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    factureAnnuleeId: null,
    porteeAvoir: 'partiel',
    devise: 'CHF',
    ...overrides,
  } as unknown as LigneDocumentVente;
}

/** Ligne d'avoir unique, TVA à 0‰ pour que `ttcCentimes = prixUnitaireCentimes` exactement — la
 *  précision de l'arrondi TVA est déjà couverte par `calcul-document.spec.ts`, hors sujet ici. */
function ligneAvoirFixture(prixUnitaireCentimes: number): LigneLigneDocument {
  return {
    id: 'ligne-1',
    tenantId: 'tenant-a',
    documentId: AVOIR_ID,
    numeroOrdre: 1,
    typeLigne: 'forfait',
    designation: 'Avoir',
    regimeTva: 'normal',
    tauxTvaPourmille: 0,
    quantiteMillieme: 1000,
    prixUnitaireCentimes,
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    baseCentimes: prixUnitaireCentimes,
    htCentimes: prixUnitaireCentimes,
    tvaCentimes: 0,
    ttcCentimes: prixUnitaireCentimes,
  } as unknown as LigneLigneDocument;
}

/** Fausse transaction — enregistre CHAQUE appel `update(table)`/`insert(table)` pour pouvoir
 *  prouver, après un refus, qu'AUCUN appel ne cible `document_vente` (aucune écriture de statut
 *  `emis`/numéro), même si les lignes ont déjà été recalculées (étape 1-2, avant le contrôle). */
function txFactice() {
  const whereUpdate = vi.fn(async () => undefined);
  const setUpdate = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn((_table: unknown) => ({ set: setUpdate }));
  const valuesInsert = vi.fn(async () => undefined);
  const insert = vi.fn((_table: unknown) => ({ values: valuesInsert }));
  return { tx: { update, insert } as unknown as TransactionDfa, update, setUpdate, whereUpdate, insert, valuesInsert };
}

function serviceFactice(tx: TransactionDfa) {
  // `ServiceIdempotence.executer` rend `{ reponse, rejoue }` (jamais `travail(tx)` nu) — la fausse
  // implémentation reproduit cette forme pour que le type déclaré de `emettre()` (`ResultatIdempotent<T>`)
  // reste vrai dans les tests, `rejoue: false` (aucun test ici n'exerce le rejeu).
  const idempotence = {
    executer: vi.fn(async (_ctx: ContexteTenant, _requete: unknown, travail: (tx: TransactionDfa) => Promise<unknown>) => ({
      reponse: await travail(tx),
      rejoue: false,
    })),
  };
  const evenements = { publier: vi.fn(async () => undefined) };
  const compteurs = { prochainNumero: vi.fn(async () => 7) };
  const horloge = { maintenant: () => new Date('2026-07-30T10:00:00.000Z') };
  const documents = { assemblerDocument: vi.fn(async () => ({ id: AVOIR_ID })) };
  const service = new ServiceEmissionDocument(
    {} as never, // `acces` (JETON_DB) : jamais exercé par `emettre()`, seul `idempotence.executer` l'est.
    idempotence as never,
    evenements as never,
    compteurs as never,
    horloge as never,
    documents as never,
  );
  return { service, idempotence, evenements, compteurs, horloge, documents };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(0);
});

describe("ServiceEmissionDocument.emettre — plafond RF-117 sur l'avoir de receptionnaire", () => {
  it('receptionnaire refusé au-delà du plafond — AVOIR_PLAFOND_DEPASSE, aucun numéro alloué, document_vente jamais écrit', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(avoirFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([ligneAvoirFixture(-600_000)]); // avoir de CHF 6'000.-
    vi.mocked(documentRequetes.chargerPlafondAvoirReceptionnaire).mockResolvedValue(500_000); // plafond CHF 5'000.-

    const { tx, update } = txFactice();
    const { service, compteurs, documents, evenements } = serviceFactice(tx);

    await expect(service.emettre(CTX, principal('receptionnaire'), AVOIR_ID, CLE_IDEMPOTENCE)).rejects.toMatchObject({
      code: 'AVOIR_PLAFOND_DEPASSE',
      status: 409,
      blocages: [{ type: 'document_vente', id: AVOIR_ID, donnees: { plafondCentimes: 500_000, cumulCentimes: 600_000 } }],
      actionsProposees: [{ code: 'DEMANDER_HABILITATION' }],
    });

    // Aucun numéro alloué (RF-23/24), document_vente jamais mis à jour — seules les LIGNES ont pu
    // être recalculées (étape 1-2, avant le contrôle), jamais l'en-tête du document.
    expect(compteurs.prochainNumero).not.toHaveBeenCalled();
    expect(update.mock.calls.some((appel) => appel[0] === documentVente)).toBe(false);
    expect(documents.assemblerDocument).not.toHaveBeenCalled();
    expect(evenements.publier).not.toHaveBeenCalled();
  });

  it.each(['direction', 'comptable'] as const)('%s n\'est JAMAIS plafonné — le même montant qui bloque un receptionnaire passe, sans même lire le plafond', async (role) => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(avoirFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([ligneAvoirFixture(-600_000)]);

    const { tx } = txFactice();
    const { service, compteurs, documents } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(role), AVOIR_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
    expect(documents.assemblerDocument).toHaveBeenCalledTimes(1);
    // Le plafond n'est même pas LU pour un rôle non concerné (colonne nommée `..._receptionnaire`,
    // §RF-117) — ni la colonne, ni les avoirs déjà émis sur la facture.
    expect(documentRequetes.chargerPlafondAvoirReceptionnaire).not.toHaveBeenCalled();
  });

  it('plafond NULL (aucun paramétrage) — receptionnaire émet SANS LIMITE, comportement actuel préservé (non-régression, migration 0018 §3)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(avoirFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([ligneAvoirFixture(-6_000_000)]); // CHF 60'000.-, énorme
    vi.mocked(documentRequetes.chargerPlafondAvoirReceptionnaire).mockResolvedValue(null);

    const { tx } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal('receptionnaire'), AVOIR_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
  });

  it("lecture CUMULATIVE (la plus prudente) : un avoir partiel sous le plafond pris isolément est refusé si le cumul avec les avoirs déjà ÉMIS sur la même facture dépasse", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(avoirFixture({ factureAnnuleeId: 'facture-1' }));
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([ligneAvoirFixture(-100_000)]); // CET avoir : CHF 1'000.-, seul, sous le plafond
    vi.mocked(documentRequetes.chargerPlafondAvoirReceptionnaire).mockResolvedValue(500_000); // plafond CHF 5'000.-
    vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(450_000); // déjà CHF 4'500.- rendus sur cette facture

    const { tx } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    await expect(service.emettre(CTX, principal('receptionnaire'), AVOIR_ID, CLE_IDEMPOTENCE)).rejects.toMatchObject({
      code: 'AVOIR_PLAFOND_DEPASSE',
      blocages: [{ donnees: { plafondCentimes: 500_000, cumulCentimes: 550_000 } }],
    });
    expect(documentRequetes.sommerAvoirsEmisPourFacture).toHaveBeenCalledWith(tx, CTX, 'facture-1');
    expect(compteurs.prochainNumero).not.toHaveBeenCalled();
  });

  it('cumul EXACTEMENT égal au plafond est autorisé — la comparaison est stricte (> et non >=)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(avoirFixture({ factureAnnuleeId: 'facture-1' }));
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([ligneAvoirFixture(-100_000)]);
    vi.mocked(documentRequetes.chargerPlafondAvoirReceptionnaire).mockResolvedValue(500_000);
    vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(400_000); // 400'000 + 100'000 = 500'000 pile

    const { tx } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal('receptionnaire'), AVOIR_ID, CLE_IDEMPOTENCE);
    expect(resultat.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
  });

  it("avoir libre (sans facture d'origine) : aucun cumul à calculer, `sommerAvoirsEmisPourFacture` jamais appelée", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(avoirFixture({ factureAnnuleeId: null }));
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([ligneAvoirFixture(-100_000)]);
    vi.mocked(documentRequetes.chargerPlafondAvoirReceptionnaire).mockResolvedValue(500_000);

    const { tx } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal('receptionnaire'), AVOIR_ID, CLE_IDEMPOTENCE);
    expect(resultat.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
    expect(documentRequetes.sommerAvoirsEmisPourFacture).not.toHaveBeenCalled();
  });

});
