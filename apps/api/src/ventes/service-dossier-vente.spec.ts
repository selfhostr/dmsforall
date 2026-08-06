import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreeActionLivrer } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import { vehiculeDetention, vehiculeStock } from '../db/schema';
import type { LigneDossierVente, LigneReprise, LigneVehiculeStock } from '../db/schema';
import type { Horloge } from '../common/horloge/horloge';

/**
 * Trou n°1 comblé (audit préalable, rapport de livraison) : `POST /dossiers-vente/{id}/livrer`
 * n'implémentait que l'effet de bord « détention » sur les 3 documentés par
 * `contrats/ventes/dossier-vente.ts::schemaActionLivrer` — la mise en stock automatique de la
 * reprise confirmée (RV-24) n'était écrite NULLE PART (`origineRepriseDossierVenteId` était
 * seulement LU dans tout le module, jamais ÉCRIT). Ce fichier prouve, base MOQUÉE (`./references`
 * mocké, même doctrine que `atelier/service-or.spec.ts`) : la reprise CONFIRMÉE entre en stock à sa
 * valeur NÉGOCIÉE (jamais estimée, RV-24 littéral), avec la bonne provenance/origine, la reprise
 * NON confirmée n'y entre jamais, et le doublon (véhicule repris déjà en stock) est refusé proprement
 * plutôt que de laisser fuiter une violation SQL brute.
 *
 * `assembler()` (privé, ré-assemble tout le document — clients, financements, documents, audit) est
 * COURT-CIRCUITÉ via `vi.spyOn` : ce fichier n'exerce QUE l'effet de bord ajouté, pas le reste du
 * document déjà exercé ailleurs (mêmes principes que `service-or.spec.ts` pour `assemblerDocument`,
 * qui est public là-bas — ici privé, d'où le cast `any` assumé, seule façon d'atteindre la méthode
 * depuis un fichier de test externe).
 */
vi.mock('./references', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./references')>();
  return {
    ...reel,
    chargerDossierVente: vi.fn(),
    chargerDossierVentePourEcriture: vi.fn(),
    chargerVehiculeStockPourEcriture: vi.fn(),
    chargerVehiculeStockOuNull: vi.fn(),
    chargerRepriseParDossierOuNull: vi.fn(),
  };
});

import { ServiceDossierVente, estViolationCleUniqueVehiculeStock } from './service-dossier-vente';
import * as references from './references';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'user-1', requeteId: null };
const DOSSIER_ID = 'dossier-1';
const VEHICULE_VENDU_ID = 'veh-vendu-1';
const VEHICULE_REPRIS_ID = 'veh-repris-1';
const MAINTENANT = new Date('2026-08-01T10:00:00.000Z');

const ENTREE: EntreeActionLivrer = {
  dateLivraisonEffective: '2026-08-01',
  kilometrageDepart: 12,
  uniteKilometrage: 'km',
};

function horlogeFactice(): Horloge {
  return { maintenant: () => MAINTENANT } as unknown as Horloge;
}

function dossierFixture(champs: Partial<LigneDossierVente> = {}): LigneDossierVente {
  return {
    id: DOSSIER_ID,
    tenantId: 'tid-1',
    siteId: 'site-1',
    statut: 'pret_a_livrer',
    vehiculeId: VEHICULE_VENDU_ID,
    clientAcheteurId: 'client-acheteur-1',
    clientFactureId: null,
    clientConducteurId: null,
    dateLivraisonEstimee: null,
    dateLivraisonEffective: null,
    identitePieceType: 'carte_identite',
    identiteVerifieeLe: new Date('2026-07-20T09:00:00.000Z'),
    engageLe: new Date('2026-07-20T09:00:00.000Z'),
    enPreparationLe: new Date('2026-07-21T09:00:00.000Z'),
    pretALivrerLe: new Date('2026-07-25T09:00:00.000Z'),
    livreLe: null,
    closLe: null,
    annuleLe: null,
    abandonneLe: null,
    motifCloture: null,
    version: 4,
    creeLe: new Date('2026-07-15T08:00:00.000Z'),
    modifieLe: new Date('2026-07-25T09:00:00.000Z'),
    ...champs,
  } as LigneDossierVente;
}

