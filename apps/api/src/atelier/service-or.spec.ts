import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { TRI_DEFAUT_ORDRES_REPARATION } from '@dfa/shared';
import type { EntreeModificationOrdreReparation, FiltresOrdresReparation } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneOrdreReparation } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';

/**
 * Garantie de sécurité : `PATCH /ordres-reparation/{orId}` sert TOUS les champs libres de
 * l'en-tête sous le SEUL droit `atelier.or.modifier`, alors que `plafondCentimes` (RM-54 : le
 * montant au-delà duquel l'accord du client est requis) mérite son propre droit
 * `atelier.or.plafond_modifier`. Ce test prouve que `ServiceOr.modifier` vérifie explicitement
 * ce droit UNIQUEMENT quand `plafondCentimes` change RÉELLEMENT — jamais en permanence — et que
 * le refus n'écrit RIEN en base (aucun `tx.update`, aucun assemblage de document).
 *
 * Les rôles testés (`technicien`) n'ont actuellement ni `atelier.or.modifier` ni
 * `atelier.or.plafond_modifier` dans la matrice réelle — ce test exerce volontairement
 * `ServiceOr.modifier` directement pour prouver que le contrôle fin du plafond tient
 * PAR LUI-MÊME, indépendant du garde-fou du contrôleur.
 */
vi.mock('./or-requetes', () => ({
  chargerOrPourEcriture: vi.fn(),
}));

import { encoderCurseurTrie } from '../common/pagination';
import { ServiceOr } from './service-or';
import * as orRequetes from './or-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';
const IF_MATCH = 'W/"3"';

function principal(role: PrincipalAuthentifie['role']): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role,
    langue: 'fr',
  };
}

function orFixture(plafondCentimes: number | null): LigneOrdreReparation {
  return {
    id: OR_ID,
    tenantId: 'tenant-a',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'ouvert',
    clientId: 'client-1',
    vehiculeId: 'vehicule-1',
    clientDesignationFigee: 'Jean Dupont',
    adresseFacturationFigee: {},
    conditionsFigees: {},
    plaqueFigee: 'VD 123456',
    detenteurFigeClientId: null,
    conducteurPresentNom: null,
    kmEntree: 85_000,
    kmSortie: null,
    plafondCentimes,
    plafondAutorisePar: 'Jean Dupont (accord téléphonique)',
    restitutionPromiseLe: null,
    restitutionInitialeLe: null,
    localisation: 'atelier',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: 'user-1',
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: new Date('2026-07-28T07:00:00.000Z'),
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    attenteAccord: false,
    attentePieces: false,
    attenteExterne: false,
    totalValideCentimes: 42_000,
    version: 3,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
  } as LigneOrdreReparation;
}

/** Fausse transaction : seul `update(...).set(...).where(...)` est exercé par `modifier()`. */
function txFactice() {
  const where = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { tx: { update } as unknown as TransactionDfa, update, set, where };
}

function accesBaseFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

/** Seul `acces` (transaction) est exercé par `modifier()` — les 7 autres dépendances du
 *  constructeur (idempotence, événements, audit, compteurs, pointage, snapshot, horloge)
 *  n'interviennent QUE dans `creer()`/`assemblerDocument()`, jamais dans `modifier()` lui-même. */
