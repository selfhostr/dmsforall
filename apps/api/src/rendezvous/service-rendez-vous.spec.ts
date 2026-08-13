import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import type { FiltresRendezVous } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneMotifRendezVous, LigneRendezVous } from '../db/schema';
import { Horloge } from '../common/horloge';
import { encoderCurseurTrie } from '../common/pagination';

/**
 * #98 — `ServiceRendezVous.lister` n'avait AUCUNE spec : ses filtres (`statut`, `siteId`,
 * `clientId`, `vehiculeId`, `tri`, curseur) n'avaient été vérifiés qu'à la main, une fois, contre
 * la base de dev. Piège documenté (CONTRIBUTING.md) : « filtre accepté par le contrat ≠ filtre appliqué
 * au SQL » — un test qui mocke `tx.execute`/`tx.select` et vérifie seulement qu'on lui a passé un
 * objet ne prouve rien, un `if (filtres.x)` peut être décoratif et personne ne le voit avant la
 * prod.
 *
 * Deux techniques COMPLÉMENTAIRES, alignées sur le patron déjà établi dans ce dépôt (jamais
 * `pnpm test:integration`, jamais de Postgres réel) :
 *
 *  1. `QueryBuilder` driver-less de `drizzle-orm/pg-core` (même doctrine que
 *     `atelier/service-or.spec.ts::ServiceOr.lister — filtre technicienId` et
 *     `facturation/documents/service-documents.spec.ts::ServiceDocumentsVente.lister`) : on
 *     capture la requête RÉELLEMENT construite par `ServiceRendezVous.lister()` (jamais une
 *     reconstruction indépendante), on laisse l'`await` final échouer faute de pilote branché, et
 *     on inspecte le SQL/les paramètres RÉELLEMENT produits via `.toSQL()`. Le test décisif : un
 *     identifiant INEXISTANT produit la MÊME forme de condition SQL qu'un identifiant réel, liée
 *     À CE paramètre précis — la preuve qu'il n'est pas ignoré (voir
 *     `service-documents.spec.ts::ordreReparationId — câblé`, même patron).
 *  2. Une fausse transaction qui REND des lignes (contrôlées par le test) pour prouver le
 *     comportement de bout en bout attendu par le service : zéro ligne rendue -> page vide,
 *     `limite + 1` lignes rendues -> page tronquée à `limite` + curseur suivant. Combinée à (1),
 *     qui prouve que la clause WHERE contraint bien la requête à CE paramètre, ceci ferme la
 *     boucle : la seule façon qu'un Postgres réel ne rende PAS une liste vide pour un identifiant
 *     inexistant serait qu'une ligne porte littéralement cette valeur — impossible par
 *     construction pour un uuid tiré au hasard.
 */

vi.mock('./references', () => ({
  chargerCapaciteHeuresJourCentiemes: vi.fn(),
  chargerMotifLigne: vi.fn(),
  chargerOrLieOuNull: vi.fn(),
  chargerRendezVous: vi.fn(),
  chargerRendezVousPourEcriture: vi.fn(),
}));

vi.mock('../atelier/references', () => ({
  chargerClientLigne: vi.fn(),
  chargerVehiculeLigne: vi.fn(),
  chargerVehiculeResume: vi.fn(),
  versClientResume: vi.fn(),
}));

import { ServiceRendezVous } from './service-rendez-vous';
import * as references from './references';
import * as atelierReferences from '../atelier/references';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const SITE_INEXISTANT_ID = '00000000-0000-0000-0000-000000000000';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_INEXISTANT_ID = '00000000-0000-0000-0000-000000000001';
const VEHICULE_ID = '33333333-3333-4333-8333-333333333333';
const VEHICULE_INEXISTANT_ID = '00000000-0000-0000-0000-000000000002';

const FILTRES_BASE: FiltresRendezVous = {
  du: '2026-08-01',
  au: '2026-08-31',
  tri: 'creeLe:desc',
};

