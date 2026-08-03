import { describe, expect, it, vi } from 'vitest';
import type {
  EntreeAnnulationCommandeFournisseur,
  EntreeAnnulationReliquat,
  EntreeReceptionCommandeFournisseur,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import type { LigneCommandeFournisseur, LigneCommandeFournisseurLigne } from '../db/schema';
import { ServiceCommandeFournisseur } from './service-commande-fournisseur';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function commande(champs: Partial<LigneCommandeFournisseur> = {}): LigneCommandeFournisseur {
  return {
    id: 'cmd-1',
    tenantId: 'tid-1',
    fournisseurId: 'four-1',
    siteId: 'site-1',
    statut: 'envoyee',
    origine: 'manuelle',
    dateCommande: '2026-07-01',
    envoyeeLe: new Date('2026-07-01T08:00:00.000Z'),
    reference: null,
    motifAnnulation: null,
    creeLe: new Date('2026-07-01T08:00:00.000Z'),
    modifieLe: new Date('2026-07-01T08:00:00.000Z'),
    ...champs,
  } as LigneCommandeFournisseur;
}

function ligne(champs: Partial<LigneCommandeFournisseurLigne> = {}): LigneCommandeFournisseurLigne {
  return {
    id: 'ligne-1',
    tenantId: 'tid-1',
    commandeFournisseurId: 'cmd-1',
    numeroOrdre: 1,
    articleId: 'art-1',
    quantiteCommandeeMillieme: 10000,
    quantiteRecueCumuleeMillieme: 0,
    reliquatAnnuleLe: null,
    reliquatMotifAnnulation: null,
    prixAchatAttenduCentimes: 1000,
    ligneOrOrigineId: null,
    creeLe: new Date('2026-07-01T08:00:00.000Z'),
    modifieLe: new Date('2026-07-01T08:00:00.000Z'),
    ...champs,
  } as LigneCommandeFournisseurLigne;
}

/**
 * Fausse transaction hybride : `select().from().where()` rend, dans l'ordre, les jeux de
 * `selects` (query-builder Drizzle — chargement d'existence, rechargement post-écriture) ;
 * `execute()` rend, dans l'ordre, les jeux de `executes` (SQL brut — verrous `for update`,
 * `UPDATE` sans `RETURNING`, jointure `estReferenceEquivalente`) ; `insert().values()` est
 * awaitable directement (insertion des lignes, sans `.returning()`) ET expose `.returning()`
 * (insertion de la commande / du mouvement de stock).
 */
function txFactice(
  plan: {
    selects?: readonly unknown[][];
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
    insertsReturning?: readonly unknown[][];
  } = {},
) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const insertsReturning = [...(plan.insertsReturning ?? [])];
  const insertValuesArgs: unknown[] = [];
  const executeAppels: unknown[] = [];

  function chaineWhere() {
    const valeur = Promise.resolve(selects.shift() ?? []);
    return {
      limit: () => valeur,
      orderBy: () => valeur,
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        valeur.then(resolve, reject),
    };
  }

  const tx = {
    select: () => ({ from: () => ({ where: () => chaineWhere() }) }),
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        insertValuesArgs.push(vals);
        const promesse = Promise.resolve(insertsReturning.shift() ?? []);
        return {
          returning: () => promesse,
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            promesse.then(resolve, reject),
        };
      },
    }),
    execute: vi.fn((requete: unknown) => {
      executeAppels.push(requete);
      return Promise.resolve(executes.shift() ?? { rows: [] });
    }),
  };

  return { tx: tx as unknown as TransactionDfa, insertValuesArgs, executeAppels };
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