function serviceFactice(acces: ReturnType<typeof accesBaseFactice>): ServiceOr {
  return new ServiceOr(
    acces as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceOr.modifier — droit dédié au plafond (audit sécurité, point de vigilance n°1)', () => {
  it("un rôle SANS atelier.or.plafond_modifier qui tente de RELEVER le plafond est refusé 403 DROIT_INSUFFISANT — le plafond n'est PAS écrit en base", async () => {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture(80_000));
    const { tx, update } = txFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);
    const espionAssemblage = vi.spyOn(service, 'assemblerDocument');

    const entree: EntreeModificationOrdreReparation = { plafondCentimes: 150_000 };

    await expect(
      service.modifier(CTX, principal('technicien'), OR_ID, IF_MATCH, entree),
    ).rejects.toMatchObject({
      code: 'DROIT_INSUFFISANT',
    });

    // Refus = AUCUNE écriture, ni sur `ordre_reparation`, ni de document réassemblé — un refus qui
    // écrirait quand même serait le pire des deux mondes.
    expect(update).not.toHaveBeenCalled();
    expect(espionAssemblage).not.toHaveBeenCalled();
  });

  it('un rôle AVEC atelier.or.plafond_modifier (réceptionnaire) peut relever le plafond — la valeur est bien écrite', async () => {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture(80_000));
    const { tx, update, set } = txFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);
    vi.spyOn(service, 'assemblerDocument').mockResolvedValue({} as never);

    const entree: EntreeModificationOrdreReparation = { plafondCentimes: 150_000 };
    const resultat = await service.modifier(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      IF_MATCH,
      entree,
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ plafondCentimes: 150_000 }));
    expect(resultat.donnees).toBeDefined();
  });

  it('un rôle SANS atelier.or.plafond_modifier peut modifier un champ ORDINAIRE (localisation) — le droit fort ne bloque QUE le plafond', async () => {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture(80_000));
    const { tx, update, set } = txFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);
    vi.spyOn(service, 'assemblerDocument').mockResolvedValue({} as never);

    const entree: EntreeModificationOrdreReparation = { localisation: 'lavage' };
    await service.modifier(CTX, principal('technicien'), OR_ID, IF_MATCH, entree);

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ localisation: 'lavage' }));
  });

  it("renvoyer la MÊME valeur de plafond déjà en place n'est pas une modification — aucun contrôle déclenché, même sans le droit", async () => {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture(80_000));
    const { tx, update, set } = txFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);
    vi.spyOn(service, 'assemblerDocument').mockResolvedValue({} as never);

    const entree: EntreeModificationOrdreReparation = { plafondCentimes: 80_000 };
    await service.modifier(CTX, principal('technicien'), OR_ID, IF_MATCH, entree);

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ plafondCentimes: 80_000 }));
  });

  it('un rôle SANS atelier.or.plafond_modifier qui tente de BAISSER le plafond est refusé aussi — toute modification effective compte, pas seulement une hausse', async () => {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture(80_000));
    const { tx, update } = txFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    const entree: EntreeModificationOrdreReparation = { plafondCentimes: 20_000 };

    await expect(
      service.modifier(CTX, principal('technicien'), OR_ID, IF_MATCH, entree),
    ).rejects.toMatchObject({
      code: 'DROIT_INSUFFISANT',
    });
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * #19 — `GET /ordres-reparation?technicienId=...` était IGNORÉ (voir l'ancien commentaire de tête
 * de `ServiceOr.lister`, retiré). Ces tests prouvent que le filtre est câblé EN `exists(...)`
 * (corrélé sur `tenant_id` + `ordre_reparation_id`), jamais en jointure — la distinction est ce
 * qui garantit qu'un OR à plusieurs lignes assignées au même technicien n'est ni dupliqué (une
 * jointure produirait une ligne de résultat PAR ligne assignée) ni perdu par la pagination par
 * curseur d'offset (`decalage`/`limite` comptent des OR, pas des lignes).
 *
 * Prouvé SANS Postgres réel, via `drizzle-orm/pg-core`'s `QueryBuilder` — un query-builder SANS
 * pilote/connexion, qui construit un SQL RÉEL (inspectable par `.toSQL()`) et ne lève qu'À
 * L'EXÉCUTION (`await`), jamais à la construction. On capture donc la requête bâtie par
 * `ServiceOr.lister()` lui-même (pas une reconstruction indépendante dans le test, qui pourrait
 * dériver du code réel sans jamais faire échouer ce test) puis on laisse l'`await` échouer — la
 * même distinction que `txFactice()` ci-dessus (mock de `.update`), appliquée à `.select`.
 */