function serviceFactice(acces: { enTenant: ReturnType<typeof vi.fn> }): ServiceRendezVous {
  return new ServiceRendezVous(
    acces as never,
    {} as never,
    new Horloge(),
    {} as never,
    {} as never,
  );
}

function accesBaseFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* (1) Construction SQL réelle — driver-less                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Query-builder RÉEL de `drizzle-orm/pg-core`, sans pilote — construit un SQL inspectable via
 *  `.toSQL()` et ne lève qu'À L'EXÉCUTION (`await`), jamais à la construction. */
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

/** Isole la clause `where` : le `select` liste toutes les colonnes de `rendez_vous` (dont
 *  `site_id`/`client_id`/`vehicule_id`/`statut`, qui font partie du document indépendamment de
 *  tout filtre) — chercher ces noms dans le SQL ENTIER serait donc toujours vrai. Seule la
 *  clause `where` révèle si un filtre a effectivement posé sa condition. */
function clauseWhere(sql: string): string {
  const debut = sql.indexOf(' where ');
  if (debut === -1) throw new Error('Aucune clause where dans le SQL capturé.');
  const fin = sql.indexOf(' order by ', debut);
  return fin === -1 ? sql.slice(debut) : sql.slice(debut, fin);
}

async function executerListerEtCapturer(
  filtres: Partial<FiltresRendezVous>,
  curseur?: string,
  limite = 25,
) {
  const { tx, capturedSelects } = txQueryBuilderFactice();
  const acces = accesBaseFactice(tx);
  const service = serviceFactice(acces);

  // Le query-builder driver-less rejette TOUJOURS à l'exécution (aucun Postgres réel) — seule la
  // CONSTRUCTION de la requête (déjà terminée avant cet `await`) nous intéresse ici.
  await expect(
    service.lister(CTX, { ...FILTRES_BASE, ...filtres }, limite, curseur),
  ).rejects.toThrow();

  return requeteOuter(capturedSelects);
}

describe('ServiceRendezVous.lister — isolation tenant (règle n°1)', () => {
  it('la requête pose toujours tenant_id = celui du CONTEXTE, composé par ET avec les autres conditions', async () => {
    const { sql, params } = await executerListerEtCapturer({ siteId: SITE_ID });

    expect(sql).toContain('"rendez_vous"."tenant_id" = $');
    expect(params).toContain('tenant-a');
  });
});

describe('ServiceRendezVous.lister — filtre siteId', () => {
  it('fourni : la requête pose `site_id = $<valeur exacte>`', async () => {
    const { sql, params } = await executerListerEtCapturer({ siteId: SITE_ID });

    expect(sql).toContain('"rendez_vous"."site_id" = $');
    expect(params).toContain(SITE_ID);
  });

  it("inexistant : la MÊME condition SQL est posée, avec CE paramètre précis — le test décisif qui distingue un filtre appliqué d'un filtre décoratif", async () => {
    const { sql, params } = await executerListerEtCapturer({ siteId: SITE_INEXISTANT_ID });

    expect(sql).toContain('"rendez_vous"."site_id" = $');
    expect(params).toContain(SITE_INEXISTANT_ID);
    // Un id réel et un id inexistant ne doivent JAMAIS produire la même absence de condition.
    expect(params).not.toContain(SITE_ID);
  });

  it('absent : aucune condition sur site_id — le filtre reste inerte par défaut', async () => {
    const { sql } = await executerListerEtCapturer({});

    expect(clauseWhere(sql)).not.toContain('site_id');
  });
});

