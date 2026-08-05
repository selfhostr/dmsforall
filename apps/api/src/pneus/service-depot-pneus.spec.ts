import { describe, expect, it, vi } from 'vitest';
import type {
  EntreeCreationDepotPneus,
  FiltresARelancerPneus,
  FiltresDepotsPneusVehicule,
  FiltresHangarPneus,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import type { LigneDepotPneus } from '../db/schema';
import { estViolationFk, estViolationUniciteActif, ServiceDepotPneus } from './service-depot-pneus';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const CTX_AUTRE_TENANT: ContexteTenant = {
  tenantId: 'tid-2',
  utilisateurId: 'u2',
  requeteId: null,
};

function ligneDepot(champs: Partial<LigneDepotPneus> = {}): LigneDepotPneus {
  return {
    id: 'd1',
    tenantId: 'tid-1',
    vehiculeId: 'v1',
    siteId: 's1',
    saison: 'ete',
    statut: 'en_depot',
    codeCase: null,
    dimension: '205/55 R16',
    etat: null,
    entreLe: new Date('2026-04-01T08:00:00.000Z'),
    dernierMouvementLe: new Date('2026-04-01T08:00:00.000Z'),
    motifSortie: null,
    ligneOrDernierChangementId: null,
    creeLe: new Date('2026-04-01T08:00:00.000Z'),
    modifieLe: new Date('2026-04-01T08:00:00.000Z'),
    ...champs,
  } as LigneDepotPneus;
}

/**
 * Fausse transaction — même patron que `pieces/service-mouvement.spec.ts` (en-tête de ce
 * fichier) : `select().from().where().limit()` rend, DANS L'ORDRE, les jeux de `selects`
 * (`chargerVehiculeOu404`/`chargerSiteOu404`) ; `execute()` rend, dans l'ordre, les jeux
 * d'`executes` (tout le reste : listes, verrous, transitions) ; `insert().values().returning()`
 * rend soit la ligne posée par `poserRetourInsert`, soit rejette `erreurInsertion` si fournie
 * (simule une violation de contrainte SANS vraie base).
 */
function txFactice(
  plan: {
    selects?: readonly unknown[][];
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
    erreurInsertion?: unknown;
  } = {},
) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const insertsReturning: unknown[][] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selects.shift() ?? []) }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_vals: Record<string, unknown>) => ({
        returning: () => {
          if (plan.erreurInsertion) return Promise.reject(plan.erreurInsertion);
          return Promise.resolve(insertsReturning.shift() ?? []);
        },
      }),
    }),
    execute: vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] })),
  };

  return {
    tx: tx as unknown as TransactionDfa,
    poserRetourInsert: (lignes: unknown[]) => insertsReturning.push(lignes),
  };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

