import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { TRI_DEFAUT_DOCUMENTS_VENTE } from '@dfa/shared';
import type { EntreeCreationDocumentVente, FiltresDocumentsVente } from '@dfa/shared';

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
  // `ServiceMouvement` (RP-43, pont vente comptoir) : jamais exercé ici, `entree.lignes = []` dans
  // toutes les fixtures de ce fichier (`inserterLigne` n'atteint donc jamais la branche
  // `articleId`/`siteId` qui l'appellerait) — voir `service-documents-mouvement.spec.ts` pour le
  // câblage sous test.
  const serviceMouvement = { sortieComptoirPourLigneTx: vi.fn() };
  const service = new ServiceDocumentsVente(
    {} as never, // `acces` (JETON_DB) : jamais exercé, seul `idempotence.executer` l'est.
    idempotence as never,
    audit as never,
    horloge as never,
    serviceMouvement as never,
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

/**
 * Lot E (prérequis navigation) — `GET /documents-vente?enRetard=...&relanceNiveau=...`, jusqu'ici
 * INERTES : `schemaFiltresDocumentsVente` n'exposait ni l'un ni l'autre, et `ServiceDocumentsVente
 * .lister` ne les traduisait donc nulle part en SQL (voir le commentaire de tête retiré de
 * `EcranListeFactures.tsx`). Prouvé SANS Postgres réel, via le `QueryBuilder` driver-less de
 * `drizzle-orm/pg-core` — même doctrine que `atelier/service-or.spec.ts::ServiceOr.lister —
 * filtre technicienId` (§I-19/#19) : on capture la requête RÉELLEMENT construite par `lister()`
 * (jamais une reconstruction indépendante dans le test) puis on laisse l'`await` échouer à
 * l'exécution (aucun pilote branché) — seule la CONSTRUCTION du SQL nous intéresse ici.
 */
describe('ServiceDocumentsVente.lister — filtres enRetard/relanceNiveau (Lot E)', () => {
  /** Même fabrique que `atelier/service-or.spec.ts` (capture la requête outer via `.from`). */
  function txQueryBuilderFactice() {
    const qb = new QueryBuilder();
    const capturedSelects: { toSQL: () => { sql: string; params: unknown[] } }[] = [];
    const tx = {
      select: (...args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = (qb.select as any)(...args);
        const fromOriginal = builder.from.bind(builder);
        builder.from = (...fromArgs: unknown[]) => {
          const requete = fromOriginal(...fromArgs);
          capturedSelects.push(requete);
          return requete;
        };
        return builder;
      },
    };
    return { tx: tx as unknown as TransactionDfa, capturedSelects };
  }

  function requeteOuter(capturedSelects: { toSQL: () => { sql: string; params: unknown[] } }[]) {
    const derniere = capturedSelects.at(-1);
    if (!derniere) throw new Error('Aucune requête capturée — tx.select() jamais appelé.');
    return derniere.toSQL();
  }

  /** Isole la clause `where` du SQL généré : le `select "..."` liste TOUTES les colonnes de
   *  `document_vente` (dont `date_echeance`/`solde_centimes`, qui font partie du document renvoyé
   *  indépendamment de tout filtre) — chercher ces noms de colonnes dans le SQL ENTIER serait donc
   *  toujours vrai, filtre actif ou non. Seule la clause `where` révèle si le filtre retard a
   *  effectivement posé ses conditions. */
  function clauseWhere(sql: string): string {
    const debut = sql.indexOf(' where ');
    if (debut === -1) throw new Error('Aucune clause where dans le SQL capturé.');
    const fin = sql.indexOf(' order by ', debut);
    return fin === -1 ? sql.slice(debut) : sql.slice(debut, fin);
  }

  function accesBaseFactice(tx: TransactionDfa) {
    return {
      enTenant: vi.fn(
        async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
          travail(tx),
      ),
    };
  }

  /** Seuls `acces` (transaction) et `horloge` (source d'« aujourd'hui » pour `enRetard`, jamais
   *  `Date.now()` en dur) sont exercés par `lister()` avant que l'exécution échoue — les 3 autres
   *  dépendances du constructeur (idempotence, audit, mouvement pièces) n'interviennent que dans
   *  `creer()`/`ajouterLigne()`. */
  function serviceListerFactice(
    acces: ReturnType<typeof accesBaseFactice>,
    maintenant: Date,
  ): ServiceDocumentsVente {
    const horloge = { maintenant: () => maintenant };
    return new ServiceDocumentsVente(
      acces as never,
      {} as never,
      {} as never,
      horloge as never,
      {} as never,
    );
  }

  const MAINTENANT = new Date('2026-08-04T09:00:00.000Z');

  async function executerListerEtCapturer(
    filtres: Partial<FiltresDocumentsVente>,
    maintenant: Date = MAINTENANT,
  ) {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceListerFactice(acces, maintenant);

    await expect(
      service.lister(
        CTX,
        principal(),
        { tri: TRI_DEFAUT_DOCUMENTS_VENTE, ...filtres } as FiltresDocumentsVente,
        25,
        undefined,
      ),
    ).rejects.toThrow();

    return requeteOuter(capturedSelects);
  }

  it(
    "enRetard=true : la requête pose statut='emis' ET date_echeance IS NOT NULL ET date_echeance " +
      "< aujourd'hui (horloge injectée) ET solde_centimes > 0 — même règle que " +
      '`calculerRetardDocument` (`echeance.ts`), traduite en SQL, PAS une simple comparaison ' +
      "d'échéance : une facture non émise ou déjà soldée ne doit jamais matcher.",
    async () => {
      const { sql, params } = await executerListerEtCapturer({ enRetard: true });

      expect(sql).toContain('"document_vente"."statut" = $');
      expect(sql).toContain('"document_vente"."date_echeance" is not null');
      expect(sql).toContain('"document_vente"."date_echeance" < $');
      expect(sql).toContain('"document_vente"."solde_centimes" > $');
      expect(params).toContain('emis');
      // Horloge injectée (`MAINTENANT` = 2026-08-04), jamais l'horloge système.
      expect(params).toContain('2026-08-04');
      expect(params.map(String)).toContain('0');
    },
  );

  it(
    "enRetard=true aligné sur le RÉGLAGE d'horloge : une autre date injectée change la borne " +
      "'aujourd'hui' utilisée par le filtre — preuve que la valeur vient de l'horloge, pas d'une " +
      'constante.',
    async () => {
      const { params } = await executerListerEtCapturer(
        { enRetard: true },
        new Date('2026-12-25T23:00:00.000Z'),
      );
      expect(params).toContain('2026-12-25');
    },
  );

  it('enRetard absent : aucune des quatre conditions du filtre retard ne figure dans la requête — le filtre reste inerte par défaut, pas actif « à vide »', async () => {
    const { sql } = await executerListerEtCapturer({});

    expect(clauseWhere(sql)).not.toContain('date_echeance');
    expect(clauseWhere(sql)).not.toContain('solde_centimes');
  });

  it('enRetard=false : traité comme absent (même convention que les autres filtres booléens de cette API, ex. `nonImputeUniquement`) — aucune condition ajoutée', async () => {
    const { sql } = await executerListerEtCapturer({ enRetard: false });

    expect(clauseWhere(sql)).not.toContain('date_echeance');
    expect(clauseWhere(sql)).not.toContain('solde_centimes');
  });

  it('relanceNiveau : égalité stricte sur `document_vente.relance_niveau`, composée par ET avec le scope tenant', async () => {
    const { sql, params } = await executerListerEtCapturer({ relanceNiveau: 2 });

    expect(sql).toContain('"document_vente"."relance_niveau" = $');
    expect(params).toContain(2);
    expect(sql).toMatch(/"tenant_id" = \$1 and "document_vente"."relance_niveau" = \$2/);
  });

  it('relanceNiveau=0 : filtre bien appliqué (0 est une valeur légitime — jamais confondue avec « filtre absent », même doctrine que `delaiPaiementJours=0` de `echeance.ts`)', async () => {
    const { sql, params } = await executerListerEtCapturer({ relanceNiveau: 0 });

    expect(sql).toContain('"document_vente"."relance_niveau" = $');
    expect(params).toContain(0);
  });

  it('enRetard=true ET relanceNiveau composés par ET (jamais l’un n’écrase l’autre), sans jointure ni duplication de ligne', async () => {
    const { sql, params } = await executerListerEtCapturer({ enRetard: true, relanceNiveau: 0 });

    expect(sql).toContain('"document_vente"."statut" = $');
    expect(sql).toContain('"document_vente"."relance_niveau" = $');
    expect(params).toContain('emis');
    expect(params).toContain(0);
    expect(sql).not.toMatch(/\bjoin\b/i);
    expect(sql).not.toMatch(/\bgroup by\b/i);
    expect(sql).not.toMatch(/\bdistinct\b/i);
  });

  it('siteId (déjà câblé) et enRetard (nouvellement câblé) composent par ET sans que le nouveau filtre écrase l’ancien', async () => {
    const { sql, params } = await executerListerEtCapturer({
      siteId: '11111111-1111-4111-8111-111111111111',
      enRetard: true,
    });

    expect(sql).toContain('"document_vente"."site_id" = $');
    expect(sql).toContain('"document_vente"."statut" = $');
    expect(params).toContain('11111111-1111-4111-8111-111111111111');
    expect(params).toContain('emis');
  });
});