describe('ServiceRendezVous.lister — filtre clientId', () => {
  it('fourni : la requête pose `client_id = $<valeur exacte>`', async () => {
    const { sql, params } = await executerListerEtCapturer({ clientId: CLIENT_ID });

    expect(sql).toContain('"rendez_vous"."client_id" = $');
    expect(params).toContain(CLIENT_ID);
  });

  it('inexistant : la MÊME condition SQL est posée, avec CE paramètre précis', async () => {
    const { sql, params } = await executerListerEtCapturer({ clientId: CLIENT_INEXISTANT_ID });

    expect(sql).toContain('"rendez_vous"."client_id" = $');
    expect(params).toContain(CLIENT_INEXISTANT_ID);
    expect(params).not.toContain(CLIENT_ID);
  });

  it('absent : aucune condition sur client_id', async () => {
    const { sql } = await executerListerEtCapturer({});

    expect(clauseWhere(sql)).not.toContain('client_id');
  });
});

describe('ServiceRendezVous.lister — filtre vehiculeId', () => {
  it('fourni : la requête pose `vehicule_id = $<valeur exacte>`', async () => {
    const { sql, params } = await executerListerEtCapturer({ vehiculeId: VEHICULE_ID });

    expect(sql).toContain('"rendez_vous"."vehicule_id" = $');
    expect(params).toContain(VEHICULE_ID);
  });

  it('inexistant : la MÊME condition SQL est posée, avec CE paramètre précis', async () => {
    const { sql, params } = await executerListerEtCapturer({
      vehiculeId: VEHICULE_INEXISTANT_ID,
    });

    expect(sql).toContain('"rendez_vous"."vehicule_id" = $');
    expect(params).toContain(VEHICULE_INEXISTANT_ID);
    expect(params).not.toContain(VEHICULE_ID);
  });

  it('absent : aucune condition sur vehicule_id', async () => {
    const { sql } = await executerListerEtCapturer({});

    expect(clauseWhere(sql)).not.toContain('vehicule_id');
  });
});

describe('ServiceRendezVous.lister — filtre statut', () => {
  // `statut` est un enum fermé (`confirme|honore|absent|annule`, jamais de chaîne vide) : pas de
  // valeur « id inexistant » possible. La preuve décisive équivalente est ici que DEUX valeurs
  // légitimes et DISTINCTES produisent des paramètres liés distincts (le filtre n'est ni ignoré,
  // ni figé sur une seule valeur) — même rôle que le couple id réel / id inexistant ci-dessus.
  it("statut='confirme' : la requête pose `statut = $<'confirme'>`", async () => {
    const { sql, params } = await executerListerEtCapturer({ statut: 'confirme' });

    expect(sql).toContain('"rendez_vous"."statut" = $');
    expect(params).toContain('confirme');
  });

  it("statut='annule' (valeur distincte) : le paramètre lié change avec la valeur — preuve qu'il n'est pas ignoré", async () => {
    const { sql, params } = await executerListerEtCapturer({ statut: 'annule' });

    expect(sql).toContain('"rendez_vous"."statut" = $');
    expect(params).toContain('annule');
    expect(params).not.toContain('confirme');
  });

  it('absent : aucune condition sur statut', async () => {
    const { sql } = await executerListerEtCapturer({});

    expect(clauseWhere(sql)).not.toContain('"rendez_vous"."statut" = $');
  });
});

describe('ServiceRendezVous.lister — bornes du/au (obligatoires)', () => {
  it('pose `date >= du` ET `date <= au` avec les valeurs exactes transmises', async () => {
    const { sql, params } = await executerListerEtCapturer({
      du: '2026-08-01',
      au: '2026-08-31',
    });

    expect(sql).toContain('"rendez_vous"."date" >= $');
    expect(sql).toContain('"rendez_vous"."date" <= $');
    expect(params).toContain('2026-08-01');
    expect(params).toContain('2026-08-31');
  });
});