function idempotenceFactice(tx: TransactionDfa): ServiceIdempotence {
  return {
    async executer<T extends ReponseMemorisable>(
      _ctx: ContexteTenant,
      _requete: RequeteIdempotente,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<ResultatIdempotent<T>> {
      const reponse = await travail(tx);
      return { reponse, rejoue: false };
    },
  };
}

const FILTRES_HANGAR_DEFAUT: FiltresHangarPneus = { limite: 50, tri: 'dernierMouvementLe:desc' };
const FILTRES_VEHICULE_DEFAUT: FiltresDepotsPneusVehicule = { limite: 50, tri: 'entreLe:desc' };
const FILTRES_RELANCE_DEFAUT: FiltresARelancerPneus = { limite: 50, tri: 'dernierMouvementLe:asc' };

const ENTREE_CREATION: EntreeCreationDepotPneus = { siteId: 's1', saison: 'ete' };

describe('ServiceDepotPneus — isolation tenant : toute lecture/écriture passe par enTenant(ctx)', () => {
  it('hangar() scope via enTenant() avec EXACTEMENT le contexte reçu, jamais un autre tenant', async () => {
    const { tx } = txFactice({ selects: [[{ id: 's1' }]], executes: [{ rows: [] }, { rows: [] }] });
    const acces = accesFactice(tx);
    const service = new ServiceDepotPneus(acces, idempotenceFactice(tx));

    await service.hangar(CTX, 's1', FILTRES_HANGAR_DEFAUT);

    expect(acces.enTenant).toHaveBeenCalledTimes(1);
    expect((acces.enTenant as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(CTX);
    expect((acces.enTenant as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).not.toBe(
      CTX_AUTRE_TENANT,
    );
  });
});

describe('ServiceDepotPneus.creer — RPP-01, RPP-02', () => {
  it('recopie la dimension depuis vehicule.pneusEte quand dimension est omise', async () => {
    const { tx, poserRetourInsert } = txFactice({
      selects: [
        [{ id: 'v1', pneusEte: '205/55 R16', pneusHiver: '205/55 R16 (hiver)' }], // chargerVehiculeOu404
        [{ id: 's1' }], // chargerSiteOu404
      ],
    });
    poserRetourInsert([ligneDepot({ dimension: '205/55 R16' })]);
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.creer(CTX, 'v1', ENTREE_CREATION, 'idem-1');

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.dimension).toBe('205/55 R16');
  });

  it('404 RESSOURCE_INTROUVABLE quand le véhicule est introuvable pour ce tenant', async () => {
    const { tx } = txFactice({ selects: [[]] });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.creer(CTX, 'v-inconnu', ENTREE_CREATION, 'idem-1')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('refuse (409 CONFLIT) un second jeu actif pour le même véhicule et la même saison (RPP-02, depot_pneus_actif_uk)', async () => {
    const brute = new Error('duplicate key') as Error & { code: string; constraint: string };
    brute.code = '23505';
    brute.constraint = 'depot_pneus_actif_uk';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    const { tx } = txFactice({
      selects: [[{ id: 'v1', pneusEte: null, pneusHiver: null }], [{ id: 's1' }]],
      erreurInsertion: enveloppee,
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.creer(CTX, 'v1', ENTREE_CREATION, 'idem-1')).rejects.toMatchObject({
      code: 'CONFLIT',
      status: 409,
    });
  });
});

describe('estViolationUniciteActif / estViolationFk — traduction SQLSTATE (Drizzle enveloppe sous .cause)', () => {
  it('estViolationUniciteActif reconnaît un 23505 sur depot_pneus_actif_uk enveloppé sous .cause', () => {
    const brute = new Error('duplicate key') as Error & { code: string; constraint: string };
    brute.code = '23505';
    brute.constraint = 'depot_pneus_actif_uk';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationUniciteActif(enveloppee)).toBe(true);
  });

  it('estViolationUniciteActif ignore un 23505 sur une AUTRE contrainte', () => {
    const brute = new Error('duplicate key') as Error & { code: string; constraint: string };
    brute.code = '23505';
    brute.constraint = 'depot_pneus_pk';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationUniciteActif(enveloppee)).toBe(false);
  });

  it('estViolationFk reconnaît un 23503 enveloppé sous .cause', () => {
    const brute = new Error('fk violation') as Error & { code: string };
    brute.code = '23503';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationFk(enveloppee)).toBe(true);
  });
});

describe('ServiceDepotPneus — cycle complet d’un dépôt : entrée → monté → sorti', () => {
  it('entrée (en_depot) → changer-saison (monte) → sortir (sorti, motif tracé)', async () => {
    // 1. Entrée en dépôt.
    const { tx: txCreation, poserRetourInsert } = txFactice({
      selects: [[{ id: 'v1', pneusEte: '205/55 R16', pneusHiver: null }], [{ id: 's1' }]],
    });
    poserRetourInsert([ligneDepot({ statut: 'en_depot' })]);
    const serviceCreation = new ServiceDepotPneus(
      accesFactice(txCreation),
      idempotenceFactice(txCreation),
    );
    const cree = await serviceCreation.creer(CTX, 'v1', ENTREE_CREATION, 'idem-1');
    expect(cree.reponse.corps.statut).toBe('en_depot');

    // 2. Changement de saison : en_depot → monte. Aucun jumeau (jeu hiver jamais entré).
    const { tx: txSaison } = txFactice({
      executes: [
        { rows: [ligneDepot({ statut: 'en_depot' })] }, // chargerOu404 (cible)
        { rows: [] }, // trouverJumeauActif : aucun jumeau
        { rows: [ligneDepot({ statut: 'en_depot' })] }, // chargerPourVerrouOu404 (cible, verrou)
        { rows: [] }, // UPDATE cible → monte
        { rows: [ligneDepot({ statut: 'monte' })] }, // chargerOu404 (reload)
      ],
    });
    const serviceSaison = new ServiceDepotPneus(
      accesFactice(txSaison),
      idempotenceFactice(txSaison),
    );
    const monte = await serviceSaison.changerSaison(CTX, 'd1', {});
    expect(monte.statut).toBe('monte');

    // 3. Sortie : motif obligatoire, statut TERMINAL.
    const { tx: txSortie } = txFactice({
      executes: [
        { rows: [ligneDepot({ statut: 'monte' })] }, // chargerPourVerrouOu404
        { rows: [] }, // UPDATE → sorti
        { rows: [ligneDepot({ statut: 'sorti', motifSortie: 'rendu_au_client' })] }, // reload
      ],
    });
    const serviceSortie = new ServiceDepotPneus(
      accesFactice(txSortie),
      idempotenceFactice(txSortie),
    );
    const sorti = await serviceSortie.sortir(CTX, 'd1', { motif: 'rendu_au_client' });
    expect(sorti.statut).toBe('sorti');
    expect(sorti.motifSortie).toBe('rendu_au_client');
  });

  it('refuse (409 CONFLIT) de sortir un dépôt déjà sorti — jamais une seconde sortie', async () => {
    const { tx } = txFactice({
      executes: [{ rows: [ligneDepot({ statut: 'sorti', motifSortie: 'autre' })] }],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.sortir(CTX, 'd1', { motif: 'rendu_au_client' })).rejects.toMatchObject({
      code: 'CONFLIT',
      status: 409,
    });
    // Un seul appel execute (le SELECT ... FOR UPDATE) : aucun UPDATE émis.
    expect((tx.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('ServiceDepotPneus.changerSaison — RPP-03 : inverse la paire été/hiver quand le jumeau existe', () => {
  it('bascule le jumeau actif (saison opposée) dans le même appel', async () => {
    const cible = ligneDepot({ id: 'd1', vehiculeId: 'v1', saison: 'ete', statut: 'monte' });
    const jumeau = ligneDepot({ id: 'd2', vehiculeId: 'v1', saison: 'hiver', statut: 'en_depot' });

    const { tx } = txFactice({
      executes: [
        { rows: [cible] }, // chargerOu404 (cible)
        { rows: [jumeau] }, // trouverJumeauActif
        { rows: [cible] }, // chargerPourVerrouOu404('d1') — 'd1' < 'd2', verrouillé en premier
        { rows: [jumeau] }, // chargerPourVerrouOu404('d2')
        { rows: [] }, // UPDATE cible → en_depot
        { rows: [] }, // UPDATE jumeau → monte
        { rows: [ligneDepot({ id: 'd1', statut: 'en_depot' })] }, // reload
      ],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.changerSaison(CTX, 'd1', { ligneOrId: 'lo1' });

    expect(resultat.statut).toBe('en_depot');
    expect((tx.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(7);
  });

  it('refuse (409 CONFLIT) un dépôt déjà "sorti" ou "a_relancer" (transition hors RPP-03)', async () => {
    const { tx } = txFactice({ executes: [{ rows: [ligneDepot({ statut: 'a_relancer' })] }] });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.changerSaison(CTX, 'd1', {})).rejects.toMatchObject({
      code: 'CONFLIT',
      status: 409,
    });
  });
});

describe('ServiceDepotPneus — dépôt orphelin quand le véhicule est vendu (RPP-06)', () => {
  it('parVehicule() ne filtre JAMAIS sur le statut du véhicule — un jeu reste consultable après vente/archivage', async () => {
    // `chargerVehiculeOu404` ne sélectionne que id/pneusEte/pneusHiver (voir service) : aucune
    // colonne `statut` n'entre dans la vérification d'existence, donc un véhicule `vendu` ou
    // `archive` (jamais supprimé, RPP-06 : « pas transféré automatiquement, pas de suppression »)
    // continue de rendre son historique de dépôts sans erreur ni filtrage silencieux.
    const jeuAbandonne = ligneDepot({ statut: 'a_relancer' });
    const { tx } = txFactice({
      selects: [[{ id: 'v1', pneusEte: null, pneusHiver: null }]], // chargerVehiculeOu404 — pas de `statut`
      executes: [
        { rows: [] }, // appliquerRelancesEnRetard (UPDATE, sans effet ici)
        { rows: [{ ...jeuAbandonne, triValeur: jeuAbandonne.entreLe.toISOString() }] }, // liste
      ],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.parVehicule(CTX, 'v1', FILTRES_VEHICULE_DEFAUT);

    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.statut).toBe('a_relancer');
  });
});

describe('ServiceDepotPneus.deplacer — défaut n°2 : le repère de rangement (codeCase, RPP-07) devient modifiable après la création', () => {
  it('modifie codeCase et met à jour dernierMouvementLe (un déplacement est un mouvement, RPP-04)', async () => {
    const avant = ligneDepot({ id: 'd1', statut: 'en_depot', codeCase: 'A12' });
    const apres = ligneDepot({
      id: 'd1',
      statut: 'en_depot',
      codeCase: 'B03',
      dernierMouvementLe: new Date('2026-08-05T09:00:00.000Z'),
    });
    const { tx } = txFactice({
      executes: [
        { rows: [avant] }, // chargerPourVerrouOu404
        { rows: [] }, // UPDATE code_case
        { rows: [apres] }, // chargerOu404 (reload)
      ],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.deplacer(CTX, 'd1', { codeCase: 'B03' });

    expect(resultat.codeCase).toBe('B03');
    expect(resultat.dernierMouvementLe).toBe('2026-08-05T09:00:00.000Z');
    expect((tx.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('accepte codeCase null — retrait du repère, sans erreur', async () => {
    const avant = ligneDepot({ id: 'd1', statut: 'monte', codeCase: 'A12' });
    const apres = ligneDepot({ id: 'd1', statut: 'monte', codeCase: null });
    const { tx } = txFactice({
      executes: [{ rows: [avant] }, { rows: [] }, { rows: [apres] }],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.deplacer(CTX, 'd1', { codeCase: null });

    expect(resultat.codeCase).toBeNull();
  });

  it('refuse (409 CONFLIT) de déplacer un dépôt déjà "sorti" — RPP-05, statut TERMINAL', async () => {
    const { tx } = txFactice({
      executes: [{ rows: [ligneDepot({ statut: 'sorti', motifSortie: 'vehicule_vendu' })] }],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.deplacer(CTX, 'd1', { codeCase: 'B03' })).rejects.toMatchObject({
      code: 'CONFLIT',
      status: 409,
    });
    // Un seul appel execute (le SELECT ... FOR UPDATE) : aucun UPDATE émis sur un dépôt sorti.
    expect((tx.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('404 RESSOURCE_INTROUVABLE quand le dépôt est introuvable pour ce tenant', async () => {
    const { tx } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.deplacer(CTX, 'd-inconnu', { codeCase: 'B03' })).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });
});

describe('ServiceDepotPneus — pagination par curseur', () => {
  it('hangar() : limite+1 lignes rendues → curseurSuivant non nul, une seule page de `limite` éléments', async () => {
    const lignes = [1, 2, 3].map((n) =>
      ligneDepot({ id: `d${n}`, entreLe: new Date(`2026-04-0${n}T08:00:00.000Z`) }),
    );
    const avecTri = lignes.map((l) => ({ ...l, triValeur: l.dernierMouvementLe.toISOString() }));

    const { tx } = txFactice({
      selects: [[{ id: 's1' }]],
      executes: [{ rows: [] }, { rows: avecTri }], // relance, puis liste (limite=2 → 3 lignes = page pleine)
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.hangar(CTX, 's1', {
      limite: 2,
      tri: 'dernierMouvementLe:desc',
    });

    expect(page.donnees).toHaveLength(2);
    expect(page.curseurSuivant).not.toBeNull();
    expect(page.limite).toBe(2);
  });

  it('hangar() : moins de `limite` lignes rendues → curseurSuivant nul (fin de liste)', async () => {
    const ligne = ligneDepot();
    const { tx } = txFactice({
      selects: [[{ id: 's1' }]],
      executes: [
        { rows: [] },
        { rows: [{ ...ligne, triValeur: ligne.dernierMouvementLe.toISOString() }] },
      ],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.hangar(CTX, 's1', {
      limite: 50,
      tri: 'dernierMouvementLe:desc',
    });

    expect(page.donnees).toHaveLength(1);
    expect(page.curseurSuivant).toBeNull();
  });

  it('aRelancer() : pagine de la même façon, filtrée sur statut = a_relancer', async () => {
    const ligne = ligneDepot({ statut: 'a_relancer' });
    const { tx } = txFactice({
      executes: [
        { rows: [] },
        { rows: [{ ...ligne, triValeur: ligne.dernierMouvementLe.toISOString() }] },
      ],
    });
    const service = new ServiceDepotPneus(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.aRelancer(CTX, FILTRES_RELANCE_DEFAUT);

    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.statut).toBe('a_relancer');
  });

  /**
   * Défaut n°1 — reproduction au niveau service (complète `pagination-triee.spec.ts`, qui teste
   * `decoderCurseurPourTri` isolément). Un curseur v2 syntaxiquement valide (bon tri, uuid valide)
   * mais dont la valeur n'est pas un timestamptz PostgreSQL bien formé produisait `500
   * ERREUR_INTERNE` : la valeur atteignait la requête SQL sans jamais être revalidée, et
   * PostgreSQL levait une erreur native non interceptée. Ce test prouve que le rejet se produit
   * MAINTENANT, et qu'il se produit AVANT tout accès base (`acces.enTenant` jamais appelé) — pas
   * seulement avant le `SELECT` de liste : `decoderCurseurPourTri` s'exécute dans `hangar()` avant
   * même l'ouverture de la transaction.
   */
  it('hangar() : curseur syntaxiquement valide mais valeur non temporelle → 400 AVANT tout accès base (c’était 500)', async () => {
    const curseurForge = Buffer.from(
      JSON.stringify({
        t: 'dernierMouvementLe:desc',
        v: 'not-a-real-timestamp',
        i: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
      }),
      'utf8',
    ).toString('base64url');
    const { tx } = txFactice();
    const acces = accesFactice(tx);
    const service = new ServiceDepotPneus(acces, idempotenceFactice(tx));

    await expect(
      service.hangar(CTX, 's1', {
        limite: 50,
        tri: 'dernierMouvementLe:desc',
        curseur: curseurForge,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });
});