function vehiculeStockVenduFixture(champs: Partial<LigneVehiculeStock> = {}): LigneVehiculeStock {
  return {
    id: VEHICULE_VENDU_ID,
    tenantId: 'tid-1',
    siteId: 'site-1',
    provenance: 'neuf_constructeur',
    dateEntreeStock: '2026-06-01',
    prixAchatCentimes: 2_000_000,
    prixVenteAfficheCentimes: 2_500_000,
    statutCommercial: 'vendu',
    vendeurPrecedentAssujetti: null,
    origineRepriseDossierVenteId: null,
    dernierMotifTransition: null,
    receptionneLe: new Date('2026-06-01T08:00:00.000Z'),
    reserveLe: new Date('2026-07-01T08:00:00.000Z'),
    venduLe: new Date('2026-07-20T08:00:00.000Z'),
    livreLe: null,
    version: 3,
    creeLe: new Date('2026-06-01T08:00:00.000Z'),
    modifieLe: new Date('2026-07-20T08:00:00.000Z'),
    ...champs,
  } as LigneVehiculeStock;
}

function repriseFixture(champs: Partial<LigneReprise> = {}): LigneReprise {
  return {
    id: 'reprise-1',
    tenantId: 'tid-1',
    dossierVenteId: DOSSIER_ID,
    vehiculeRepriseId: VEHICULE_REPRIS_ID,
    statut: 'confirmee',
    valeurEstimeeCentimes: 800_000,
    valeurNegocieeCentimes: 750_000,
    detteFinancementResiduelleCentimes: null,
    detteFinancementOrganismeId: null,
    detteFinancementOrganismeNom: null,
    motifRefus: null,
    estimeeLe: new Date('2026-07-01T08:00:00.000Z'),
    negocieeLe: new Date('2026-07-05T08:00:00.000Z'),
    confirmeeLe: new Date('2026-07-20T09:00:00.000Z'),
    refuseeLe: null,
    version: 3,
    creeLe: new Date('2026-07-01T08:00:00.000Z'),
    modifieLe: new Date('2026-07-20T09:00:00.000Z'),
    ...champs,
  } as LigneReprise;
}

interface AppelInsert {
  readonly table: unknown;
  readonly valeurs: unknown;
}
interface AppelUpdate {
  readonly table: unknown;
  readonly champs: unknown;
}

/** Fausse transaction : seuls `select().from().where().limit()`, `update().set().where()` et
 *  `insert().values()` sont exercés par `livrer()` (hors ce qui passe par `./references`, mocké). */
