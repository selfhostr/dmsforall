import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { TRI_DEFAUT_ORDRES_REPARATION } from '@dfa/shared';
import type { EntreeModificationOrdreReparation, FiltresOrdresReparation } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneOrdreReparation } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';

/**
 * Point de vigilance n°1 de l'audit sécurité (docs/audit-securite-lot1.md §4) : `PATCH
 * /ordres-reparation/{orId}` sert TOUS les champs libres de l'en-tête sous le SEUL droit
 * `atelier.or.modifier`, alors que `plafondCentimes` (RM-54, §10 L969 : le montant au-delà duquel
 * l'accord du client est requis — décide si on rappelle le client avant d'engager des frais)
 * mérite son propre droit, structurellement plus fort, `atelier.or.plafond_modifier`. L'audit
 * notait que ce n'était PAS exploitable au moment de la revue (les deux droits étaient accordés
 * aux mêmes rôles — réceptionnaire, chef d'atelier, direction, admin) mais que « le jour où l'une
 * des deux sera resserrée, le contrôle sera silencieusement inopérant » — exactement le même
 * schéma que É-01 (`ServiceVehiculeKilometrage.creer` / `vehicule.kilometrage.corriger_regression`,
 * `apps/api/src/vehicules/service-vehicule-kilometrage.ts`).
 *
 * Ce fichier prouve, sans base réelle (fonctions de requête et transaction MOQUÉES — même doctrine
 * que `service-vehicule-kilometrage.spec.ts`), que `ServiceOr.modifier` vérifie désormais
 * explicitement `MATRICE_DROITS[role].includes('atelier.or.plafond_modifier')`, à partir du `role`
 * transmis par l'appelant (jamais déduit ailleurs), UNIQUEMENT quand `plafondCentimes` change
 * RÉELLEMENT — jamais en permanence (un `@ExigerDroit` statique sur cette route interdirait aussi
 * les modifications ordinaires à tout rôle qui n'aurait que `atelier.or.modifier`) — et que le
 * refus n'écrit RIEN en base (aucun appel à `tx.update`, aucun assemblage de document).
 *
 * Les rôles choisis ci-dessous (`technicien`) n'ont AUJOURD'HUI ni `atelier.or.modifier` ni
 * `atelier.or.plafond_modifier` dans la matrice réelle (les deux sont actuellement accordés aux
 * mêmes rôles, cf. audit) — ce test exerce volontairement `ServiceOr.modifier` directement,
 * court-circuitant le garde-fou plus grossier posé par le contrôleur (`@ExigerDroit('atelier.or.modifier')`),
 * pour prouver que le contrôle fin du plafond tient PAR LUI-MÊME, indépendamment de cette
 * coïncidence actuelle des deux droits — c'est précisément ce que l'audit appelait à vérifier.
 */
vi.mock('./or-requetes', () => ({
  chargerOrPourEcriture: vi.fn(),
}));

import { encoderCurseurOffset, ServiceOr } from './service-or';
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

  it("aucun OR n'est perdu ni dupliqué par la pagination : la requête outer reste une SELECT simple sur ordre_reparation (pas de GROUP BY, pas de DISTINCT rendus nécessaires par le filtre), avec limit/offset intacts — le exists(...) ne change ni la forme ni le compte de lignes retournées par OR", async () => {
    const { sql, params } = await executerListerEtCapturer(
      { technicienId: 'tech-1', siteId: 'site-1' },
      // Curseur non nul : `decoderCurseurOffset(undefined)` vaut 0, et drizzle omet la clause
      // `offset` quand la valeur est 0 (rien à sauter) — un curseur réel, produit par
      // `encoderCurseurOffset`, est nécessaire pour observer la clause dans le SQL généré.
      encoderCurseurOffset(10),
    );

    expect(sql).not.toMatch(/\bgroup by\b/i);
    expect(sql).not.toMatch(/\bdistinct\b/i);
    expect(sql).toMatch(/\blimit \$\d+/i);
    expect(sql).toMatch(/\boffset \$\d+/i);
    // Le filtre siteId (déjà câblé) et technicienId (nouvellement câblé) COMPOSENT par ET, sans
    // que l'un écrase l'autre.
    expect(sql).toContain('"ordre_reparation"."site_id" = $');
    expect(params).toContain('site-1');
    expect(params).toContain('tech-1');
  });
});
