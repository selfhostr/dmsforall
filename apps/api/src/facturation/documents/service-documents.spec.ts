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
  chargerPrixVehiculeDuDossier: vi.fn(),
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
    // Une ligne explicite : le report du prix véhicule (lignes vides) est couvert plus bas et en
    // intégration ; `inserterLigne` (SQL) est neutralisé, la fausse transaction ne le supporte pas.
    vi.spyOn(
      service as unknown as { inserterLigne: () => Promise<unknown> },
      'inserterLigne',
    ).mockResolvedValue({});

    const resultat = await service.creer(
      CTX,
      principal(),
      entreeFixture({ dossierVenteId: DOSSIER_ID, lignes: [{ type: 'forfait' } as never] }),
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

  it('dossier sans prix (lignes vides) : 422 DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS, aucune écriture', async () => {
    vi.mocked(references.chargerDossierVentePourRattachement).mockResolvedValue({
      id: DOSSIER_ID,
      statut: 'engage',
    });
    vi.mocked(references.chargerPrixVehiculeDuDossier).mockRejectedValue(
      new (await import('../../common/erreurs/erreur-metier')).ErreurMetier(
        'DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS',
        'Prix requis.',
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
    ).rejects.toMatchObject({ code: 'DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS', status: 422 });
    expect(insert).not.toHaveBeenCalled();
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

  /**
   * Défaut confirmé par preuve d'exécution : `ordreReparationId` était accepté par la validation
   * zod mais jamais traduit en SQL — la fiche d'un OR affichait les cinq derniers documents du
   * TENANT ENTIER, un OR réel et un `ordreReparationId` inexistant rendant rigoureusement la même
   * liste. Le test décisif est le second ci-dessous : un id inexistant doit se traduire par une
   * condition `= $<id inexistant>` dans la requête — la MÊME construction que pour un id réel,
   * preuve que le paramètre n'est plus ignoré. Un test qui se contenterait de vérifier « le filtre
   * n'écrase pas les autres » n'aurait pas suffi : il aurait pu passer même sans la condition SQL.
   */
  describe('ordreReparationId — câblé (correctif)', () => {
    const OR_ID = '22222222-2222-4222-8222-222222222222';
    const OR_INEXISTANT_ID = '00000000-0000-0000-0000-000000000000';

    it('ordreReparationId fourni : la requête pose `ordre_reparation_id = $<valeur exacte>`', async () => {
      const { sql, params } = await executerListerEtCapturer({ ordreReparationId: OR_ID });

      expect(sql).toContain('"document_vente"."ordre_reparation_id" = $');
      expect(params).toContain(OR_ID);
    });

    it("ordreReparationId inexistant : la MÊME condition SQL est posée, avec CE paramètre précis — ce test aurait rougi sur le défaut d'origine (paramètre accepté, jamais câblé)", async () => {
      const { sql, params } = await executerListerEtCapturer({
        ordreReparationId: OR_INEXISTANT_ID,
      });

      expect(sql).toContain('"document_vente"."ordre_reparation_id" = $');
      expect(params).toContain(OR_INEXISTANT_ID);
      // Un id réel et un id inexistant ne doivent JAMAIS produire la même absence de condition —
      // preuve que le paramètre est bien celui transmis, pas ignoré au profit d'un scope plus large.
      expect(params).not.toContain(OR_ID);
    });

    it('ordreReparationId absent : aucune condition sur la colonne — le filtre reste inerte par défaut', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('ordre_reparation_id');
    });

    it('ordreReparationId composé par ET avec le scope tenant (jamais en OR, jamais substitué à lui)', async () => {
      const { sql } = await executerListerEtCapturer({ ordreReparationId: OR_ID });

      expect(sql).toMatch(/"tenant_id" = \$1 and "document_vente"\."ordre_reparation_id" = \$2/);
    });
  });

  describe('statutReglement — câblé', () => {
    it("statutReglement=['regle'] : `inArray` sur la colonne réelle `statut_reglement`", async () => {
      const { sql, params } = await executerListerEtCapturer({
        statutReglement: ['regle'],
      });

      expect(sql).toContain('"document_vente"."statut_reglement" in (');
      expect(params).toContain('regle');
    });

    it("statutReglement=['partiel'] (valeur légitime, distincte de la précédente) : la condition change avec la valeur — preuve qu’elle n’est pas ignorée", async () => {
      // Même rôle décisif qu'un UUID inexistant pour ordreReparationId : la condition doit
      // apparaître dans le SQL, portant PRÉCISÉMENT la valeur transmise — pas une autre.
      const { sql, params } = await executerListerEtCapturer({
        statutReglement: ['partiel'],
      });

      expect(sql).toContain('"document_vente"."statut_reglement" in (');
      expect(params).toContain('partiel');
      expect(params).not.toContain('regle');
    });

    it('statutReglement absent : aucune condition sur la colonne', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('statut_reglement');
    });
  });

  /**
   * `statut` protège désormais un chemin argent précis (correctif 2026-08-10, voir
   * `paiements/imputations.ts::verifierDocumentImputable`) : c'est ce filtre, câblé côté
   * `useFacturesOuvertesClient` (front), qui évite de PROPOSER une facture `annule_par_avoir` au
   * panneau d'encaissement — la barrière applicative dans `imputations.ts` REFUSE le geste s'il est
   * malgré tout tenté (un `curl` direct, un connecteur tiers), mais ce filtre-ci est ce qui évite de
   * l'offrir en premier lieu. Câblage RÉ-VÉRIFIÉ en exécution contre l'API réelle (pas seulement par
   * lecture) : `statut=emis` → 2 lignes, `statut=annule_par_avoir` → 1, `statut=refuse` → liste
   * vide, sur le même client — trois valeurs, trois résultats distincts. Ce bloc-ci comble
   * uniquement l'absence de garde-fou AUTOMATISÉ (même rôle que `statutReglement`/
   * `ordreReparationId` juste au-dessus, aucun des deux n'avait de test avant leur découverte) :
   * sans lui, une régression future sur CE filtre ne rougirait NULLE PART — ni les tests front (qui
   * simulent la couche réseau, jamais le serveur), ni le reste de cette suite.
   *
   * RÉSERVE HONNÊTE (même que les blocs voisins de cette describe) : ceci capture le SQL
   * RÉELLEMENT CONSTRUIT par le query-builder Drizzle (`toSQL()`), PAS un `tx.execute` simulé — la
   * même technique qui a fait rougir `ordreReparationId` sur le défaut d'origine. Ça prouve que la
   * VALEUR du filtre atteint la clause `where`, avec le bon paramètre. Ça NE prouve PAS le
   * comportement contre une vraie base (RLS, `inArray` réellement exécuté, page de résultats) — la
   * preuve d'exécution réelle mentionnée ci-dessus (2/1/0 lignes sur l'API en marche) est CE qui
   * couvre ce dernier mètre, pas ce bloc.
   */
  describe('statut — câblé', () => {
    it("statut=['emis'] : `inArray` sur la colonne réelle `statut`, composé par ET avec le scope tenant", async () => {
      const { sql, params } = await executerListerEtCapturer({ statut: ['emis'] });

      expect(sql).toContain('"document_vente"."statut" in (');
      expect(params).toContain('emis');
      expect(sql).toMatch(/"tenant_id" = \$1 and "document_vente"."statut" in \(/);
    });

    it("statut=['annule_par_avoir'] (valeur distincte, précisément celle du défaut prouvé par la tâche) : la condition change avec la valeur — preuve qu'elle n'est pas ignorée", async () => {
      const { sql, params } = await executerListerEtCapturer({ statut: ['annule_par_avoir'] });

      expect(sql).toContain('"document_vente"."statut" in (');
      expect(params).toContain('annule_par_avoir');
      expect(params).not.toContain('emis');
    });

    it('statut à plusieurs valeurs : toutes portées par le même `inArray`, aucune perdue', async () => {
      const { sql, params } = await executerListerEtCapturer({
        statut: ['emis', 'annule_par_avoir'],
      });

      expect(sql).toContain('"document_vente"."statut" in (');
      expect(params).toContain('emis');
      expect(params).toContain('annule_par_avoir');
    });

    it('statut absent : aucune condition sur la colonne — le filtre reste inerte par défaut', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('"document_vente"."statut" in (');
    });
  });

  describe('natureFacture — câblé, composé avec typeDocument = facture (MD-12)', () => {
    it("natureFacture='acompte' : pose l'égalité sur `nature_facture` ET `type_document = 'facture'` — la colonne vaut 'ordinaire' par défaut même hors facture, sans cette seconde condition le filtre remonterait aussi des devis/bons de commande", async () => {
      const { sql, params } = await executerListerEtCapturer({ natureFacture: 'acompte' });

      expect(sql).toContain('"document_vente"."nature_facture" = $');
      expect(sql).toContain('"document_vente"."type_document" = $');
      expect(params).toContain('acompte');
      expect(params).toContain('facture');
    });

    it('natureFacture absent : aucune condition sur `nature_facture` ni de `type_document` imposé par ce filtre', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('nature_facture');
    });
  });

  describe('dateDocumentDu / dateDocumentAu — câblés, bornes incluses', () => {
    it('dateDocumentDu seul : `date_document >= $<borne>`', async () => {
      const { sql, params } = await executerListerEtCapturer({ dateDocumentDu: '2026-01-01' });

      expect(sql).toContain('"document_vente"."date_document" >= $');
      expect(params).toContain('2026-01-01');
    });

    it('dateDocumentAu seul : `date_document <= $<borne>`', async () => {
      const { sql, params } = await executerListerEtCapturer({ dateDocumentAu: '2026-12-31' });

      expect(sql).toContain('"document_vente"."date_document" <= $');
      expect(params).toContain('2026-12-31');
    });

    it('les deux bornes composées par ET, sans écraser l’une l’autre', async () => {
      const { sql, params } = await executerListerEtCapturer({
        dateDocumentDu: '2026-01-01',
        dateDocumentAu: '2026-12-31',
      });

      expect(sql).toContain('"document_vente"."date_document" >= $');
      expect(sql).toContain('"document_vente"."date_document" <= $');
      expect(params).toContain('2026-01-01');
      expect(params).toContain('2026-12-31');
    });

    it('bornes absentes : aucune condition sur `date_document` posée par ce filtre (la colonne reste sinon utilisée par le tri)', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('date_document');
    });
  });

  describe('q — câblé via `public.normaliser_recherche()` (même idiome que `recherche/`)', () => {
    it('q fourni : condition normalisée sur `numero` OU `client_designation_figee`, motif enveloppé en fragment (`%...%`)', async () => {
      const { sql, params } = await executerListerEtCapturer({ q: 'Dupont' });

      expect(sql).toContain('normaliser_recherche(coalesce("document_vente"."numero"');
      expect(sql).toContain('normaliser_recherche("document_vente"."client_designation_figee")');
      expect(sql).toMatch(/like public\.normaliser_recherche/);
      expect(params).toContain('%Dupont%');
    });

    it('q absent : aucune condition sur numero/client_designation_figee posée par ce filtre', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('normaliser_recherche');
    });
  });
});