function txFactice(selects: readonly unknown[][] = []) {
  const files = [...selects];
  const insertCalls: AppelInsert[] = [];
  const updateCalls: AppelUpdate[] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(files.shift() ?? []) }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (valeurs: unknown) => {
        insertCalls.push({ table, valeurs });
        return Promise.resolve(undefined);
      },
    }),
    update: (table: unknown) => ({
      set: (champs: unknown) => {
        updateCalls.push({ table, champs });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };

  return { tx: tx as unknown as TransactionDfa, insertCalls, updateCalls };
}

function accesFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

function serviceFactice(acces: ReturnType<typeof accesFactice>): ServiceDossierVente {
  const svc = new ServiceDossierVente(acces as never, {} as never, {} as never, horlogeFactice());
  // `assembler` est privé — seule façon de l'atteindre depuis ce fichier de test, même principe
  // que `service-or.spec.ts` pour `assemblerDocument` (public là-bas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(svc as any, 'assembler').mockResolvedValue({} as never);
  return svc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceDossierVente.livrer — RV-24 : mise en stock automatique de la reprise confirmée', () => {
  it('sans reprise sur ce dossier : aucune écriture vehicule_stock pour un véhicule repris', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(null);
    vi.mocked(references.chargerDossierVente).mockResolvedValue(
      dossierFixture({ statut: 'livre' }),
    );

    const { tx, insertCalls } = txFactice([[]]); // 1 select : détention ouverte du véhicule vendu
    const svc = serviceFactice(accesFactice(tx));

    await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it("reprise NÉGOCIÉE (pas encore confirmée) : n'entre PAS en stock à la livraison", async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(
      repriseFixture({ statut: 'negociee', confirmeeLe: null }),
    );
    vi.mocked(references.chargerDossierVente).mockResolvedValue(
      dossierFixture({ statut: 'livre' }),
    );

    const { tx, insertCalls } = txFactice([[]]);
    const svc = serviceFactice(accesFactice(tx));

    await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it('reprise CONFIRMÉE : entre en stock à la valeur NÉGOCIÉE (jamais estimée), provenance `reprise`, origine tracée, détention clôturée sans réouverture', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(repriseFixture());
    vi.mocked(references.chargerVehiculeStockOuNull).mockResolvedValue(null); // pas encore en stock
    vi.mocked(references.chargerDossierVente).mockResolvedValue(
      dossierFixture({ statut: 'livre' }),
    );

    // 2 selects attendus, dans l'ordre : détention du véhicule VENDU, puis détention du véhicule REPRIS.
    const { tx, insertCalls, updateCalls } = txFactice([
      [{ id: 'detention-vendu-1' }],
      [{ id: 'detention-reprise-1' }],
    ]);
    const svc = serviceFactice(accesFactice(tx));

    await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

    const insertVehiculeStock = insertCalls.find((c) => c.table === vehiculeStock);
    expect(insertVehiculeStock?.valeurs).toMatchObject({
      id: VEHICULE_REPRIS_ID,
      tenantId: 'tid-1',
      siteId: 'site-1',
      provenance: 'reprise',
      prixAchatCentimes: 750_000, // valeurNegocieeCentimes — JAMAIS valeurEstimeeCentimes (800_000)
      dateEntreeStock: '2026-08-01',
      statutCommercial: 'disponible',
      origineRepriseDossierVenteId: DOSSIER_ID,
    });

    const clotureDetentionReprise = updateCalls.find(
      (c) =>
        c.table === vehiculeDetention && (c.champs as { motifFin?: string }).motifFin === 'reprise',
    );
    expect(clotureDetentionReprise?.champs).toMatchObject({
      au: '2026-08-01',
      motifFin: 'reprise',
    });

    // Pas de réouverture au nom d'un détenteur cible pour le véhicule repris (`QV-01` non tranché) :
    // un seul insert `vehicule_detention` — celui du véhicule VENDU (nouveau détenteur, RV-53).
    const insertsDetention = insertCalls.filter((c) => c.table === vehiculeDetention);
    expect(insertsDetention).toHaveLength(1);
  });

  it('véhicule repris déjà en stock : 409 VENTE_VEHICULE_STOCK_DEJA_EXISTANT, aucune écriture vehicule_stock', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(repriseFixture());
    vi.mocked(references.chargerVehiculeStockOuNull).mockResolvedValue(
      vehiculeStockVenduFixture({ id: VEHICULE_REPRIS_ID }),
    );

    const { tx, insertCalls } = txFactice([[]]);
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE)).rejects.toMatchObject({
      code: 'VENTE_VEHICULE_STOCK_DEJA_EXISTANT',
    });
    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it('reprise confirmée sans valeur négociée (incohérence de données, ne devrait jamais arriver) : ERREUR_INTERNE plutôt qu’un centime `null` silencieux', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(
      repriseFixture({ valeurNegocieeCentimes: null }),
    );

    const { tx, insertCalls } = txFactice([[]]);
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE)).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it('livraison refusée si le véhicule vendu n’est pas encore facturé (`vendu`) — garde déjà en place, non régressée', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture({ statutCommercial: 'reserve' }),
    );

    const { tx } = txFactice([]);
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE)).rejects.toMatchObject({
      code: 'VENTE_VEHICULE_INDISPONIBLE',
    });
  });
});

