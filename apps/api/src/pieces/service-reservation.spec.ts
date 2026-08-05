import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneReservationPiece } from '../db/schema';
import { ServiceReservation } from './service-reservation';

const dialect = new PgDialect();

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneReservation(champs: Partial<LigneReservationPiece> = {}): LigneReservationPiece {
  return {
    id: 'r1',
    tenantId: 'tid-1',
    articleId: 'a1',
    siteId: 's1',
    ligneOrId: 'lo1',
    ordreReparationId: 'or1',
    quantiteMillieme: 1000,
    statut: 'active',
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    satisfaiteLe: null,
    mouvementSortieId: null,
    libereeLe: null,
    motifLiberation: null,
    motifLiberationTexte: null,
    libereeParUtilisateurId: null,
    ...champs,
  } as LigneReservationPiece;
}

/** `execute()` rend, dans l'ordre, les jeux fournis — seul mécanisme utilisé par ce service (tout est en SQL brut, voir son en-tête). */
function txFactice(executes: ReadonlyArray<{ rows: readonly unknown[] }>) {
  const file = [...executes];
  const tx = { execute: vi.fn(() => Promise.resolve(file.shift() ?? { rows: [] })) };
  return tx as unknown as TransactionDfa;
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceReservation.satisfaire — RP-21 : seule une réservation active peut être satisfaite', () => {
  it('refuse (409 RESERVATION_TRANSITION_INTERDITE) une réservation déjà satisfaite, sans générer de second mouvement', async () => {
    const tx = txFactice([{ rows: [ligneReservation({ statut: 'satisfaite' })] }]);
    const service = new ServiceReservation(accesFactice(tx));

    await expect(service.satisfaire(CTX, 'r1')).rejects.toMatchObject({
      code: 'RESERVATION_TRANSITION_INTERDITE',
      status: 409,
    });
    // Un seul appel execute (le SELECT ... FOR UPDATE) : aucun INSERT de mouvement, aucun UPDATE.
    expect((tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('refuse (409) une réservation déjà libérée', async () => {
    const tx = txFactice([{ rows: [ligneReservation({ statut: 'liberee' })] }]);
    const service = new ServiceReservation(accesFactice(tx));

    await expect(service.satisfaire(CTX, 'r1')).rejects.toMatchObject({
      code: 'RESERVATION_TRANSITION_INTERDITE',
    });
  });

  it('404 RESSOURCE_INTROUVABLE quand la réservation n’existe pas pour ce tenant', async () => {
    const tx = txFactice([{ rows: [] }]);
    const service = new ServiceReservation(accesFactice(tx));

    await expect(service.satisfaire(CTX, 'r-inconnue')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('active : insère un mouvement sortie_or de quantité NÉGATIVE, puis marque la réservation satisfaite', async () => {
    const tx = txFactice([
      { rows: [ligneReservation()] }, // SELECT FOR UPDATE
      { rows: [] }, // (a) palier : physique += Q, AVANT le mouvement
      { rows: [{ id: 'mvt-1' }] }, // INSERT mouvement_stock RETURNING id
      { rows: [] }, // UPDATE reservation_piece
      { rows: [] }, // (d) palier retiré : physique -= Q, APRÈS la transition officielle
      {
        rows: [
          ligneReservation({
            statut: 'satisfaite',
            satisfaiteLe: new Date(),
            mouvementSortieId: 'mvt-1',
          }),
        ],
      }, // reload
    ]);
    const service = new ServiceReservation(accesFactice(tx));

    const resultat = await service.satisfaire(CTX, 'r1');

    expect(resultat.statut).toBe('satisfaite');
    expect(resultat.mouvementSortieId).toBe('mvt-1');

    const appels = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(appels).toHaveLength(6);
  });

  /**
   * Défaut corrigé (mesuré en exécution — `pont-atelier-pieces.spec.ts`, section « atomicité
   * réelle ») : voir la docstring d'`appliquerSatisfaction` dans `service-reservation.ts`. Ce test
   * prouve la FORME EXACTE du palier — deux `UPDATE stock_article` bruts, l'un AVANT l'INSERT du
   * mouvement (delta = +Q), l'autre APRÈS la transition de la réservation (delta = -Q) — jamais
   * l'inverse, et jamais un troisième (pas de dérive du solde dérivé).
   */
  it('appliquerSatisfaction : encadre le mouvement/la transition d’un palier +Q puis -Q sur quantite_physique_millieme, JAMAIS sur quantite_reservee_millieme', async () => {
    const tx = txFactice([
      { rows: [ligneReservation({ quantiteMillieme: 2000 })] }, // SELECT FOR UPDATE
      { rows: [] }, // (a) palier +Q
      { rows: [{ id: 'mvt-1' }] }, // INSERT mouvement_stock
      { rows: [] }, // UPDATE reservation_piece
      { rows: [] }, // (d) palier -Q
      { rows: [ligneReservation({ statut: 'satisfaite', quantiteMillieme: 2000 })] }, // reload
    ]);
    const service = new ServiceReservation(accesFactice(tx));

    await service.satisfaire(CTX, 'r1');

    const appels = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const { sql: sqlPalierBump } = dialect.sqlToQuery(appels[1]?.[0] as SQL);
    const { sql: sqlPalierUnbump } = dialect.sqlToQuery(appels[4]?.[0] as SQL);
    expect(sqlPalierBump).toContain('quantite_physique_millieme');
    expect(sqlPalierBump).not.toContain('quantite_reservee_millieme');
    expect(sqlPalierUnbump).toContain('quantite_physique_millieme');
    expect(sqlPalierUnbump).not.toContain('quantite_reservee_millieme');

    const { params: paramsBump } = dialect.sqlToQuery(appels[1]?.[0] as SQL);
    const { params: paramsUnbump } = dialect.sqlToQuery(appels[4]?.[0] as SQL);
    // Le delta signé est le PREMIER paramètre lié dans `ajusterPhysiqueSansMouvement` (`+
    // ${deltaMillieme}` dans le texte SQL, voir service-reservation.ts).
    expect(paramsBump[0]).toBe(2000);
    expect(paramsUnbump[0]).toBe(-2000);
  });
});

describe('ServiceReservation.liberer — RP-23 : geste explicite, motif obligatoire, avertissement si l’OR n’est pas annulé', () => {
  it('refuse (409) une réservation qui n’est plus active', async () => {
    const tx = txFactice([{ rows: [ligneReservation({ statut: 'satisfaite' })] }]);
    const service = new ServiceReservation(accesFactice(tx));

    await expect(
      service.liberer(CTX, 'r1', { motif: 'Erreur de saisie côté atelier' }),
    ).rejects.toMatchObject({
      code: 'RESERVATION_TRANSITION_INTERDITE',
    });
  });

  it('OR non annulé : la réponse porte l’avertissement RESERVATION_LIBEREE_OR_ACTIF', async () => {
    const tx = txFactice([
      { rows: [ligneReservation()] }, // SELECT FOR UPDATE
      { rows: [] }, // UPDATE reservation_piece
      { rows: [{ statut: 'ouvert' }] }, // statut de l'OR
      { rows: [ligneReservation({ statut: 'liberee' })] }, // reload
    ]);
    const service = new ServiceReservation(accesFactice(tx));

    const resultat = await service.liberer(CTX, 'r1', { motif: 'Client a annulé la pose' });

    expect(resultat.avertissements).toHaveLength(1);
    expect(resultat.avertissements[0]?.code).toBe('RESERVATION_LIBEREE_OR_ACTIF');
  });

  it('OR annulé : aucun avertissement', async () => {
    const tx = txFactice([
      { rows: [ligneReservation()] },
      { rows: [] },
      { rows: [{ statut: 'annule' }] },
      { rows: [ligneReservation({ statut: 'liberee' })] },
    ]);
    const service = new ServiceReservation(accesFactice(tx));

    const resultat = await service.liberer(CTX, 'r1', { motif: 'OR annulé par le client' });

    expect(resultat.avertissements).toHaveLength(0);
  });
});

/**
 * Dette technique soldée (rapport de livraison étape 3-4) : `satisfairePourLigneTx`/
 * `libererPourLigneTx` sont les variantes composables appelées par
 * `atelier/service-ligne-or.ts` (`marquerRealisee`/`refuserLignes`/`annulerLignes`) DANS LEUR
 * PROPRE `tx` déjà ouvert — jamais via `satisfaire`/`liberer`, qui ouvriraient une connexion NEUVE
 * et casseraient l'atomicité (voir la doc de `satisfaire` dans `service-reservation.ts`). Point
 * central prouvé ci-dessous : ces variantes n'appellent JAMAIS `acces.enTenant` elles-mêmes —
 * l'appelant maîtrise entièrement la transaction.
 */
describe('ServiceReservation.satisfairePourLigneTx — RP-21, appelée par marquerRealisee (atelier)', () => {
  it("n'ouvre AUCUNE connexion propre : `acces.enTenant` n'est JAMAIS appelé quand on invoque directement la variante composable avec un `tx` externe", async () => {
    const tx = txFactice([{ rows: [] }]);
    const acces = accesFactice(tx);
    const service = new ServiceReservation(acces);

    await service.satisfairePourLigneTx(tx, CTX, 'lo1');

    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('aucune réservation active pour cette ligne → rend `null`, AUCUNE écriture (jamais créée, stock insuffisant à la pose RP-24, ou déjà satisfaite/libérée)', async () => {
    const tx = txFactice([{ rows: [] }]); // SELECT FOR UPDATE : aucune ligne active
    const service = new ServiceReservation(accesFactice(tx));

    const resultat = await service.satisfairePourLigneTx(tx, CTX, 'lo1');

    expect(resultat).toBeNull();
    expect((tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('réservation active trouvée par ligneOrId → même écriture que satisfaireTx (mouvement sortie_or négatif, statut satisfaite)', async () => {
    const tx = txFactice([
      { rows: [ligneReservation()] }, // SELECT FOR UPDATE par ligne_or_id
      { rows: [] }, // (a) palier : physique += Q
      { rows: [{ id: 'mvt-2' }] }, // INSERT mouvement_stock RETURNING id
      { rows: [] }, // UPDATE reservation_piece
      { rows: [] }, // (d) palier retiré : physique -= Q
      {
        rows: [
          ligneReservation({
            statut: 'satisfaite',
            satisfaiteLe: new Date(),
            mouvementSortieId: 'mvt-2',
          }),
        ],
      }, // reload
    ]);
    const service = new ServiceReservation(accesFactice(tx));

    const resultat = await service.satisfairePourLigneTx(tx, CTX, 'lo1');

    expect(resultat?.statut).toBe('satisfaite');
    expect(resultat?.mouvementSortieId).toBe('mvt-2');
    expect((tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6);
  });
});

describe('ServiceReservation.libererPourLigneTx — RP-23, appelée par annulerLignes/refuserLignes (atelier)', () => {
  it("n'ouvre AUCUNE connexion propre : `acces.enTenant` n'est JAMAIS appelé", async () => {
    const tx = txFactice([{ rows: [] }]);
    const acces = accesFactice(tx);
    const service = new ServiceReservation(acces);

    await service.libererPourLigneTx(tx, CTX, 'lo1', 'annulation_ligne');

    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('aucune réservation active pour cette ligne → silencieux, AUCUNE écriture (rien à libérer n’est pas une anomalie)', async () => {
    const tx = txFactice([{ rows: [] }]);
    const service = new ServiceReservation(accesFactice(tx));

    await service.libererPourLigneTx(tx, CTX, 'lo1', 'annulation_ligne');

    expect((tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("réservation active trouvée → UPDATE avec le motif fourni ('refus_devis'), SANS texte ni utilisateur (réservés au geste manuel, cohérent avec reservation_piece_motif_texte_chk, 0026)", async () => {
    const tx = txFactice([
      { rows: [{ id: 'r1' }] }, // SELECT id FOR UPDATE par ligne_or_id
      { rows: [] }, // UPDATE reservation_piece
    ]);
    const service = new ServiceReservation(accesFactice(tx));

    await service.libererPourLigneTx(tx, CTX, 'lo1', 'refus_devis');

    const appels = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(appels).toHaveLength(2);
    const { sql: texte, params } = dialect.sqlToQuery(appels[1]?.[0] as SQL);
    expect(texte).toContain('motif_liberation');
    expect(texte).toContain('motif_liberation_texte');
    expect(texte).toContain('liberee_par_utilisateur_id');
    // Ordre des paramètres liés : motif, motif_liberation_texte (null), liberee_par_utilisateur_id
    // (null), tenantId, reservationId — voir `ecrireLiberation` dans `service-reservation.ts`.
    expect(params).toEqual(['refus_devis', null, null, 'tid-1', 'r1']);
  });
});
