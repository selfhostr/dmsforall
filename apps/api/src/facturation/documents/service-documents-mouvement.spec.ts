import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaCleIdempotence, type EntreeCreationLigneDocument } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import type { LigneDocumentVente, LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

/**
 * RP-43/RP-46 — le pont vente comptoir ↔ pièces, côté `ServiceDocumentsVente`
 * (`service-documents.ts::inserterLigne`/`modifierLigne`/`supprimerLigne`). Garanties demandées
 * par la tâche, prouvées ici avec `ServiceMouvement` MOQUÉ (le comportement RÉEL de
 * `ServiceMouvement` — vérification de disponibilité, insertion, masquage par rôle — est prouvé
 * séparément dans `pieces/service-mouvement.spec.ts` ; ce fichier prouve seulement le CÂBLAGE) :
 *
 *  1. Rattachement NOMINAL : une ligne `piece` avec `articleId`/`siteId` déclenche
 *     `sortieComptoirPourLigneTx` avec les BONS paramètres (article, site, quantité, l'id de la
 *     ligne QUI VIENT D'ÊTRE INSÉRÉE comme `documentVenteLigneId`).
 *  2. ATOMICITÉ : un échec du pont (stock insuffisant) fait échouer `ajouterLigne` TOUT ENTIER —
 *     rien n'intercepte l'exception entre l'appel et le retour de la méthode, donc dans un VRAI
 *     `tx` Postgres (ouvert par `ServiceIdempotenceImpl.executer`, `common/idempotence/`),
 *     l'`INSERT` de la ligne de document ET l'écriture de `cle_idempotence` seraient annulés
 *     ensemble (même transaction, même callback).
 *  3. REFUS sur document ÉMIS : le verrouillage `MD-21` existant (`DOCUMENT_VERROUILLE`) reste la
 *     PREMIÈRE porte — le pont n'est jamais atteint pour un document qui n'est plus `brouillon`.
 *  4. IDEMPOTENCE (gap comblé — voir le rapport de livraison RP-43 qui le signalait "hors
 *     périmètre") : `ajouterLigne` exerce désormais `ServiceIdempotence.executer` exactement comme
 *     `creer`/`emettre`/`creerAvoir` — un rejeu avec la MÊME clé ne ré-exécute jamais `travail`
 *     (donc jamais un second `INSERT` de ligne ni un second mouvement de stock), une clé absente ou
 *     mal formée est refusée `VALIDATION_ECHOUEE` AVANT tout accès base, et deux clés distinctes
 *     produisent deux exécutions indépendantes.
 *
 * PLUS, la garde d'immuabilité `LIGNE_DOCUMENT_STOCK_LIEE` (`modifierLigne`/`supprimerLigne`) :
 * une ligne déjà liée à un mouvement de stock ne peut plus être touchée, une ligne SANS mouvement
 * continue de fonctionner exactement comme avant ce lot (non-régression). `modifierLigne` et
 * `supprimerLigne` n'exercent PAS `idempotence.executer` — PATCH/DELETE sont idempotents par
 * nature HTTP (rejouer ne produit pas un second effet distinct, contrairement à un POST qui crée
 * une ressource à chaque appel), et `refuserSiLigneStockLiee` bloque de toute façon TOUTE écriture
 * sur une ligne qui a déjà déclenché un mouvement de stock — aucune des deux méthodes ne peut donc
 * aujourd'hui re-déclencher un effet de bord stock, contrairement à `ajouterLigne`.
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  chargerLignePourEcriture: vi.fn(),
  listerLignesDocument: vi.fn(),
}));

import { ServiceDocumentsVente } from './service-documents';
import * as documentRequetes from './document-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const DOCUMENT_ID = 'document-1';
const LIGNE_ID = 'ligne-existante-1';
const LIGNE_NOUVELLE_ID = 'ligne-nouvelle-1';
const CLE_A = '11111111-1111-4111-8111-111111111111';
const CLE_B = '22222222-2222-4222-8222-222222222222';

function principal(role: PrincipalAuthentifie['role'] = 'vendeur'): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role,
    langue: 'fr',
  };
}

function docFixture(overrides: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: DOCUMENT_ID,
    tenantId: 'tenant-a',
    typeDocument: 'facture',
    statut: 'brouillon',
    numero: null,
    ...overrides,
  } as unknown as LigneDocumentVente;
}

function ligneExistanteFixture(overrides: Partial<LigneLigneDocument> = {}): LigneLigneDocument {
  return {
    id: LIGNE_ID,
    tenantId: 'tenant-a',
    documentId: DOCUMENT_ID,
    numeroOrdre: 1,
    typeLigne: 'forfait',
    designation: 'Forfait diagnostic',
    referenceTexte: null,
    quantiteMillieme: 1000,
    prixUnitaireCentimes: 7000,
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-04',
    remisePourmille: null,
    remiseMontantCentimes: null,
    documentAcompteId: null,
    ...overrides,
  } as unknown as LigneLigneDocument;
}

function entreePieceFixture(
  overrides: Partial<EntreeCreationLigneDocument> = {},
): EntreeCreationLigneDocument {
  return {
    type: 'piece',
    designation: 'Plaquettes de frein avant',
    quantiteMillieme: 1000,
    prixUnitaireTtcCentimes: 8900,
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-04',
    articleId: 'article-1',
    siteId: 'site-1',
    ...overrides,
  } as unknown as EntreeCreationLigneDocument;
}

/** `insert(ligneDocument).values(...).returning()` rend une ligne minimale mais typée juste assez
 *  pour que `inserterLigne` construise `documentVenteLigneId = ligne.id` — le reste (montants,
 *  etc.) est hors sujet ici (déjà couvert par `calcul-document.spec.ts`). `update`/`delete` posés
 *  pour les tests `modifierLigne`/`supprimerLigne` non-régression. */
function txFactice() {
  const returningInsert = vi.fn(async () => [ligneExistanteFixture({ id: LIGNE_NOUVELLE_ID })]);
  const valuesInsert = vi.fn((_v: unknown) => ({ returning: returningInsert }));
  const insert = vi.fn((_table: unknown) => ({ values: valuesInsert }));
  const whereUpdate = vi.fn(async () => undefined);
  const setUpdate = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn((_table: unknown) => ({ set: setUpdate }));
  const whereDelete = vi.fn(async () => undefined);
  const del = vi.fn((_table: unknown) => ({ where: whereDelete }));
  return {
    tx: { insert, update, delete: del } as unknown as TransactionDfa,
    insert,
    valuesInsert,
    returningInsert,
    update,
    setUpdate,
    delete: del,
  };
}

/**
 * Fausse `ServiceIdempotence.executer` RÉALISTE (pas un passthrough) : reproduit la sémantique de
 * `ServiceIdempotenceImpl` (`common/idempotence/service-idempotence.ts`) — validation de la clé
 * (`schemaCleIdempotence`, uuid v4), dédup par `(clé, empreinte du corps)`, `travail` JAMAIS
 * ré-exécuté sur rejeu — sans dépendre de Postgres. Volontairement plus simple que la vraie
 * empreinte SHA-256 canonicalisée (`common/idempotence/empreinte.ts`) : une comparaison JSON stricte
 * suffit ici, les fixtures de ce fichier ne varient jamais l'ordre des clés d'un appel à l'autre.
 */
function idempotenceFactice(tx: TransactionDfa) {
  const memoire = new Map<
    string,
    { readonly empreinte: string; readonly statutHttp: number; readonly corps: unknown }
  >();
  const executer = vi.fn(
    async (
      _ctx: ContexteTenant,
      requete: { readonly cle: string; readonly corps: unknown },
      travail: (tx: TransactionDfa) => Promise<{ statutHttp: number; corps: unknown }>,
    ) => {
      const validation = schemaCleIdempotence.safeParse(requete.cle);
      if (!validation.success) {
        throw new ErreurMetier('VALIDATION_ECHOUEE', "Clé d'idempotence invalide.", {
          erreurs: [
            {
              champ: 'Idempotency-Key',
              code: 'cle_invalide',
              message: "La clé d'idempotence doit être un uuid v4.",
            },
          ],
        });
      }

      const empreinte = JSON.stringify(requete.corps);
      const existante = memoire.get(requete.cle);
      if (existante) {
        if (existante.empreinte !== empreinte) {
          throw new ErreurMetier(
            'IDEMPOTENCE_CONFLIT',
            "La même clé d'idempotence a déjà été utilisée avec un corps de requête différent.",
          );
        }
        return {
          reponse: { statutHttp: existante.statutHttp, corps: existante.corps },
          rejoue: true,
        };
      }

      // AUCUNE ligne mémorisée AVANT que `travail` réussisse — exactement comme la vraie
      // implémentation (le `UPDATE cle_idempotence … statut = 'termine'` n'arrive qu'APRÈS
      // `travail(tx)`, dans la même transaction) : un `travail` qui rejette ne bloque donc jamais
      // une tentative ultérieure sous la même clé.
      const resultat = await travail(tx);
      memoire.set(requete.cle, {
        empreinte,
        statutHttp: resultat.statutHttp,
        corps: resultat.corps,
      });
      return { reponse: resultat, rejoue: false };
    },
  );
  return { executer, memoire };
}

function serviceFactice(tx: TransactionDfa) {
  const acces = {
    enTenant: vi.fn((_ctx: unknown, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail(tx),
    ),
  };
  const idempotence = idempotenceFactice(tx);
  const audit = { pourEntite: vi.fn(async () => []), consigner: vi.fn(async () => undefined) };
  const horloge = { maintenant: () => new Date('2026-08-04T09:00:00.000Z') };
  const serviceMouvement = {
    sortieComptoirPourLigneTx: vi.fn(async () => ({ id: 'mouvement-1', type: 'sortie_comptoir' })),
    trouverMouvementParLigneDocumentTx: vi.fn(async () => null),
  };
  const service = new ServiceDocumentsVente(
    // `acces` (JETON_DB) : encore exercé par `modifierLigne`/`supprimerLigne`, qui ne passent PAS
    // par `idempotence.executer` (voir la docstring d'en-tête) — `ajouterLigne`, lui, n'appelle
    // plus `acces.enTenant` du tout (même patron que `creer`, qui délègue entièrement l'ouverture
    // de transaction à `idempotence.executer`).
    acces as never,
    idempotence as never,
    audit as never,
    horloge as never,
    serviceMouvement as never,
  );
  service.assemblerDocument = vi.fn(async () => ({ id: DOCUMENT_ID })) as never;
  return { service, acces, serviceMouvement, idempotence };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.listerLignesDocument).mockResolvedValue([]);
});