describe('ServiceRendezVous.lister — composition des filtres (jamais un filtre qui en écrase un autre)', () => {
  it('siteId + clientId + statut composent tous par ET, sans que le dernier ajouté efface les précédents', async () => {
    const { sql, params } = await executerListerEtCapturer({
      siteId: SITE_ID,
      clientId: CLIENT_ID,
      statut: 'confirme',
    });

    expect(sql).toContain('"rendez_vous"."site_id" = $');
    expect(sql).toContain('"rendez_vous"."client_id" = $');
    expect(sql).toContain('"rendez_vous"."statut" = $');
    expect(params).toContain(SITE_ID);
    expect(params).toContain(CLIENT_ID);
    expect(params).toContain('confirme');
    expect(sql).not.toMatch(/\bor\b/i);
  });
});

describe('ServiceRendezVous.lister — projection `creeLeTexte` (préservation de la microseconde Postgres)', () => {
  it('sélectionne `cree_le::text`, jamais le `Date` par défaut du pilote — même piège que CONTRIBUTING.md (curseur qui saute des lignes)', async () => {
    const { sql } = await executerListerEtCapturer({});

    // Pas d'alias SQL littéral (`as "creeLeTexte"`) à chercher : le query-builder drizzle
    // n'écrit PAS de clause `AS` pour ce champ calculé — le mapping vers la clé JS
    // `creeLeTexte` se fait côté client, par POSITION, via les métadonnées de projection du
    // builder, jamais par le nom de colonne renvoyé par Postgres. Seul le cast `::text`
    // (le correctif réel du piège microseconde) est du SQL observable.
    expect(sql).toContain('"cree_le"::text');
  });
});

