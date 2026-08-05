import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreeCreationDocumentVente } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * RV-37/MD-70 : `ServiceDocumentsVente.creer()` accepte et PERSISTE `dossierVenteId` (`bon_commande`
 * et `facture` seulement, imposé par `schemaCreationDocumentVente` côté contrat — hors sujet ici) —
 * c'était le bloqueur constaté : la colonne existait, était LUE, mais aucun service ne l'écrivait
 * jamais, donc `dossier.documents` restait vide et `POST /dossiers-vente/{id}/engager` (qui exige un
 * `bonCommandeDocumentId`) était inutilisable.
 *
 * `chargerDossierVentePourRattachement` (`./references.ts`) fait tout le travail de validation
 * (tenant + état) : ce fichier prouve que `creer()` l'INVOQUE et PROPAGE son refus AVANT toute
 * écriture — jamais que la validation elle-même est correcte (couvert séparément, voir
 * `references.dossier-vente.spec.ts`).
 */
vi.mock('./references', () => ({
  chargerAdresseFacturationStructuree: vi.fn(),
  chargerClientLigne: vi.fn(),
  chargerConditionsPaiementEnVigueur: vi.fn(),
  chargerDossierVentePourRattachement: vi.fn(),
  chargerPlaqueVehiculeCourante: vi.fn(),
  chargerResumeUtilisateur: vi.fn(),
  nomAfficheClient: vi.fn(() => 'Jean Dupont'),
  verifierVehiculeExiste: vi.fn(),
}));

import { ServiceDocumentsVente } from './service-documents';
import * as references from './references';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const CLE_IDEMPOTENCE = '33333333-3333-4333-8333-333333333333';
const DOSSIER_ID = 'dossier-1';
const CLIENT_ID = 'client-1';

function principal(): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role: 'vendeur',
    langue: 'fr',
  };
}

function entreeFixture(
  overrides: Partial<EntreeCreationDocumentVente> = {},
): EntreeCreationDocumentVente {
  return {
    typeDocument: 'bon_commande',
    siteId: 'site-1',
    clientId: CLIENT_ID,
    devise: 'CHF',
    lignes: [],
    ...overrides,
  } as unknown as EntreeCreationDocumentVente;
}

/** Fausse transaction : seul `insert(documentVente)` est exercé (`entree.lignes = []` dans toutes
 *  les fixtures ci-dessous, `inserterLigne` n'est donc jamais atteint). */
function txFactice() {
  const returningInsert = vi.fn(async () => [{ id: 'document-nouveau' }]);
  const valuesInsert = vi.fn((_v: unknown) => ({ returning: returningInsert }));
  const insert = vi.fn((_table: unknown) => ({ values: valuesInsert }));
  return { tx: { insert } as unknown as TransactionDfa, insert, valuesInsert, returningInsert };
}

function serviceFactice(tx: TransactionDfa) {
  const idempotence = {
    executer: vi.fn(
      async (
        _ctx: ContexteTenant,
        _requete: unknown,
        travail: (tx: TransactionDfa) => Promise<unknown>,
      ) => ({ reponse: await travail(tx), rejoue: false }),
    ),
  };
  const audit = { pourEntite: vi.fn(async () => []), consigner: vi.fn(async () => undefined) };
  const horloge = { maintenant: () => new Date('2026-08-04T09:00:00.000Z') };
  const service = new ServiceDocumentsVente(
    {} as never, // `acces` (JETON_DB) : jamais exercé, seul `idempotence.executer` l'est.
    idempotence as never,
    audit as never,
    horloge as never,
  );
  // Bypass volontaire de l'assemblage complet (`chargerDocument`/`listerLignesDocument`/audit réels)
  // — hors sujet ici, `mappeurs.spec.ts` le couvre. Seul le CÂBLAGE `creer()` → rattachement dossier
  // est sous test.
  service.assemblerDocument = vi.fn(async () => ({ id: 'document-nouveau' })) as never;
  return { service, idempotence };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(references.chargerClientLigne).mockResolvedValue({
    id: CLIENT_ID,
    type: 'particulier',
    nom: 'Dupont',
    prenom: 'Jean',
    raisonSociale: null,
    ide: null,
    langue: 'fr',
  } as never);
  vi.mocked(references.chargerAdresseFacturationStructuree).mockResolvedValue(null);
  vi.mocked(references.chargerConditionsPaiementEnVigueur).mockResolvedValue({});
});

describe('ServiceDocumentsVente.creer — rattachement à un dossier de vente (RV-37/MD-70)', () => {
  it('rattachement nominal : le dossier est chargé (tenant + état vérifiés) et dossierVenteId est PERSISTÉ sur document_vente', async () => {
    vi.mocked(references.chargerDossierVentePourRattachement).mockResolvedValue({
      id: DOSSIER_ID,
      statut: 'engage',
    });
    const { tx, insert, valuesInsert } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.creer(
      CTX,
      principal(),
      entreeFixture({ dossierVenteId: DOSSIER_ID }),
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(references.chargerDossierVentePourRattachement).toHaveBeenCalledWith(
      tx,
      CTX,
      DOSSIER_ID,
    );
    expect(insert.mock.calls.some((appel) => appel[0] === documentVente)).toBe(true);
    expect(valuesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ dossierVenteId: DOSSIER_ID }) as unknown,
    );
  });

  it('aucun dossierVenteId fourni : chargerDossierVentePourRattachement jamais appelé, dossierVenteId inséré à null', async () => {
    const { tx, valuesInsert } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.creer(CTX, principal(), entreeFixture(), CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(references.chargerDossierVentePourRattachement).not.toHaveBeenCalled();
    expect(valuesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ dossierVenteId: null }) as unknown,
    );
  });

  it("dossier d'un AUTRE TENANT (ou inexistant) : RESSOURCE_INTROUVABLE, AUCUNE écriture document_vente — la validation tenant vit dans chargerDossierVentePourRattachement (WHERE tenant_id), reproduite ici via son refus", async () => {
    vi.mocked(references.chargerDossierVentePourRattachement).mockRejectedValue(
      new (await import('../../common/erreurs/erreur-metier')).ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        `Dossier de vente ${DOSSIER_ID} introuvable.`,
      ),
    );
    const { tx, insert } = txFactice();
    const { service } = serviceFactice(tx);

    await expect(
      service.creer(
        CTX,
        principal(),
        entreeFixture({ dossierVenteId: DOSSIER_ID }),
        CLE_IDEMPOTENCE,
      ),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });

    expect(insert).not.toHaveBeenCalled();
  });

  it.each(['clos', 'annule', 'abandonne'] as const)(
    'dossier dans un état FERMÉ (%s) : DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE, AUCUNE écriture document_vente',
    async (statutFerme) => {
      vi.mocked(references.chargerDossierVentePourRattachement).mockRejectedValue(
        new (await import('../../common/erreurs/erreur-metier')).ErreurMetier(
          'DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE',
          `Le dossier de vente ${DOSSIER_ID} est "${statutFerme}" : il n'accepte plus de nouveau document rattaché (RV-37).`,
        ),
      );
      const { tx, insert } = txFactice();
      const { service } = serviceFactice(tx);

      await expect(
        service.creer(
          CTX,
          principal(),
          entreeFixture({ dossierVenteId: DOSSIER_ID, typeDocument: 'facture' }),
          CLE_IDEMPOTENCE,
        ),
      ).rejects.toMatchObject({ code: 'DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE', status: 409 });

      expect(insert).not.toHaveBeenCalled();
    },
  );
});