/**
 * Bug corrigé (constaté en exécution réelle, reproduit via `POST /dossiers-vente/{id}/livrer` sur
 * un véhicule portant déjà une détention ouverte à la même date que `dateLivraisonEffective`) :
 * `vehicule_detention_periode_chk`/`vehicule_detention_unicite_excl` sont déjà traduites en
 * `ErreurMetier` par `traduireErreurDetentionVehicule` (jamais un 500 nu), mais le message
 * contextualisé n'était passé qu'au constructeur `Error` sous-jacent — jamais à `options.detail`,
 * le seul champ que `FiltreProbleme` sérialise réellement dans le corps `problem+json`. Le client
 * recevait donc un 400 `VALIDATION_ECHOUEE` STABLE mais MUET (aucun indice de ce qui bloque).
 */
describe('ServiceDossierVente.livrer — traduction de la violation de contrainte vehicule_detention', () => {
  function erreurPgEnveloppee(sqlstate: string, contrainte: string): Error {
    const brute = new Error('constraint violation') as Error & {
      code: string;
      constraint: string;
    };
    brute.code = sqlstate;
    brute.constraint = contrainte;
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;
    return enveloppee;
  }

  it('`vehicule_detention_periode_chk` (date de livraison antérieure à une détention déjà ouverte) : 400 VALIDATION_ECHOUEE avec `detail` exploitable, jamais 500', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );

    const { tx, insertCalls, updateCalls } = txFactice([[{ id: 'detention-vendu-ouverte' }]]);
    // `livrer()` fait DEUX `update` avant l'écriture `vehicule_detention` : `transitionnerVehiculeStock`
    // (`vehicule_stock`) puis `transitionnerDossier` (`dossier_vente`), tous deux SANS rapport avec
    // cette contrainte — seul l'`update` de clôture de la détention ouverte du véhicule VENDU doit
    // échouer ici, sans quoi l'erreur brute remonterait depuis un des deux premiers `update`
    // (aucun catch adapté à ce SQLSTATE) au lieu d'exercer `traduireErreurDetentionVehicule`.
    const updateReel = tx.update.bind(tx);
    tx.update = ((table: unknown) =>
      table === vehiculeDetention
        ? {
            set: (champs: unknown) => {
              updateCalls.push({ table, champs });
              return {
                where: () =>
                  Promise.reject(erreurPgEnveloppee('23514', 'vehicule_detention_periode_chk')),
              };
            },
          }
        : updateReel(table as never)) as unknown as TransactionDfa['update'];
    const svc = serviceFactice(accesFactice(tx));

    const rejet = svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);
    await expect(rejet).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      detail:
        "La date de livraison précède le début d'une détention déjà enregistrée pour ce véhicule — vérifiez la date saisie.",
    });
    // Jamais un 500 nu : la violation de contrainte est bien interceptée et traduite, pas relancée
    // telle quelle (`ERREUR_INTERNE` uniquement pour un SQLSTATE non reconnu par cette table).
    await expect(rejet).rejects.not.toMatchObject({ code: 'ERREUR_INTERNE' });
    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it('`vehicule_detention_unicite_excl` (deux détenteurs courants) : 409→400 VALIDATION_ECHOUEE avec `detail`, jamais 500', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );

    // Pas de détention ouverte à clôturer (select vide) : l'échec porte sur l'INSERT de la
    // nouvelle détention (nouveau détenteur, RV-53).
    const { tx } = txFactice([[]]);
    tx.insert = ((table: unknown) =>
      table === vehiculeDetention
        ? {
            values: () =>
              Promise.reject(erreurPgEnveloppee('23P01', 'vehicule_detention_unicite_excl')),
          }
        : { values: () => Promise.resolve(undefined) }) as unknown as TransactionDfa['insert'];
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE)).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      detail: 'Ce véhicule porte déjà une détention active sur la période demandée (RM-20).',
    });
  });
});