describe('ServiceDocumentsVente.ajouterLigne — pont vente comptoir (RP-43)', () => {
  it("rattachement NOMINAL : une ligne 'piece' avec articleId/siteId déclenche sortieComptoirPourLigneTx avec l'id de la ligne QUI VIENT D'ÊTRE INSÉRÉE", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);

    const resultat = await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      entreePieceFixture({ articleId: 'article-42', siteId: 'site-7', quantiteMillieme: 2000 }),
      CLE_A,
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.donnees).toMatchObject({ id: DOCUMENT_ID });
    expect(resultat.rejoue).toBe(false);
    expect(serviceMouvement.sortieComptoirPourLigneTx).toHaveBeenCalledTimes(1);
    expect(serviceMouvement.sortieComptoirPourLigneTx).toHaveBeenCalledWith(tx, CTX, 'vendeur', {
      articleId: 'article-42',
      siteId: 'site-7',
      quantiteMillieme: 2000,
      documentVenteLigneId: LIGNE_NOUVELLE_ID,
      motif: null,
    });
  });

  it("une ligne 'piece' SANS articleId/siteId ne déclenche AUCUN pont (non-régression : débours, correction, prestation valorisée sans article de référentiel)", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);

    await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      entreePieceFixture({ articleId: undefined, siteId: undefined }),
      CLE_A,
    );

    expect(serviceMouvement.sortieComptoirPourLigneTx).not.toHaveBeenCalled();
  });

  it("une ligne 'forfait' (jamais de pont, même si articleId était présent) ne déclenche jamais le pont", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);

    await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      {
        type: 'forfait',
        designation: 'Forfait',
        quantiteMillieme: 1000,
        prixUnitaireTtcCentimes: 5000,
        regimeTva: 'normal',
        tauxTvaPourmille: 81,
        datePrestation: '2026-08-04',
      } as unknown as EntreeCreationLigneDocument,
      CLE_A,
    );

    expect(serviceMouvement.sortieComptoirPourLigneTx).not.toHaveBeenCalled();
  });

  it("ATOMICITÉ : un échec du pont (409 STOCK_INSUFFISANT) fait échouer ajouterLigne TOUT ENTIER — rien n'intercepte l'exception, la ligne de document ne serait jamais committée sans lui (même tx, même callback idempotence.executer)", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx } = txFactice();
    const { service, serviceMouvement, acces, idempotence } = serviceFactice(tx);
    const erreurStock = Object.assign(new Error('Stock disponible insuffisant'), {
      code: 'STOCK_INSUFFISANT',
      status: 409,
    });
    vi.mocked(serviceMouvement.sortieComptoirPourLigneTx).mockRejectedValueOnce(erreurStock);

    await expect(
      service.ajouterLigne(CTX, principal('vendeur'), DOCUMENT_ID, entreePieceFixture(), CLE_A),
    ).rejects.toMatchObject({ code: 'STOCK_INSUFFISANT', status: 409 });

    // La preuve d'atomicité : `idempotence.executer` (qui ouvre la VRAIE transaction en
    // production, `ServiceIdempotenceImpl.executer`) n'a été appelé QU'UNE fois, avec le `travail`
    // qui a rejeté — une exception non rattrapée dans `travail` déclenche le `ROLLBACK` de LA MÊME
    // transaction que l'`INSERT` de la ligne ET l'écriture de `cle_idempotence`, avant de se
    // propager. `acces.enTenant` (JETON_DB direct) n'est PAS sollicité par `ajouterLigne` — même
    // patron que `creer`, qui délègue entièrement l'ouverture de transaction à
    // `idempotence.executer`.
    expect(idempotence.executer).toHaveBeenCalledTimes(1);
    expect(acces.enTenant).not.toHaveBeenCalled();
    // Et la clé n'a PAS été mémorisée comme "terminée" — un retry sous la même clé après l'échec
    // ré-exécuterait `travail` plutôt que de rester bloqué en conflit, exactement comme le ferait
    // la vraie implémentation (le rollback annule aussi l'écriture de `cle_idempotence`).
    expect(idempotence.memoire.has(CLE_A)).toBe(false);
  });

  it("REFUS sur document ÉMIS (MD-21, DOCUMENT_VERROUILLE) : le pont n'est JAMAIS atteint — le verrou existant reste la première porte", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      docFixture({ statut: 'emis', numero: '2026-00042' }),
    );
    const { tx } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);

    await expect(
      service.ajouterLigne(CTX, principal('vendeur'), DOCUMENT_ID, entreePieceFixture(), CLE_A),
    ).rejects.toMatchObject({ code: 'DOCUMENT_VERROUILLE', status: 409 });

    expect(serviceMouvement.sortieComptoirPourLigneTx).not.toHaveBeenCalled();
  });
});