describe('ServiceOr.lister — filtre technicienId (I-19/#19)', () => {
  /**
   * Query-builder RÉEL de drizzle-orm, sans pilote — voir le commentaire de tête ci-dessus.
   *
   * `builder.select(...)` ne rend PAS un objet doté de `.toSQL()` : c'est SEULEMENT après
   * `.from(...)` (vérifié en conditions réelles, `PgSelectBuilder.from` renvoie un `PgSelect`
   * DISTINCT, pas `this`) que la requête devient inspectable — `.where()`/`.orderBy()`/`.limit()`/
   * `.offset()`, eux, mutent CET objet en place. On intercepte donc `.from` pour capturer la
   * requête réellement exploitable, pas le builder intermédiaire qui la précède.
   */
  function txQueryBuilderFactice() {
    const qb = new QueryBuilder();
    const capturedSelects: { toSQL: () => { sql: string; params: unknown[] } }[] = [];
    const tx = {
      select: (...args: unknown[]) => {
        // Passthrough variadique vers le vrai query-builder pg-core, dont les deux surcharges
        // (`select()`/`select(fields)`) ne s'expriment pas proprement en un seul type d'appel
        // spread.
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

  /** La requête OUTER est TOUJOURS la dernière capturée : la sous-requête `exists(...)`, quand
   *  elle existe, est construite AVANT (dans la condition poussée dans `conditions`), pendant que
   *  `ServiceOr.lister` assemble encore le tableau `conditions` — avant d'appeler `tx.select()`
   *  pour la requête principale. */
  function requeteOuter(capturedSelects: { toSQL: () => { sql: string; params: unknown[] } }[]) {
    const derniere = capturedSelects.at(-1);
    if (!derniere) throw new Error('Aucune requête capturée — tx.select() jamais appelé.');
    return derniere.toSQL();
  }

  /** `tri` : requis par le type `FiltresOrdresReparation` (défaut posé par le schéma zod côté
   *  contrôleur), mais `ServiceOr.lister` l'ignore totalement (tri figé `ouvertLe:desc`, voir sa
   *  doc de tête) — sans intérêt pour ces tests, fixé une fois ici plutôt que répété partout. */
  async function executerListerEtCapturer(
    filtres: Omit<FiltresOrdresReparation, 'tri'>,
    curseur?: string,
  ) {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    // Le query-builder driver-less rejette TOUJOURS à l'exécution (aucune Postgres réelle) — seule
    // la CONSTRUCTION de la requête (déjà terminée avant cet `await`) nous intéresse ici.
    await expect(
      service.lister(
        CTX,
        principal('technicien'),
        { ...filtres, tri: TRI_DEFAUT_ORDRES_REPARATION },
        25,
        curseur,
      ),
    ).rejects.toThrow();

    return requeteOuter(capturedSelects);
  }

  it('technicienId fourni : la requête pose un exists(...) corrélé sur ligne_or (tenant_id ET ordre_reparation_id), filtré sur technicien_id = la valeur demandée — jamais une jointure', async () => {
    const { sql, params } = await executerListerEtCapturer({ technicienId: 'tech-1' });

    expect(sql).toContain('exists (select "id" from "ligne_or"');
    // Corrélation par COLONNES (pas de paramètre) : la même ligne_or.tenant_id que l'OR englobant,
    // et son ordre_reparation_id pointant sur CET OR précisément.
    expect(sql).toContain('"ligne_or"."tenant_id" = "ordre_reparation"."tenant_id"');
    expect(sql).toContain('"ligne_or"."ordre_reparation_id" = "ordre_reparation"."id"');
    expect(sql).toContain('"ligne_or"."technicien_id" = $');
    expect(params).toContain('tech-1');

    // AUCUNE jointure : une seule table dans le FROM de la requête outer, ligne_or n'apparaît QUE
    // dans le exists(...) — c'est ce qui interdit la duplication d'un OR par ligne assignée.
    expect(sql).toMatch(/from "ordre_reparation"/);
    expect(sql).not.toMatch(/\bjoin\b/i);
  });

  it("technicienId absent : ligne_or n'apparaît NULLE PART dans la requête — le filtre reste inerte par défaut, pas actif « à vide »", async () => {
    const { sql } = await executerListerEtCapturer({});

    expect(sql).not.toContain('ligne_or');
    expect(sql).not.toMatch(/\bexists\b/i);
  });

  it("aucun OR n'est perdu ni dupliqué par la pagination : la requête outer reste une SELECT simple sur ordre_reparation (pas de GROUP BY, pas de DISTINCT rendus nécessaires par le filtre), avec limit intact et reprise keyset (jamais d'offset) — le exists(...) ne change ni la forme ni le compte de lignes retournées par OR", async () => {
    const { sql, params } = await executerListerEtCapturer(
      { technicienId: 'tech-1', siteId: 'site-1' },
      // Curseur keyset réel (tri par défaut `ouvertLe:desc`) : la reprise est une comparaison ROW
      // sur `(ouvert_le, id)`, JAMAIS un `offset`.
      encoderCurseurTrie({
        tri: TRI_DEFAUT_ORDRES_REPARATION,
        valeur: '2026-03-01T08:00:00.100000+00:00',
        id: '0e2424ea-8c3c-4653-9d13-54265a03a033',
      }),
    );

    expect(sql).not.toMatch(/\bgroup by\b/i);
    expect(sql).not.toMatch(/\bdistinct\b/i);
    expect(sql).toMatch(/\blimit \$\d+/i);
    expect(sql).not.toMatch(/\boffset\b/i);
    expect(sql).toMatch(/\("ordre_reparation"\."ouvert_le", "ordre_reparation"\."id"\) < \(/);
    // Le filtre siteId (déjà câblé) et technicienId (nouvellement câblé) COMPOSENT par ET, sans
    // que l'un écrase l'autre.
    expect(sql).toContain('"ordre_reparation"."site_id" = $');
    expect(params).toContain('site-1');
    expect(params).toContain('tech-1');
  });
});

/**
 * #73 — `restitutionPromiseDu`/`Au` (constat terrain du 12.08.2026, carte « Sorties du jour ») ET
 * `ouvertDu`/`Au`, `localisation`, `attente` étaient acceptés par `schemaFiltresOrdresReparation`
 * mais AUCUN des quatre ne posait de condition SQL — `ServiceOr.lister` le signalait lui-même en
 * commentaire (« SIMPLIFICATION SIGNALÉE »— piège documenté CONTRIBUTING.md : « filtre accepté par le
 * contrat ≠ filtre appliqué au SQL »). Même doctrine et même patron que le bloc `technicienId`
 * ci-dessus : `QueryBuilder` driver-less de `drizzle-orm/pg-core`, requête RÉELLEMENT construite
 * par le service (jamais reconstruite indépendamment), le test décisif étant qu'une valeur
 * FOURNIE pose la condition SQL et qu'une valeur ABSENTE n'en pose AUCUNE — jamais la même absence
 * de condition dans les deux cas.
 */
describe('ServiceOr.lister — bornes de date restitutionPromiseDu/Au, ouvertDu/Au, localisation, attente (#73)', () => {
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

  /** Isole la clause `where` : le `select` liste TOUTES les colonnes d'`ordre_reparation` (dont
   *  `restitution_promise_le`, `ouvert_le`, `localisation`, `attente_accord`… qui font partie du
   *  document indépendamment de tout filtre) — chercher ces noms dans le SQL ENTIER serait donc
   *  toujours vrai. Seule la clause `where` révèle si un filtre a effectivement posé sa condition
   *  (même piège, même correctif que `service-rendez-vous.spec.ts::clauseWhere`). */
  function clauseWhere(sql: string): string {
    const debut = sql.indexOf(' where ');
    if (debut === -1) return '';
    const fin = sql.indexOf(' order by ', debut);
    return fin === -1 ? sql.slice(debut) : sql.slice(debut, fin);
  }

  async function executerListerEtCapturer(filtres: Omit<FiltresOrdresReparation, 'tri'>) {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    await expect(
      service.lister(
        CTX,
        principal('technicien'),
        { ...filtres, tri: TRI_DEFAUT_ORDRES_REPARATION },
        25,
        undefined,
      ),
    ).rejects.toThrow();

    return requeteOuter(capturedSelects);
  }

  describe('restitutionPromiseDu / restitutionPromiseAu', () => {
    it('restitutionPromiseDu fourni : pose `restitution_promise_le >= $<début de journée suisse>`', async () => {
      const { sql, params } = await executerListerEtCapturer({
        restitutionPromiseDu: '2026-08-12',
      });

      expect(clauseWhere(sql)).toContain('"ordre_reparation"."restitution_promise_le" >= $');
      // Params sérialisés en ISO string par drizzle (pas une instance `Date`) — vérifié en
      // conditions réelles via `drizzle-orm/pg-core`.
      // Le 12.08.2026 en été (CEST, UTC+2) : début = 2026-08-11T22:00:00.000Z
      expect(params).toContain('2026-08-11T22:00:00.000Z');
    });

    it('restitutionPromiseAu fourni : pose `restitution_promise_le <= $<fin de journée suisse>` — bornes INCLUSES', async () => {
      const { sql, params } = await executerListerEtCapturer({
        restitutionPromiseAu: '2026-08-12',
      });

      expect(clauseWhere(sql)).toContain('"ordre_reparation"."restitution_promise_le" <= $');
      // Le 12.08.2026 en été (CEST, UTC+2) : fin = 2026-08-12T21:59:59.999Z
      expect(params).toContain('2026-08-12T21:59:59.999Z');
    });

    it('les deux bornes fournies avec des dates DIFFÉRENTES : les deux conditions coexistent, chacune avec SA valeur propre — jamais la même date recopiée sur les deux', async () => {
      const { sql, params } = await executerListerEtCapturer({
        restitutionPromiseDu: '2026-08-10',
        restitutionPromiseAu: '2026-08-12',
      });

      expect(clauseWhere(sql)).toContain('"ordre_reparation"."restitution_promise_le" >= $');
      expect(clauseWhere(sql)).toContain('"ordre_reparation"."restitution_promise_le" <= $');
      // Le 10.08.2026 en été : début = 2026-08-09T22:00:00.000Z
      // Le 12.08.2026 en été : fin = 2026-08-12T21:59:59.999Z
      expect(params).toContain('2026-08-09T22:00:00.000Z');
      expect(params).toContain('2026-08-12T21:59:59.999Z');
    });

    it('absentes : AUCUNE condition sur restitution_promise_le dans la clause where — le filtre reste inerte par défaut (et un OR sans date promise reste visible, troisième état non exclu)', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('restitution_promise_le');
    });
  });

  describe('ouvertDu / ouvertAu', () => {
    it('ouvertDu fourni : pose `ouvert_le >= $<début de journée suisse>`', async () => {
      const { sql, params } = await executerListerEtCapturer({ ouvertDu: '2026-07-01' });

      expect(clauseWhere(sql)).toContain('"ordre_reparation"."ouvert_le" >= $');
      // Le 01.07.2026 en été (CEST, UTC+2) : début = 2026-06-30T22:00:00.000Z
      expect(params).toContain('2026-06-30T22:00:00.000Z');
    });

    it('ouvertAu fourni : pose `ouvert_le <= $<fin de journée suisse>`', async () => {
      const { sql, params } = await executerListerEtCapturer({ ouvertAu: '2026-07-31' });

      expect(clauseWhere(sql)).toContain('"ordre_reparation"."ouvert_le" <= $');
      // Le 31.07.2026 en été (CEST, UTC+2) : fin = 2026-07-31T21:59:59.999Z
      expect(params).toContain('2026-07-31T21:59:59.999Z');
    });

    it("absentes : aucune comparaison `>=`/`<=` sur ouvert_le dans la clause where — seul l'`order by ... ouvert_le desc` mentionne la colonne", async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toMatch(/"ordre_reparation"\."ouvert_le" (>=|<=) \$/);
    });
  });

  describe('localisation (multi)', () => {
    it("localisation=['atelier'] : pose `localisation in ($<atelier>)`", async () => {
      const { sql, params } = await executerListerEtCapturer({ localisation: ['atelier'] });

      expect(sql).toContain('"ordre_reparation"."localisation" in ($');
      expect(params).toContain('atelier');
    });

    it("localisation=['lavage'] (valeur DISTINCTE) : le paramètre change avec la valeur demandée — preuve que ce n'est pas un filtre figé", async () => {
      const { sql, params } = await executerListerEtCapturer({ localisation: ['lavage'] });

      expect(sql).toContain('"ordre_reparation"."localisation" in ($');
      expect(params).toContain('lavage');
      expect(params).not.toContain('atelier');
    });

    it('plusieurs valeurs : toutes présentes dans la clause `in`', async () => {
      const { params } = await executerListerEtCapturer({
        localisation: ['atelier', 'pret_au_retrait'],
      });

      expect(params).toContain('atelier');
      expect(params).toContain('pret_au_retrait');
    });

    it('absente : aucune condition sur localisation', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(sql).not.toContain('"ordre_reparation"."localisation" in');
    });
  });

  describe('attente (multi, OU logique entre les drapeaux)', () => {
    it("attente=['accord'] : pose `attente_accord = true`, RIEN sur pieces/externe", async () => {
      const { sql } = await executerListerEtCapturer({ attente: ['accord'] });

      expect(sql).toContain('"ordre_reparation"."attente_accord" = $');
      expect(sql).not.toContain('"ordre_reparation"."attente_pieces" = $');
      expect(sql).not.toContain('"ordre_reparation"."attente_externe" = $');
    });

    it("attente=['pieces'] (valeur DISTINCTE) : pose `attente_pieces = true` — preuve que le drapeau suit la valeur demandée", async () => {
      const { sql } = await executerListerEtCapturer({ attente: ['pieces'] });

      expect(sql).toContain('"ordre_reparation"."attente_pieces" = $');
      expect(sql).not.toContain('"ordre_reparation"."attente_accord" = $');
    });

    it("attente=['accord','pieces'] : les DEUX drapeaux composent par OU (au moins un vrai), jamais par ET", async () => {
      const { sql } = await executerListerEtCapturer({ attente: ['accord', 'pieces'] });

      expect(sql).toContain('"ordre_reparation"."attente_accord" = $');
      expect(sql).toContain('"ordre_reparation"."attente_pieces" = $');
      expect(sql).toMatch(/\bor\b/i);
    });

    it('absente : aucune condition sur les colonnes attente_* dans la clause where', async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(clauseWhere(sql)).not.toContain('attente_accord');
      expect(clauseWhere(sql)).not.toContain('attente_pieces');
      expect(clauseWhere(sql)).not.toContain('attente_externe');
    });
  });

  describe('composition — jamais un filtre qui en écrase un autre', () => {
    it('siteId + restitutionPromiseDu/Au + localisation + attente composent tous par ET', async () => {
      const { sql, params } = await executerListerEtCapturer({
        siteId: 'site-1',
        restitutionPromiseDu: '2026-08-12',
        restitutionPromiseAu: '2026-08-12',
        localisation: ['pret_au_retrait'],
        attente: ['accord'],
      });

      expect(sql).toContain('"ordre_reparation"."site_id" = $');
      expect(sql).toContain('"ordre_reparation"."restitution_promise_le" >= $');
      expect(sql).toContain('"ordre_reparation"."restitution_promise_le" <= $');
      expect(sql).toContain('"ordre_reparation"."localisation" in ($');
      expect(sql).toContain('"ordre_reparation"."attente_accord" = $');
      expect(params).toContain('site-1');
      expect(params).toContain('pret_au_retrait');
      // La clause where entière compose par ET — un seul `or` isolé (celui d'`attente`, group par
      // parenthèses) ne fait pas de la clause globale une disjonction.
      expect(sql).toMatch(/^select .* from "ordre_reparation" where \(/);
    });
  });

  describe("bascules d'heure d'ete — les filtres de date utilisent fuseau-suisse, jamais UTC pur", () => {
    it('bascule de printemps — 29.03.2026 (CET +1h -> CEST +2h) : une journee ne dure que 23h, debut = 2026-03-28T23:00:00.000Z', async () => {
      const { sql, params } = await executerListerEtCapturer({
        restitutionPromiseDu: '2026-03-29',
      });

      expect(clauseWhere(sql)).toContain('"ordre_reparation"."restitution_promise_le" >= $');
      expect(params).toContain('2026-03-28T23:00:00.000Z');
    });

    it("bascule d'automne — 25.10.2026 (CEST +2h -> CET +1h) : une journee dure 25h, fin = 2026-10-25T22:59:59.999Z", async () => {
      const { sql, params } = await executerListerEtCapturer({
        restitutionPromiseAu: '2026-10-25',
      });

      expect(clauseWhere(sql)).toContain('"ordre_reparation"."restitution_promise_le" <= $');
      expect(params).toContain('2026-10-25T22:59:59.999Z');
    });

    it('cas decisif du bug mesure le 14.08.2026 — 00h30 heure suisse (15.07.2026 en ete) doit etre rattache au bon jour civil (15), pas a la veille (14)', async () => {
      // 00h30 locale (CEST, +2h) le 15.07.2026 == 2026-07-14T22:30:00.000Z en UTC.
      // Le filtre restitutionPromiseDu: 2026-07-15 doit inclure cet instant.
      const { params } = await executerListerEtCapturer({
        restitutionPromiseDu: '2026-07-15',
      });

      // Debut de journee suisse du 15.07.2026 (ete, CEST +2h) = 2026-07-14T22:00:00.000Z
      expect(params).toContain('2026-07-14T22:00:00.000Z');
      // L\'instant 22:30 UTC depasse ce seuil, il est donc inclus — le bug aurait utilise
      // 2026-07-15T00:00:00.000Z (UTC pur), excluant a tort cet instant.
    });
  });
});

/**
 * `q` (constat terrain du 14.08.2026) : AUCUNE recherche d'OR ne rendait jamais de résultat —
 * `q` était accepté par `schemaFiltresOrdresReparation` et documenté DANS CE FICHIER MÊME comme
 * « jamais appliqué ICI », le piège exact décrit par CONTRIBUTING.md (« filtre accepté par le contrat ≠
 * appliqué au SQL »). Même patron `QueryBuilder` driver-less que les blocs `technicienId`/`#73`/
 * `tri` ci-dessus — la requête est RÉELLEMENT construite par `ServiceOr.lister()`, jamais
 * reconstruite indépendamment.
 *
 * LIMITE ASSUMÉE de cette suite, signalée plutôt que masquée : `QueryBuilder` driver-less ne
 * PARLE JAMAIS à un vrai Postgres, donc rien ici ne peut prouver que `normaliser_recherche()`
 * gomme réellement accents/casse/séparateurs (ex. « 445566 » trouvant « VS 445566 ») — cette
 * garantie est déjà prouvée par les assertions `DO $$…$$` de la migration 0003 elle-même
 * (`echantillon := public.normaliser_recherche('VD 123''456')`, etc.) et exercée en production
 * par les TROIS autres appelants de cette même fonction (`clients/service-client.ts::lister`,
 * `recherche/service-recherche.ts`). ÉCRIRE UNE SECONDE FOIS cette normalisation en TypeScript
 * pour la « prouver » ici la ferait diverger de la vraie fonction — exactement l'erreur que la
 * doctrine du projet interdit. ce que CETTE suite prouve, à la place, et qui est bien LE test qui
 * distingue un filtre appliqué d'un filtre ignoré (le défaut réel constaté) : que le paramètre
 * `q` atteint RÉELLEMENT les trois branches de la clause WHERE émise, avec le motif fragmenté
 * (`%q%`) et enveloppé dans `public.normaliser_recherche()`, sans transformation JS parallèle — et
 * qu'en son absence, RIEN de tout cela n'apparaît (le filtre ignoré redeviendrait « toute la
 * liste », le symptôme exact rapporté par le testeur).
 */
describe('ServiceOr.lister — recherche q (numéro OR / plaque courante / nom client, #defaut-recherche-or)', () => {
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

  /** La requête OUTER reste la DERNIÈRE capturée : les deux sous-requêtes `in (select …)` (plaque
   *  puis client) sont construites AVANT `tx.select()` de la requête principale, exactement le
   *  même ordre que le `exists(...)` de `technicienId` plus haut — même garantie, même preuve. */
  function requeteOuter(capturedSelects: { toSQL: () => { sql: string; params: unknown[] } }[]) {
    const derniere = capturedSelects.at(-1);
    if (!derniere) throw new Error('Aucune requête capturée — tx.select() jamais appelé.');
    return derniere.toSQL();
  }

  /** Isole la clause `where` — même piège/correctif que `clauseWhere` du bloc `#73` ci-dessus. */
  function clauseWhere(sqlTexte: string): string {
    const debut = sqlTexte.indexOf(' where ');
    if (debut === -1) return '';
    const fin = sqlTexte.indexOf(' order by ', debut);
    return fin === -1 ? sqlTexte.slice(debut) : sqlTexte.slice(debut, fin);
  }

  async function executerListerEtCapturer(filtres: Omit<FiltresOrdresReparation, 'tri'>) {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    await expect(
      service.lister(
        CTX,
        principal('technicien'),
        { ...filtres, tri: TRI_DEFAUT_ORDRES_REPARATION },
        25,
        undefined,
      ),
    ).rejects.toThrow();

    return requeteOuter(capturedSelects);
  }

  it(
    'TEST DÉCISIF — q fourni : la clause where pose une disjonction à TROIS branches, chacune ' +
      'passée par `public.normaliser_recherche()`, avec le motif `%q%` RÉELLEMENT présent dans les ' +
      'paramètres émis (numéro direct, plaque courante via `vehicule_id in (select …)`, nom client ' +
      'via `client_id in (select …)`) — la preuve que le filtre est appliqué, pas seulement accepté.',
    async () => {
      const { sql, params } = await executerListerEtCapturer({ q: '445566' });
      const where = clauseWhere(sql);

      expect(where).toContain(
        'public.normaliser_recherche("ordre_reparation"."numero") like public.normaliser_recherche($',
      );
      expect(where).toContain(
        '"ordre_reparation"."vehicule_id" in (select "vehicule_id" from "vehicule_plaque"',
      );
      expect(where).toContain(
        'public.normaliser_recherche("vehicule_plaque"."valeur") like public.normaliser_recherche($',
      );
      expect(where).toContain('"ordre_reparation"."client_id" in (select "id" from "client"');
      expect(where).toContain('public.normaliser_recherche(coalesce("client"."raison_sociale"');
      // La recherche par nom accepte « Nom Prénom » ET « Prénom Nom » (deux comparaisons).
      expect(where).toContain("concat_ws(' ', \"client\".\"prenom\", \"client\".\"nom\")");
      // Les trois branches portent LE MÊME motif fragment, jamais un motif tronqué ou réécrit
      // (numéro, plaque, nom « nom prénom », nom « prénom nom » = 4 occurrences).
      expect(params.filter((p) => p === '%445566%')).toHaveLength(4);
    },
  );

  it(
    "TEST DÉCISIF (symétrique) — q absent : aucune des trois branches n'apparaît nulle part dans " +
      'la requête (ni `normaliser_recherche`, ni `vehicule_plaque`, ni sous-requête sur `client`) — ' +
      "le filtre reste inerte par défaut, jamais actif « à vide » (ce qui aurait, à l'inverse, " +
      'exclu silencieusement des OR).',
    async () => {
      const { sql } = await executerListerEtCapturer({});

      expect(sql).not.toContain('normaliser_recherche');
      expect(sql).not.toContain('vehicule_plaque');
      expect(sql).not.toMatch(/"ordre_reparation"\."client_id" in \(select/);
    },
  );

  it("deux valeurs de q DISTINCTES produisent deux motifs DISTINCTS dans les paramètres — preuve que ce n'est pas un filtre figé", async () => {
    const { params: paramsA } = await executerListerEtCapturer({ q: 'Rochat' });
    const { params: paramsB } = await executerListerEtCapturer({ q: 'Dupont' });

    expect(paramsA).toContain('%Rochat%');
    expect(paramsB).toContain('%Dupont%');
    expect(paramsA).not.toContain('%Dupont%');
  });

  it('un fragment (pas un préfixe) : le motif est enveloppé `%q%`, sans ancrage — un terme au milieu du nom/de la plaque/du numéro matche', async () => {
    const { params } = await executerListerEtCapturer({ q: 'Rhône' });

    expect(params).toContain('%Rhône%');
    // Ni ancré au début (pas de `q%`), ni à la fin (pas de `%q`) : les deux `%` encadrent le terme.
    expect(params).not.toContain('Rhône%');
    expect(params).not.toContain('%Rhône');
  });

  it(
    'plaque : le terme brut saisi (« 445566 », sans canton ni espace) est transmis TEL QUEL à ' +
      '`normaliser_recherche()` — aucune reformulation JS séparée qui pourrait diverger de la ' +
      'même fonction utilisée pour « VS 445566 » en base (RM-112, même mécanisme partout).',
    async () => {
      const { sql, params } = await executerListerEtCapturer({ q: '445566' });

      expect(clauseWhere(sql)).toContain(
        'public.normaliser_recherche("vehicule_plaque"."valeur") like public.normaliser_recherche($',
      );
      expect(params).toContain('%445566%');
    },
  );

  it('plaque : seule la plaque COURANTE est cherchée (`vehicule_plaque.au is null`) — celle réellement affichée au-dessus de la liste, jamais une plaque historique', async () => {
    const { sql } = await executerListerEtCapturer({ q: 'VS445566' });

    expect(clauseWhere(sql)).toContain('"vehicule_plaque"."au" is null');
  });

  it("isolation tenant : les DEUX sous-requêtes (plaque, client) rescopent explicitement sur ctx.tenantId — le RLS est le filet, jamais le mécanisme (doctrine du projet), un OR d'un AUTRE tenant ne doit jamais remonter même si sa plaque/son nom correspond au motif", async () => {
    const { sql, params } = await executerListerEtCapturer({ q: 'Dupont' });
    const where = clauseWhere(sql);

    expect(where).toContain('"vehicule_plaque"."tenant_id" = $');
    expect(where).toContain('"client"."tenant_id" = $');
    expect(params.filter((p) => p === CTX.tenantId).length).toBeGreaterThanOrEqual(2);
  });

  it(
    'garde-fou symboles seuls (ex. « --- ») : AUCUNE lettre ni chiffre dans q — la condition posée ' +
      'est `false` (aucun résultat), JAMAIS la liste entière (qui serait la fuite totale : ' +
      "l'exact inverse du défaut corrigé ici, où un filtre ignoré rendait déjà tout).",
    async () => {
      const { sql } = await executerListerEtCapturer({ q: '---' });
      const where = clauseWhere(sql);

      expect(where).toContain('false');
      expect(where).not.toContain('normaliser_recherche');
    },
  );

  it("aucune duplication ni JOIN introduits par q : la requête outer reste une SELECT simple sur ordre_reparation (in (select …) n'est jamais une jointure) — même garantie que le filtre technicienId plus haut", async () => {
    const { sql } = await executerListerEtCapturer({ q: 'OR-2026' });

    expect(sql).toMatch(/^select .* from "ordre_reparation" where /);
    expect(sql).not.toMatch(/\bjoin\b/i);
    expect(sql).not.toMatch(/\bgroup by\b/i);
    expect(sql).not.toMatch(/\bdistinct\b/i);
  });

  it('q compose par ET avec les autres filtres (ex. siteId) — jamais un filtre qui en écrase un autre', async () => {
    const { sql, params } = await executerListerEtCapturer({ q: 'Dupont', siteId: 'site-1' });
    const where = clauseWhere(sql);

    expect(where).toContain('"ordre_reparation"."site_id" = $');
    expect(params).toContain('site-1');
    expect(where).toContain('normaliser_recherche');
  });
});

/**
 * Suite directe de l'audit #73 : `filtres.tri` n'était JAMAIS lu par `ServiceOr.lister`, l'ORDER
 * BY restait figé sur `ouvertLe desc, creeLe desc` quelle que soit la valeur demandée. Les 5 valeurs
 * de `TRIS_ORDRES_REPARATION` sont maintenant toutes câblées par `construireOrdreTri` :
 * `ouvertLe:asc/desc`, `restitutionPromiseLe:asc/desc` (colonnes réelles) et `joursAttenteRetrait:desc`
 * (choix produit du 12.08.2026, décompte depuis `termineLe` pour un OR `termine`/`facture` — voir
 * la doc de tête de `ServiceOr.lister`). `numeroSequence:asc/desc` a été RETIRÉ du contrat (aucune
 * colonne de séquence numérique en base) — plus aucune valeur décorative dans ce module.
 *
 * Même patron `QueryBuilder` driver-less que les blocs `technicienId`/`#73` ci-dessus — la requête
 * est RÉELLEMENT construite par `ServiceOr.lister()`, jamais reconstruite indépendamment dans le
 * test.
 */
describe('ServiceOr.lister — tri (#73 suite, filtres.tri câblé)', () => {
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

  /** Isole la clause `order by` (entre `order by` et `limit`) — chercher les noms de colonnes dans
   *  le SQL ENTIER serait toujours vrai puisque le `select()` liste toutes les colonnes de la
   *  table. Même piège, même correctif que `clauseWhere` du bloc `#73` ci-dessus. */
  function clauseOrderBy(sqlTexte: string): string {
    const debut = sqlTexte.indexOf(' order by ');
    if (debut === -1) return '';
    const fin = sqlTexte.indexOf(' limit ', debut);
    return fin === -1 ? sqlTexte.slice(debut) : sqlTexte.slice(debut, fin);
  }

  async function executerListerEtCapturer(tri: FiltresOrdresReparation['tri']) {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    await expect(
      service.lister(CTX, principal('technicien'), { tri }, 25, undefined),
    ).rejects.toThrow();

    return requeteOuter(capturedSelects).sql;
  }

  it('ouvertLe:asc — `ouvert_le asc nulls last`, tiebreak `id` dans le sens du tri', async () => {
    const sqlTexte = await executerListerEtCapturer('ouvertLe:asc');
    expect(clauseOrderBy(sqlTexte)).toBe(
      ' order by "ordre_reparation"."ouvert_le" asc nulls last, "ordre_reparation"."id" asc',
    );
  });

  it("ouvertLe:desc — `ouvert_le desc nulls last` — sens STRICTEMENT inverse d'ouvertLe:asc, même colonne", async () => {
    const sqlTexte = await executerListerEtCapturer('ouvertLe:desc');
    expect(clauseOrderBy(sqlTexte)).toBe(
      ' order by "ordre_reparation"."ouvert_le" desc nulls last, "ordre_reparation"."id" desc',
    );
  });

  it('restitutionPromiseLe:asc — `restitution_promise_le asc nulls last`', async () => {
    const sqlTexte = await executerListerEtCapturer('restitutionPromiseLe:asc');
    expect(clauseOrderBy(sqlTexte)).toBe(
      ' order by "ordre_reparation"."restitution_promise_le" asc nulls last, "ordre_reparation"."id" asc',
    );
  });

  it('restitutionPromiseLe:desc — `restitution_promise_le desc nulls last` — sens STRICTEMENT inverse de restitutionPromiseLe:asc, même colonne', async () => {
    const sqlTexte = await executerListerEtCapturer('restitutionPromiseLe:desc');
    expect(clauseOrderBy(sqlTexte)).toBe(
      ' order by "ordre_reparation"."restitution_promise_le" desc nulls last, "ordre_reparation"."id" desc',
    );
  });

  it('NULLS LAST dans les DEUX sens : ni asc ni desc ne mentionne `nulls first` — un OR sans date ne remonte jamais en tête par accident', async () => {
    for (const tri of [
      'ouvertLe:asc',
      'ouvertLe:desc',
      'restitutionPromiseLe:asc',
      'restitutionPromiseLe:desc',
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- lecture séquentielle de 4 requêtes indépendantes, pas d'écriture
      const sqlTexte = await executerListerEtCapturer(tri);
      expect(clauseOrderBy(sqlTexte)).toContain('nulls last');
      expect(clauseOrderBy(sqlTexte)).not.toContain('nulls first');
    }
  });

  it(
    TRI_DEFAUT_ORDRES_REPARATION +
      " (valeur par défaut du contrat) produit EXACTEMENT le même ORDER BY qu'ouvertLe:desc — le défaut n'est pas un cas à part",
    async () => {
      const sqlDefaut = await executerListerEtCapturer(TRI_DEFAUT_ORDRES_REPARATION);
      const sqlExplicite = await executerListerEtCapturer('ouvertLe:desc');
      expect(clauseOrderBy(sqlDefaut)).toBe(clauseOrderBy(sqlExplicite));
    },
  );

  it(
    'joursAttenteRetrait:desc — décompte depuis `termine_le`, UNIQUEMENT pour les statuts ' +
      '`termine`/`facture` (T-17/T-18, les deux statuts depuis lesquels une restitution est valide) ' +
      '— trié ASC NULLS LAST (le plus longtemps en attente en premier, un OR hors-sujet relégué en fin)',
    async () => {
      const sqlTexte = await executerListerEtCapturer('joursAttenteRetrait:desc');
      expect(clauseOrderBy(sqlTexte)).toBe(
        ' order by (case when "ordre_reparation"."statut" in (\'termine\', \'facture\') ' +
          'then "ordre_reparation"."termine_le" end) asc nulls last, "ordre_reparation"."id" asc',
      );
    },
  );

  it(
    'joursAttenteRetrait:desc — NE mentionne PAS `nulls first` (un OR pas encore terminé, déjà ' +
      'restitué ou clôturé ne doit jamais remonter en tête par accident) — MUTATION : neutraliser le ' +
      '`nulls last` de la branche `joursAttenteRetrait` dans construireOrdreTri (le remplacer par une ' +
      'chaîne vide) doit faire rougir ce test',
    async () => {
      const sqlTexte = await executerListerEtCapturer('joursAttenteRetrait:desc');
      expect(clauseOrderBy(sqlTexte)).toContain('nulls last');
      expect(clauseOrderBy(sqlTexte)).not.toContain('nulls first');
    },
  );

  it(
    "joursAttenteRetrait:desc — restreint le décompte à `statut in ('termine', 'facture')` — " +
      'MUTATION : élargir ou supprimer cette liste dans construireOrdreTri (ex. retirer `facture`, ou ' +
      'remplacer par `true`) doit faire rougir ce test, sinon rien ne prouve que le filtre de statut ' +
      'est réellement appliqué au SQL plutôt que simplement accepté par le contrat',
    async () => {
      const sqlTexte = await executerListerEtCapturer('joursAttenteRetrait:desc');
      expect(clauseOrderBy(sqlTexte)).toContain(
        '"ordre_reparation"."statut" in (\'termine\', \'facture\')',
      );
    },
  );

  it('le tiebreak `id` (MÊME sens que la clé de tri, exigé par la comparaison ROW du keyset) termine TOUJOURS la clause order by — garantit un ordre total pour la pagination par curseur', async () => {
    for (const tri of [
      'ouvertLe:asc',
      'ouvertLe:desc',
      'restitutionPromiseLe:asc',
      'restitutionPromiseLe:desc',
      'joursAttenteRetrait:desc',
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- lecture séquentielle indépendante, pas d'écriture
      const sqlTexte = await executerListerEtCapturer(tri);
      const sens = tri.endsWith(':desc') && tri !== 'joursAttenteRetrait:desc' ? 'desc' : 'asc';
      expect(clauseOrderBy(sqlTexte)).toMatch(new RegExp(`, "ordre_reparation"\\."id" ${sens}$`));
    }
  });
});