/**
 * BUG CORRIGÉ (issue GitHub #13, « Impossible de livrer un véhicule le jour même ») : livrer avec
 * `dateLivraisonEffective` = aujourd'hui échouait SYSTÉMATIQUEMENT dès que le véhicule portait déjà
 * une détention ouverte le même jour civil — le cas le plus courant en concession (client qui paie
 * et repart avec sa voiture le jour même). Confirmé en conditions réelles contre le Postgres de dev
 * (rôle `dfa_app`, RLS actif) avant ce correctif : `update vehicule_detention set au =
 * current_date ... where du = current_date` lève `vehicule_detention_periode_chk` (`au > du`
 * STRICT, deux `date` Postgres sans heure) — deux dates civiles ÉGALES, même si les instants réels
 * diffèrent de plusieurs heures, ne satisfont jamais `>`.
 *
 * Niveau de comparaison retenu : le JOUR CIVIL, PAS l'instant. `vehicule_detention.du`/`au` sont
 * des `date` Postgres et `EntreeActionLivrer.dateLivraisonEffective` un `schemaDateJour` — aucune
 * heure n'existe nulle part dans cette donnée, la comparer à la microseconde près serait inventer
 * une précision que le contrat n'offre pas. Fuseau : AUCUNE conversion n'a lieu dans ce correctif —
 * `detentionOuverte.du` et `entree.dateLivraisonEffective` sont comparés comme deux CHAÎNES
 * `aaaa-mm-jj` telles que reçues, jamais reconstruites en `Date`/UTC côté serveur. C'est
 * délibéré : construire un `Date` à partir d'une `schemaDateJour` (ex. `new Date('2026-08-06')`)
 * l'ancre à minuit UTC, alors que « aujourd'hui » n'a de sens qu'en Europe/Zurich pour un comptoir
 * suisse — une comparaison naïve en UTC décalerait la frontière de minuit et rendrait le bug
 * intermittent selon l'heure de la journée (pire que le défaut actuel). En ne touchant JAMAIS ces
 * deux chaînes, le correctif est structurellement immunisé contre ce décalage, quelle que soit
 * l'heure UTC de `this.horloge.maintenant()` au moment de l'appel (vérifié ci-dessous, cas « bornes
 * du fuseau »).
 */