describe('ServiceCommandeFournisseur.envoyer — §6.2 : brouillon → envoyee', () => {
  it('refuse (409 COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE) une commande qui n’est pas en brouillon, sans écrire', async () => {
    const { tx, executeAppels } = txFactice({
      executes: [{ rows: [commande({ statut: 'envoyee' })] }],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.envoyer(CTX, 'cmd-1')).rejects.toMatchObject({
      code: 'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
      status: 409,
    });
    // Un seul execute (le SELECT ... FOR UPDATE) : aucun UPDATE.
    expect(executeAppels).toHaveLength(1);
  });

  it('brouillon : passe envoyee, renseigne envoyeeLe', async () => {
    const { tx } = txFactice({
      executes: [
        { rows: [commande({ statut: 'brouillon', envoyeeLe: null })] }, // FOR UPDATE
        { rows: [] }, // UPDATE
      ],
      selects: [
        [commande({ statut: 'envoyee' })], // chargerCommandeOu404 (reload)
        [ligne()], // chargerLignesParCommande
      ],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.envoyer(CTX, 'cmd-1');

    expect(resultat.donnees.statut).toBe('envoyee');
  });
});

describe('ServiceCommandeFournisseur.reception — RP-27/RP-29, le point de jonction avec le stock (§7.4)', () => {
  const ENTREE: EntreeReceptionCommandeFournisseur = {
    lignes: [{ ligneId: 'ligne-1', quantiteRecueMillieme: 6000, prixAchatReelCentimes: 1200 }],
  };

  it('réception partielle (6000/10000) : insère un mouvement entree_livraison de la quantité REÇUE, incrémente le cumul, commande → partiellement_recue', async () => {
    const { tx, insertValuesArgs } = txFactice({
      executes: [
        { rows: [commande({ statut: 'envoyee' })] }, // chargerCommandeOu404PourVerrou
        { rows: [ligne()] }, // chargerLignesPourVerrou
        { rows: [] }, // UPDATE commande_fournisseur_ligne (cumul)
        { rows: [] }, // ecrireStatutCommande → partiellement_recue
      ],
      insertsReturning: [
        [{ id: 'mvt-1', articleId: 'art-1', type: 'entree_livraison', quantiteMillieme: 6000 }],
      ],
      selects: [
        [commande({ statut: 'partiellement_recue' })], // chargerCommandeAvecLignes → chargerCommandeOu404
        [ligne({ quantiteRecueCumuleeMillieme: 6000 })], // chargerLignesParCommande
      ],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.reception(CTX, 'cmd-1', ENTREE, 'idem-1');

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.donnees.mouvementsCrees).toEqual(['mvt-1']);
    expect(resultat.reponse.corps.donnees.commandeFournisseur.statut).toBe('partiellement_recue');
    expect(resultat.reponse.corps.avertissements).toHaveLength(0);

    // PREUVE PAR FALSIFICATION (voir rapport de livraison) : le mouvement inséré porte la
    // quantité EFFECTIVEMENT reçue (6000, celle du corps de la requête), PAS la quantité
    // commandée (10000) ni le reliquat avant réception (10000) — casser cette ligne dans
    // `service-commande-fournisseur.ts::reception` (ex. remplacer `ligneEntree.quantiteRecueMillieme`
    // par `reliquatAvant`) fait rougir cette assertion à `10000 !== 6000`.
    const mouvementInsere = insertValuesArgs.find(
      (v) => (v as { type?: string }).type === 'entree_livraison',
    ) as
      | {
          quantiteMillieme: number;
          articleId: string;
          commandeFournisseurLigneId: string;
          siteId: string;
          prixAchatReelCentimes: number | null;
        }
      | undefined;
    expect(mouvementInsere?.quantiteMillieme).toBe(6000);
    expect(mouvementInsere?.articleId).toBe('art-1');
    expect(mouvementInsere?.commandeFournisseurLigneId).toBe('ligne-1');
    expect(mouvementInsere?.siteId).toBe('site-1');
    expect(mouvementInsere?.prixAchatReelCentimes).toBe(1200);
  });

  it('réception qui solde le reliquat en un seul geste (envoyee → recue directement, RP-27)', async () => {
    const ENTREE_COMPLETE: EntreeReceptionCommandeFournisseur = {
      lignes: [{ ligneId: 'ligne-1', quantiteRecueMillieme: 10000 }],
    };
    const { tx } = txFactice({
      executes: [
        { rows: [commande({ statut: 'envoyee' })] },
        { rows: [ligne()] },
        { rows: [] },
        { rows: [] }, // ecrireStatutCommande → recue (un seul saut, envoyee -> recue est une transition directe légale)
      ],
      insertsReturning: [[{ id: 'mvt-2' }]],
      selects: [[commande({ statut: 'recue' })], [ligne({ quantiteRecueCumuleeMillieme: 10000 })]],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.reception(CTX, 'cmd-1', ENTREE_COMPLETE, 'idem-2');

    expect(resultat.reponse.corps.donnees.commandeFournisseur.statut).toBe('recue');
  });

  it('quantité reçue qui dépasse le reliquat restant : avertissement RECEPTION_EXCEDENT_RELIQUAT, jamais bloquant (§7.4)', async () => {
    const ENTREE_EXCEDENT: EntreeReceptionCommandeFournisseur = {
      lignes: [{ ligneId: 'ligne-1', quantiteRecueMillieme: 6000 }],
    };
    const { tx } = txFactice({
      executes: [
        { rows: [commande({ statut: 'partiellement_recue' })] },
        { rows: [ligne({ quantiteRecueCumuleeMillieme: 8000 })] }, // reliquat avant = 2000
        { rows: [] },
        { rows: [] },
      ],
      insertsReturning: [[{ id: 'mvt-3' }]],
      selects: [[commande({ statut: 'recue' })], [ligne({ quantiteRecueCumuleeMillieme: 10000 })]],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.reception(CTX, 'cmd-1', ENTREE_EXCEDENT, 'idem-3');

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.avertissements).toHaveLength(1);
    expect(resultat.reponse.corps.avertissements[0]?.code).toBe('RECEPTION_EXCEDENT_RELIQUAT');
  });

  it('refuse (409) la réception d’une commande brouillon (jamais envoyée)', async () => {
    const { tx, executeAppels } = txFactice({
      executes: [{ rows: [commande({ statut: 'brouillon' })] }],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.reception(CTX, 'cmd-1', ENTREE, 'idem-4')).rejects.toMatchObject({
      code: 'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
    });
    expect(executeAppels).toHaveLength(1);
  });

  it('refuse (404) une ligneId qui n’appartient pas à cette commande', async () => {
    const { tx } = txFactice({
      executes: [
        { rows: [commande({ statut: 'envoyee' })] },
        { rows: [ligne({ id: 'autre-ligne' })] },
      ],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.reception(CTX, 'cmd-1', ENTREE, 'idem-5')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});

describe('ServiceCommandeFournisseur.annulerReliquat — RP-28 : solder un reliquat sans livraison', () => {
  const ENTREE: EntreeAnnulationReliquat = { motif: 'Fournisseur — arrêt de production' };

  it('refuse (409 COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE) quand le reliquat est déjà à zéro', async () => {
    const { tx, executeAppels } = txFactice({
      executes: [
        { rows: [commande({ statut: 'partiellement_recue' })] },
        { rows: [ligne({ quantiteRecueCumuleeMillieme: 10000 })] }, // reliquat = 0
      ],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.annulerReliquat(CTX, 'cmd-1', 'ligne-1', ENTREE)).rejects.toMatchObject({
      code: 'COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE',
    });
    expect(executeAppels).toHaveLength(2);
  });

  it('reliquat non soldé, seule ligne de la commande : cloturee directement, via le saut envoyee → partiellement_recue → cloturee (transition_autorisee n’a pas envoyee → cloturee)', async () => {
    const { tx, executeAppels } = txFactice({
      executes: [
        { rows: [commande({ statut: 'envoyee' })] }, // FOR UPDATE commande
        { rows: [ligne({ quantiteRecueCumuleeMillieme: 0 })] }, // FOR UPDATE lignes (reliquat = 10000)
        { rows: [] }, // UPDATE ligne (reliquat_annule_le)
        { rows: [] }, // ecrireStatutCommande → partiellement_recue (saut intermédiaire)
        { rows: [] }, // ecrireStatutCommande → cloturee
      ],
      selects: [[commande({ statut: 'cloturee' })], [ligne({ reliquatAnnuleLe: new Date() })]],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.annulerReliquat(CTX, 'cmd-1', 'ligne-1', ENTREE);

    expect(resultat.donnees.statut).toBe('cloturee');
    // Les deux UPDATE de statut sont bien deux appels execute distincts (saut par partiellement_recue).
    expect(executeAppels).toHaveLength(5);
  });
});

describe('ServiceCommandeFournisseur.annuler — §6.2 : uniquement avant toute réception', () => {
  const ENTREE: EntreeAnnulationCommandeFournisseur = { motif: 'Erreur de saisie' };

  it('refuse (409) une commande déjà partiellement reçue — seul le reliquat par ligne s’annule après réception', async () => {
    const { tx, executeAppels } = txFactice({
      executes: [{ rows: [commande({ statut: 'partiellement_recue' })] }],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.annuler(CTX, 'cmd-1', ENTREE)).rejects.toMatchObject({
      code: 'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
    });
    expect(executeAppels).toHaveLength(1);
  });

  it('brouillon : passe annulee', async () => {
    const { tx } = txFactice({
      executes: [{ rows: [commande({ statut: 'brouillon' })] }, { rows: [] }],
      selects: [[commande({ statut: 'annulee', motifAnnulation: ENTREE.motif })], [ligne()]],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.annuler(CTX, 'cmd-1', ENTREE);

    expect(resultat.donnees.statut).toBe('annulee');
    expect(resultat.donnees.motifAnnulation).toBe('Erreur de saisie');
  });

  /**
   * PREUVE PAR FALSIFICATION (0034) : `entree.motif` doit être écrit dans le MÊME `UPDATE` que le
   * changement de statut — `commande_fournisseur_annulation_coherente_chk` (0034) refuserait sinon
   * la transition en base (motif absent alors que statut = annulee). Casser
   * `service-commande-fournisseur.ts::annuler` (ex. omettre `motif_annulation = ${entree.motif}`
   * du deuxième `UPDATE`) fait rougir cette assertion : le motif ne serait plus retrouvable dans
   * les chunks de la requête SQL brute passée à `tx.execute`.
   */
  it('écrit motif_annulation dans le même UPDATE que le changement de statut (0034)', async () => {
    const { tx, executeAppels } = txFactice({
      executes: [{ rows: [commande({ statut: 'brouillon' })] }, { rows: [] }],
      selects: [[commande({ statut: 'annulee', motifAnnulation: ENTREE.motif })], [ligne()]],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await service.annuler(CTX, 'cmd-1', ENTREE);

    const requeteUpdate = executeAppels[1] as { queryChunks: readonly unknown[] };
    expect(requeteUpdate.queryChunks).toContain(ENTREE.motif);
  });
});