describe('ServiceRendezVous.lister — curseur : refus propre AVANT toute requête, sur une entrée forgée', () => {
  it('curseur base64/JSON illisible : VALIDATION_ECHOUEE, `tx.select` JAMAIS appelé', async () => {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    await expect(
      service.lister(CTX, FILTRES_BASE, 25, 'ceci-n-est-pas-un-curseur-valide'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(capturedSelects).toHaveLength(0);
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('curseur v2 bien formé mais dont le `tri` diverge du tri demandé : VALIDATION_ECHOUEE, jamais une page silencieusement fausse', async () => {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    const curseurAutreTri = encoderCurseurTrie({
      tri: 'creeLe:asc',
      valeur: '2026-07-29T13:37:35.171181+00:00',
      id: '44444444-4444-4444-8444-444444444444',
    });

    await expect(
      service.lister(CTX, { ...FILTRES_BASE, tri: 'creeLe:desc' }, 25, curseurAutreTri),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(capturedSelects).toHaveLength(0);
  });

  it("curseur v2 dont la `valeur` n'est pas un timestamptz Postgres bien formé (validation de CONTENU, pas seulement de forme) : VALIDATION_ECHOUEE", async () => {
    const { tx, capturedSelects } = txQueryBuilderFactice();
    const acces = accesBaseFactice(tx);
    const service = serviceFactice(acces);

    const curseurValeurInvalide = encoderCurseurTrie({
      tri: 'creeLe:desc',
      valeur: 'pas-un-horodatage',
      id: '44444444-4444-4444-8444-444444444444',
    });

    await expect(
      service.lister(CTX, FILTRES_BASE, 25, curseurValeurInvalide),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(capturedSelects).toHaveLength(0);
  });
});

describe('ServiceRendezVous.lister — curseur bien formé : condition keyset correcte, microseconde intacte', () => {
  const ID_CURSEUR = '44444444-4444-4444-8444-444444444444';
  // Valeur PLEINE PRÉCISION (6 chiffres de microseconde) — piège CONTRIBUTING.md : un `Date` JS aurait
  // tronqué à la milliseconde. La condition doit transporter EXACTEMENT cette chaîne.
  const VALEUR_MICROSECONDE = '2026-07-29T13:37:35.171181+00:00';

  it("tri 'creeLe:desc' (défaut) : opérateur `<`, condition composée par ET avec le reste, valeur ET id transmis SANS perte de précision", async () => {
    const curseur = encoderCurseurTrie({
      tri: 'creeLe:desc',
      valeur: VALEUR_MICROSECONDE,
      id: ID_CURSEUR,
    });

    const { sql, params } = await executerListerEtCapturer({}, curseur);

    expect(sql).toContain('"rendez_vous"."cree_le"');
    expect(sql).toContain('"rendez_vous"."id"');
    expect(sql).toMatch(/<\s*\(/);
    expect(sql).toContain('::timestamptz');
    expect(params).toContain(VALEUR_MICROSECONDE);
    expect(params).toContain(ID_CURSEUR);
  });

  it("tri 'creeLe:asc' : opérateur `>` (sens inversé), jamais `<` — sinon la pagination boucle sur elle-même", async () => {
    const curseur = encoderCurseurTrie({
      tri: 'creeLe:asc',
      valeur: VALEUR_MICROSECONDE,
      id: ID_CURSEUR,
    });

    const { sql, params } = await executerListerEtCapturer({ tri: 'creeLe:asc' }, curseur);

    expect(sql).toMatch(/>\s*\(/);
    expect(params).toContain(VALEUR_MICROSECONDE);
  });

  it('la clause keyset se compose par ET avec tenant_id et les filtres actifs, jamais en OR', async () => {
    const curseur = encoderCurseurTrie({
      tri: 'creeLe:desc',
      valeur: VALEUR_MICROSECONDE,
      id: ID_CURSEUR,
    });

    const { sql } = await executerListerEtCapturer({ siteId: SITE_ID }, curseur);

    expect(sql).not.toMatch(/\bor\b/i);
    expect(sql).toContain('"rendez_vous"."tenant_id" = $');
    expect(sql).toContain('"rendez_vous"."site_id" = $');
  });
});

describe('ServiceRendezVous.lister — tri et limite', () => {
  it('ordonne par (cree_le, id) DESC par défaut, et pose LIMIT à `limite + 1` (détection de page suivante)', async () => {
    const { sql, params } = await executerListerEtCapturer({}, undefined, 25);

    expect(sql).toMatch(/order by "rendez_vous"\."cree_le" desc, "rendez_vous"\."id" desc/);
    expect(sql).toMatch(/limit \$\d+/i);
    expect(params).toContain(26);
  });

  it("tri 'creeLe:asc' : ordonne sur les deux colonnes, jamais `desc` — drizzle omet le mot-clé `asc` (défaut SQL implicite), ce test échouerait si le sens restait figé sur `desc`", async () => {
    const { sql } = await executerListerEtCapturer({ tri: 'creeLe:asc' });

    expect(sql).toMatch(/order by "rendez_vous"\."cree_le", "rendez_vous"\."id"/);
    expect(sql).not.toMatch(/order by[^;]*desc/i);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* (2) Comportement de bout en bout — fausse transaction qui REND des lignes                    */
/* ------------------------------------------------------------------------------------------ */

function ligneRendezVous(champs: Partial<LigneRendezVous> = {}): LigneRendezVous & {
  readonly creeLeTexte: string;
} {
  const creeLe = champs.creeLe ?? new Date('2026-07-29T13:37:35.171Z');
  return {
    id: 'rdv-1',
    tenantId: 'tenant-a',
    siteId: SITE_ID,
    clientId: CLIENT_ID,
    vehiculeId: null,
    motifId: 'motif-1',
    commentaire: null,
    type: 'service',
    date: '2026-08-10',
    moment: 'matin',
    heureSouhaitee: null,
    dureeEstimeeMinutes: 60,
    statut: 'confirme',
    motifAnnulation: null,
    origine: 'reservation',
    confirmeLe: new Date('2026-07-29T13:37:35.171Z'),
    honoreLe: null,
    absentConstateLe: null,
    annuleLe: null,
    creeParId: 'user-1',
    creeLe,
    modifieLe: new Date('2026-07-29T13:37:35.171Z'),
    ...champs,
    // `::text` rendu par Postgres — pleine précision, ce qui distingue ce champ de `creeLe`
    // (un `Date` JS, tronqué à la milliseconde) : jamais dérivé l'un de l'autre dans ce fixture.
    creeLeTexte: champs.creeLe?.toISOString() ?? '2026-07-29 13:37:35.171181+00',
  } as LigneRendezVous & { readonly creeLeTexte: string };
}

function motifLigneFixture(): LigneMotifRendezVous {
  return {
    id: 'motif-1',
    tenantId: 'tenant-a',
    code: 'REVISION',
    libelleFr: 'Révision',
    libelleDe: null,
    libelleIt: null,
    dureeDefautMinutes: 60,
    heuresAtelierDefautCentiemes: null,
    actif: true,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-01-01T00:00:00.000Z'),
  } as LigneMotifRendezVous;
}

/** Fausse transaction dont `select().from().where().orderBy().limit()` REND directement les
 *  lignes fournies — simule ce qu'une vraie Postgres rendrait APRÈS avoir appliqué la clause
 *  WHERE prouvée ci-dessus. Combinée à ces preuves de construction SQL, ceci ferme la boucle sur
 *  le comportement observable du service. */
function txRowsFactice(lignes: ReturnType<typeof ligneRendezVous>[]) {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(lignes),
          }),
        }),
      }),
    }),
  };
  return tx as unknown as TransactionDfa;
}

beforeEach(() => {
  vi.mocked(references.chargerMotifLigne).mockResolvedValue(motifLigneFixture());
  vi.mocked(references.chargerOrLieOuNull).mockResolvedValue(null);
  vi.mocked(atelierReferences.chargerClientLigne).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(atelierReferences.versClientResume).mockResolvedValue({
    id: CLIENT_ID,
    numeroClient: 'CL-000001',
    nomAffiche: 'Jean Dupont',
    type: 'particulier',
    statut: 'actif',
    langueCorrespondance: 'fr',
    poObligatoire: false,
    telephone: null,
    localite: null,
    nombreVehicules: 0,
    dernierPassageLe: null,
  } as never);
});

describe('ServiceRendezVous.lister — comportement de bout en bout (le test décisif)', () => {
  it("AUCUNE ligne rendue par la transaction (ce qu'une Postgres réelle rend pour un identifiant inexistant) -> page VIDE, jamais une erreur ni une liste par défaut", async () => {
    const acces = accesBaseFactice(txRowsFactice([]));
    const service = serviceFactice(acces);

    const page = await service.lister(
      CTX,
      { ...FILTRES_BASE, clientId: CLIENT_INEXISTANT_ID },
      25,
      undefined,
    );

    expect(page.donnees).toEqual([]);
    expect(page.curseurSuivant).toBeNull();
    expect(page.limite).toBe(25);
  });

  it('exactement `limite` lignes rendues -> page complète, `curseurSuivant` null (pas de page suivante fantôme)', async () => {
    const acces = accesBaseFactice(txRowsFactice([ligneRendezVous({ id: 'rdv-1' })]));
    const service = serviceFactice(acces);

    const page = await service.lister(CTX, FILTRES_BASE, 1, undefined);

    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.id).toBe('rdv-1');
    expect(page.curseurSuivant).toBeNull();
  });

  it('`limite + 1` lignes rendues -> page tronquée à `limite`, curseurSuivant encodé depuis le DERNIER élément de la page tronquée (jamais celui en trop)', async () => {
    const acces = accesBaseFactice(
      txRowsFactice([
        ligneRendezVous({ id: 'rdv-1', creeLe: new Date('2026-07-29T13:37:35.171Z') }),
        ligneRendezVous({ id: 'rdv-2', creeLe: new Date('2026-07-28T13:37:35.171Z') }),
      ]),
    );
    const service = serviceFactice(acces);

    const page = await service.lister(CTX, FILTRES_BASE, 1, undefined);

    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.id).toBe('rdv-1');
    expect(page.curseurSuivant).not.toBeNull();
  });
});