describe('ServiceDossierVente.livrer — issue #13 : livraison le jour même d’une détention déjà ouverte', () => {
  it(
    'détention ouverte CE MÊME jour (quelques heures plus tôt) : transfert du détenteur sur la ' +
      'MÊME ligne — ni clôture (`au`/`motifFin`), ni nouvelle ligne, `du` jamais modifié',
    async () => {
      vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
      vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
        vehiculeStockVenduFixture(),
      );
      vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(null);
      vi.mocked(references.chargerDossierVente).mockResolvedValue(
        dossierFixture({ statut: 'livre' }),
      );

      // La détention a été ouverte le jour même (`du` = `dateLivraisonEffective` = '2026-08-01'),
      // par ex. à 09h12 — l'heure réelle n'apparaît nulle part côté `du` (colonne `date`), ce test
      // n'en a donc pas besoin pour prouver que ce n'est PAS traité comme un conflit.
      const { tx, insertCalls, updateCalls } = txFactice([
        [{ id: 'detention-meme-jour', du: '2026-08-01' }],
      ]);
      const svc = serviceFactice(accesFactice(tx));

      // Ne doit PAS rejeter — c'est exactement le 400 constaté par l'issue #13 sur cette même
      // configuration (détention ouverte le jour même) avant le correctif.
      await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

      const updatesDetention = updateCalls.filter((c) => c.table === vehiculeDetention);
      expect(updatesDetention).toHaveLength(1);
      // Transfert du détenteur EN PLACE : uniquement `clientId`, ni `au` ni `motifFin` — la ligne
      // reste ouverte, `du` (déjà enregistré) n'est jamais réécrit.
      expect(updatesDetention[0]?.champs).toStrictEqual({ clientId: 'client-acheteur-1' });

      // Aucune nouvelle ligne `vehicule_detention` : contrairement au cas général, ce jour est
      // absorbé par la ligne déjà ouverte (deux lignes distinctes pour le même jour civil
      // violeraient de toute façon `vehicule_detention_unicite_excl`).
      expect(insertCalls.filter((c) => c.table === vehiculeDetention)).toHaveLength(0);
    },
  );

  it(
    'détention ouverte AVANT ce jour (cas général, non régressé) : clôture (`au`/`motifFin` = ' +
      "`vente`) PUIS ouverture d'une nouvelle ligne pour le nouveau détenteur",
    async () => {
      vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
      vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
        vehiculeStockVenduFixture(),
      );
      vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(null);
      vi.mocked(references.chargerDossierVente).mockResolvedValue(
        dossierFixture({ statut: 'livre' }),
      );

      const { tx, insertCalls, updateCalls } = txFactice([
        [{ id: 'detention-passee', du: '2026-07-20' }],
      ]);
      const svc = serviceFactice(accesFactice(tx));

      await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

      const updatesDetention = updateCalls.filter((c) => c.table === vehiculeDetention);
      expect(updatesDetention).toHaveLength(1);
      expect(updatesDetention[0]?.champs).toStrictEqual({
        au: '2026-08-01',
        motifFin: 'vente',
      });

      const nouvelleDetention = insertCalls.find((c) => c.table === vehiculeDetention);
      expect(nouvelleDetention?.valeurs).toMatchObject({
        vehiculeId: VEHICULE_VENDU_ID,
        clientId: 'client-acheteur-1',
        du: '2026-08-01',
      });
    },
  );

  it(
    'bornes du fuseau : le résultat ne dépend QUE des chaînes `du`/`dateLivraisonEffective`, ' +
      'jamais de l’instant UTC de `horloge.maintenant()` — même juste avant/après minuit',
    async () => {
      // `maintenant()` posé à 22h50 UTC, soit déjà après minuit à Zurich (CEST, UTC+2, l'été) —
      // si le correctif reconstruisait une `Date` UTC quelque part pour comparer les jours, cette
      // horloge-là ferait basculer le jour retenu et casserait le cas « même jour ». Il ne le fait
      // pas : `du`/`dateLivraisonEffective` restent comparés en chaînes brutes, immunisés.
      const horlogeProcheMinuitUtc: Horloge = {
        maintenant: () => new Date('2026-08-01T22:50:00.000Z'),
      } as unknown as Horloge;

      vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
      vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
        vehiculeStockVenduFixture(),
      );
      vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(null);
      vi.mocked(references.chargerDossierVente).mockResolvedValue(
        dossierFixture({ statut: 'livre' }),
      );

      const { tx, insertCalls, updateCalls } = txFactice([
        [{ id: 'detention-meme-jour', du: '2026-08-01' }],
      ]);
      const acces = accesFactice(tx);
      const svc = new ServiceDossierVente(
        acces as never,
        {} as never,
        {} as never,
        horlogeProcheMinuitUtc,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(svc as any, 'assembler').mockResolvedValue({} as never);

      await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

      const updatesDetention = updateCalls.filter((c) => c.table === vehiculeDetention);
      expect(updatesDetention).toHaveLength(1);
      expect(updatesDetention[0]?.champs).toStrictEqual({ clientId: 'client-acheteur-1' });
      expect(insertCalls.filter((c) => c.table === vehiculeDetention)).toHaveLength(0);
    },
  );
});

/**
 * DÉFAUT CORRIGÉ (tests d'intégration) : `preparer`, `marquerPretALivrer` et `cloturer` n'avaient
 * AUCUNE garde applicative de rejeu — contrairement à `engager`/`livrer`, qui échouent déjà
 * indirectement via l'état du véhicule associé. Le trigger générique `verifier_transition()`
 * (`0003_prealables_etape1.sql`) traite un UPDATE qui réécrit LE MÊME statut comme un non-événement
 * (`old.statut is not distinct from new.statut`) et ne consulte alors jamais
 * `transition_autorisee` : un second appel une fois la cible déjà atteinte ne bougeait que
 * l'horodatage, en silence, sans jamais lever `ZDFA1`. Ces trois méthodes vérifient désormais
 * explicitement le statut de départ attendu AVANT toute écriture.
 */