describe('ServiceDocumentsVente.ajouterLigne — idempotence obligatoire (gap RP-43 comblé)', () => {
  it('clé absente (chaîne vide) : refuse VALIDATION_ECHOUEE AVANT tout accès base — aucun INSERT, aucun pont stock', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx, insert } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);

    await expect(
      service.ajouterLigne(CTX, principal('vendeur'), DOCUMENT_ID, entreePieceFixture(), ''),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });

    expect(insert).not.toHaveBeenCalled();
    expect(serviceMouvement.sortieComptoirPourLigneTx).not.toHaveBeenCalled();
    expect(documentRequetes.chargerDocumentPourEcriture).not.toHaveBeenCalled();
  });

  it('clé mal formée (pas un uuid v4) : refuse VALIDATION_ECHOUEE', async () => {
    const { tx } = txFactice();
    const { service } = serviceFactice(tx);

    await expect(
      service.ajouterLigne(
        CTX,
        principal('vendeur'),
        DOCUMENT_ID,
        entreePieceFixture(),
        'pas-un-uuid',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });

  it('REJEU : deux appels avec LA MÊME clé, LE MÊME documentId et LA MÊME entrée → un seul INSERT de ligne, un seul appel au pont stock, réponses identiques (rejoue: false puis true)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx, insert } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);
    const entree = entreePieceFixture({ articleId: 'article-42', siteId: 'site-7' });

    const premier = await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      entree,
      CLE_A,
    );
    const second = await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      entree,
      CLE_A,
    );

    expect(premier.rejoue).toBe(false);
    expect(second.rejoue).toBe(true);
    expect(premier.reponse).toEqual(second.reponse);
    expect(insert.mock.calls.length).toBe(1);
    expect(serviceMouvement.sortieComptoirPourLigneTx).toHaveBeenCalledTimes(1);
  });

  it('clés DIFFÉRENTES : deux appels avec des clés distinctes → deux INSERT (deux lignes), deux appels au pont stock', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx, insert } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);
    const entree = entreePieceFixture({ articleId: 'article-42', siteId: 'site-7' });

    const premier = await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      entree,
      CLE_A,
    );
    const second = await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      entree,
      CLE_B,
    );

    expect(premier.rejoue).toBe(false);
    expect(second.rejoue).toBe(false);
    expect(insert.mock.calls.length).toBe(2);
    expect(serviceMouvement.sortieComptoirPourLigneTx).toHaveBeenCalledTimes(2);
  });

  it('même clé, corps DIFFÉRENT (empreinte différente) : refuse IDEMPOTENCE_CONFLIT, sans ré-exécuter le pont une seconde fois', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    const { tx } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);

    await service.ajouterLigne(
      CTX,
      principal('vendeur'),
      DOCUMENT_ID,
      entreePieceFixture({ quantiteMillieme: 1000 }),
      CLE_A,
    );
    await expect(
      service.ajouterLigne(
        CTX,
        principal('vendeur'),
        DOCUMENT_ID,
        entreePieceFixture({ quantiteMillieme: 2000 }),
        CLE_A,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCE_CONFLIT' });

    expect(serviceMouvement.sortieComptoirPourLigneTx).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceDocumentsVente.modifierLigne/supprimerLigne — immuabilité de la ligne liée à un mouvement (RP-43/RP-46)', () => {
  it('modifierLigne : refuse 409 LIGNE_DOCUMENT_STOCK_LIEE quand un mouvement référence déjà cette ligne, AUCUN UPDATE exécuté', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    vi.mocked(documentRequetes.chargerLignePourEcriture).mockResolvedValue(ligneExistanteFixture());
    const { tx, update } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);
    vi.mocked(serviceMouvement.trouverMouvementParLigneDocumentTx).mockResolvedValue({
      id: 'mouvement-1',
      type: 'sortie_comptoir',
    } as never);

    await expect(
      service.modifierLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID, {
        prixUnitaireTtcCentimes: 9500,
      }),
    ).rejects.toMatchObject({ code: 'LIGNE_DOCUMENT_STOCK_LIEE', status: 409 });

    expect(update).not.toHaveBeenCalled();
  });

  it("modifierLigne : une ligne SANS mouvement lié continue de fonctionner (non-régression) — l'UPDATE est atteint", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    vi.mocked(documentRequetes.chargerLignePourEcriture).mockResolvedValue(ligneExistanteFixture());
    const { tx, update } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);
    // `serviceFactice` pose déjà `trouverMouvementParLigneDocumentTx` → `null` par défaut.

    const resultat = await service.modifierLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID, {
      prixUnitaireTtcCentimes: 9500,
    });

    expect(resultat.donnees).toMatchObject({ id: DOCUMENT_ID });
    expect(update).toHaveBeenCalledTimes(1);
    expect(serviceMouvement.trouverMouvementParLigneDocumentTx).toHaveBeenCalledWith(
      tx,
      CTX,
      LIGNE_ID,
    );
  });

  it('supprimerLigne : refuse 409 LIGNE_DOCUMENT_STOCK_LIEE quand un mouvement référence déjà cette ligne, AUCUN DELETE exécuté', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    vi.mocked(documentRequetes.chargerLignePourEcriture).mockResolvedValue(ligneExistanteFixture());
    const { tx, delete: del } = txFactice();
    const { service, serviceMouvement } = serviceFactice(tx);
    vi.mocked(serviceMouvement.trouverMouvementParLigneDocumentTx).mockResolvedValue({
      id: 'mouvement-1',
      type: 'sortie_comptoir',
    } as never);

    await expect(
      service.supprimerLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID),
    ).rejects.toMatchObject({ code: 'LIGNE_DOCUMENT_STOCK_LIEE', status: 409 });

    expect(del).not.toHaveBeenCalled();
  });

  it('supprimerLigne : une ligne SANS mouvement lié continue de fonctionner (non-régression) — le DELETE est atteint', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    vi.mocked(documentRequetes.chargerLignePourEcriture).mockResolvedValue(ligneExistanteFixture());
    const { tx, delete: del } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.supprimerLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID);

    expect(resultat.donnees).toMatchObject({ id: DOCUMENT_ID });
    expect(del).toHaveBeenCalledTimes(1);
  });
});
