import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
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
const dialect = new PgDialect();

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

/**
 * `GET /commandes-fournisseur/{id}/lignes` — la suite paginée de `CommandeFournisseurDto.lignes`
 * au-delà de `lignesTronquees` (constat de ce lot, même défaut que `ArticleDto.references` :
 * l'indicateur de troncature existait déjà, mais aucun endpoint ne permettait d'en récupérer la
 * suite). Curseur sur `numeroOrdre` (`smallint`, ordinal) — PAS `timestamptz`, donc pas de piège
 * microseconde ici (voir `service-article.spec.ts::listerReferences` pour ce cas-là) ; le test qui
 * compte est que le curseur reprenne réellement là où la page précédente s'est arrêtée.
 */
describe('ServiceCommandeFournisseur.listerLignes — GET /commandes-fournisseur/{id}/lignes, la suite de lignesTronquees', () => {
  it('404 RESSOURCE_INTROUVABLE si la commande n’existe pas pour ce tenant, sans exécuter la requête paginée', async () => {
    const { tx, executeAppels } = txFactice({ selects: [[]] });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await expect(
      service.listerLignes(CTX, 'introuvable', { limite: 100, tri: 'numeroOrdre:asc' }),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
    expect(executeAppels).toHaveLength(0);
  });

  it('sous le seuil de page : pas de curseur suivant, toutes les lignes rendues dans l’ordre numeroOrdre', async () => {
    const { tx } = txFactice({
      selects: [[commande()]],
      executes: [
        {
          rows: [
            { ...ligne({ id: 'ligne-1', numeroOrdre: 1 }), triValeur: 1 },
            { ...ligne({ id: 'ligne-2', numeroOrdre: 2 }), triValeur: 2 },
          ],
        },
      ],
    });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.listerLignes(CTX, 'cmd-1', { limite: 100, tri: 'numeroOrdre:asc' });

    expect(page.donnees.map((l) => l.numeroOrdre)).toEqual([1, 2]);
    expect(page.curseurSuivant).toBeNull();
  });

  it(
    'au-delà du seuil de page : le curseur suivant permet réellement de récupérer la suite — la ' +
      'preuve qui compte, pas seulement « un curseur non nul » (RM : le défaut qu’une pagination ' +
      'silencieuse laisse passer)',
    async () => {
      // `decoderCurseurTrie` valide `id` contre un format UUID (`REGEX_UUID`,
      // `common/pagination/curseur.ts`) — la page 2 décode le curseur rendu par la page 1, les
      // identifiants de ligne doivent donc en avoir la forme (voir aussi `service-article.spec.ts`).
      const IDS = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ] as const;
      const lignesTotales = Array.from({ length: 3 }, (_, i) => ({
        ...ligne({ id: IDS[i], numeroOrdre: i + 1 }),
        triValeur: i + 1,
      }));
      const { tx, executeAppels } = txFactice({
        selects: [[commande()], [commande()]],
        // La requête SQL de la page 1 demande `limit ${limite + 1}` = 3 : les 3 lignes existantes
        // tiennent dedans, ce qui EST le signal « il y a une page suivante » (`lignes.length >
        // limite`) — retourner seulement 2 lignes ici ferait mentir le mock (la page 1 n'aurait
        // jamais de curseur suivant, faussant tout le test).
        executes: [{ rows: lignesTotales }, { rows: [lignesTotales[2]] }],
      });
      const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

      const page1 = await service.listerLignes(CTX, 'cmd-1', {
        limite: 2,
        tri: 'numeroOrdre:asc',
      });
      expect(page1.donnees.map((l) => l.numeroOrdre)).toEqual([1, 2]);
      expect(page1.curseurSuivant).not.toBeNull();

      const page2 = await service.listerLignes(CTX, 'cmd-1', {
        limite: 2,
        tri: 'numeroOrdre:asc',
        curseur: page1.curseurSuivant as string,
      });

      expect(executeAppels).toHaveLength(2);
      expect(page2.donnees.map((l) => l.numeroOrdre)).toEqual([3]);
      expect(page2.curseurSuivant).toBeNull();
    },
  );

  it('la colonne `triValeur` relaie numero_ordre SANS cast temporel (pas de piège timestamptz sur cette clé)', async () => {
    const { tx, executeAppels } = txFactice({ selects: [[commande()]], executes: [{ rows: [] }] });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await service.listerLignes(CTX, 'cmd-1', { limite: 100, tri: 'numeroOrdre:asc' });

    const appel = executeAppels[0] as SQL;
    const { sql: texte } = dialect.sqlToQuery(appel);
    expect(texte).toContain('l.numero_ordre as "triValeur"');
    expect(texte).not.toContain('numero_ordre::text');
  });
});

describe('ServiceCommandeFournisseur.lister — filtre `q` tolérant à la casse ET aux accents', () => {
  it('enveloppe `reference` dans public.normaliser_recherche(...) des deux côtés du `like`, jamais un `ilike` nu', async () => {
    const { tx, executeAppels } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await service.lister(CTX, { limite: 50, tri: 'creeLe:desc', q: 'CMD-2026-014' });

    const appel = executeAppels[0] as SQL;
    const { sql: texte } = dialect.sqlToQuery(appel);
    expect(texte).toContain(
      'public.normaliser_recherche(cf.reference) like public.normaliser_recherche(',
    );
    expect(texte).not.toContain('ilike');
  });

  // Test décisif : un `q` accepté par le contrat mais ignoré par le service est le piège maison —
  // un terme inexistant DOIT rendre une liste vide, jamais toutes les commandes.
  it('un terme qui ne correspond à aucune commande rend une liste VIDE, jamais toutes les commandes', async () => {
    const { tx } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.lister(CTX, {
      limite: 50,
      tri: 'creeLe:desc',
      q: 'introuvable-xyz',
    });

    expect(page.donnees).toEqual([]);
    expect(page.curseurSuivant).toBeNull();
  });

  // Piège du zéro/vide : `q` absent (`undefined`) ne doit JAMAIS ajouter la condition —
  // rétrocompatibilité pour un client qui n'envoie pas `q`.
  it('sans `q`, aucune condition de recherche n’est ajoutée au SQL', async () => {
    const { tx, executeAppels } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceCommandeFournisseur(accesFactice(tx), idempotenceFactice(tx));

    await service.lister(CTX, { limite: 50, tri: 'creeLe:desc' });

    const appel = executeAppels[0] as SQL;
    const { sql: texte } = dialect.sqlToQuery(appel);
    expect(texte).not.toContain('normaliser_recherche');
  });
});