describe('ServiceDossierVente — garde de rejeu explicite (preparer/marquerPretALivrer/cloturer)', () => {
  it('preparer refuse un rejeu (dossier déjà en_preparation) avec VENTE_DOSSIER_TRANSITION_INTERDITE, sans écrire', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(
      dossierFixture({ statut: 'en_preparation' }),
    );
    const { tx, updateCalls } = txFactice();
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.preparer(CTX, 'direction', DOSSIER_ID, {})).rejects.toMatchObject({
      code: 'VENTE_DOSSIER_TRANSITION_INTERDITE',
    });
    expect(updateCalls).toHaveLength(0);
  });

  it('preparer transitionne normalement depuis engage (comportement légitime non cassé)', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(
      dossierFixture({ statut: 'engage' }),
    );
    vi.mocked(references.chargerDossierVente).mockResolvedValue(
      dossierFixture({ statut: 'en_preparation' }),
    );
    const { tx, updateCalls } = txFactice();
    const svc = serviceFactice(accesFactice(tx));

    await svc.preparer(CTX, 'direction', DOSSIER_ID, {});

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.champs).toMatchObject({ statut: 'en_preparation' });
  });

  it('marquerPretALivrer refuse un rejeu (dossier déjà pret_a_livrer) avec VENTE_DOSSIER_TRANSITION_INTERDITE, sans écrire', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(
      dossierFixture({ statut: 'pret_a_livrer' }),
    );
    const { tx, updateCalls } = txFactice();
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.marquerPretALivrer(CTX, 'direction', DOSSIER_ID, {})).rejects.toMatchObject({
      code: 'VENTE_DOSSIER_TRANSITION_INTERDITE',
    });
    // La garde de rejeu échoue AVANT même la vérification du financement (RV-37) : aucune écriture.
    expect(updateCalls).toHaveLength(0);
  });

  it('marquerPretALivrer refuse un rejeu même depuis un statut plus ancien (engage) — le préalable reste engage/en_preparation uniquement', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(
      dossierFixture({ statut: 'engage' }),
    );
    const { tx, updateCalls } = txFactice();
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.marquerPretALivrer(CTX, 'direction', DOSSIER_ID, {})).rejects.toMatchObject({
      code: 'VENTE_DOSSIER_TRANSITION_INTERDITE',
    });
    expect(updateCalls).toHaveLength(0);
  });

  it('cloturer refuse un rejeu (dossier déjà clos) avec VENTE_DOSSIER_TRANSITION_INTERDITE, sans écrire', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(
      dossierFixture({ statut: 'clos' }),
    );
    const { tx, updateCalls } = txFactice();
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.cloturer(CTX, 'direction', DOSSIER_ID, {})).rejects.toMatchObject({
      code: 'VENTE_DOSSIER_TRANSITION_INTERDITE',
    });
    expect(updateCalls).toHaveLength(0);
  });

  it('cloturer transitionne normalement depuis livre (comportement légitime non cassé)', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(
      dossierFixture({ statut: 'livre' }),
    );
    vi.mocked(references.chargerDossierVente).mockResolvedValue(dossierFixture({ statut: 'clos' }));
    const { tx, updateCalls } = txFactice();
    const svc = serviceFactice(accesFactice(tx));

    await svc.cloturer(CTX, 'direction', DOSSIER_ID, {});

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.champs).toMatchObject({ statut: 'clos' });
  });
});

/**
 * Bug corrigé (audit 2026-08-04) : `estViolationCleUniqueVehiculeStock` testait `erreur.code` au
 * premier niveau, mais Drizzle enveloppe SYSTÉMATIQUEMENT l'erreur `pg` brute dans une
 * `DrizzleQueryError` (`code` sous `.cause`, jamais en surface) — une course concurrente sur
 * `vehicule_stock.id` au moment de la mise en stock automatique d'une reprise confirmée rendait
 * donc 500 `ERREUR_INTERNE` au lieu de 409 `VENTE_VEHICULE_STOCK_DEJA_EXISTANT`. Voir
 * `common/erreurs-pg/remonter-cause-pg.ts`.
 */
describe('estViolationCleUniqueVehiculeStock', () => {
  it('reconnaît un 23505 enveloppé sous .cause (forme réelle Drizzle)', () => {
    const brute = new Error('duplicate key') as Error & { code: string };
    brute.code = '23505';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationCleUniqueVehiculeStock(enveloppee)).toBe(true);
  });

  it('ne reconnaît pas un autre SQLSTATE enveloppé (ex. 23503, contrainte non concernée)', () => {
    const brute = new Error('foreign key violation') as Error & { code: string };
    brute.code = '23503';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationCleUniqueVehiculeStock(enveloppee)).toBe(false);
  });
});
