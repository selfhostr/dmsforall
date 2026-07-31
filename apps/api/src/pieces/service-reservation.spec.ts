import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneReservationPiece } from '../db/schema';
import { ServiceReservation } from './service-reservation';

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
  return { enTenant: vi.fn((_ctx, travail) => travail(tx)), verifierConnexion: vi.fn(), verifierPostureRls: vi.fn() };
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

    await expect(service.satisfaire(CTX, 'r1')).rejects.toMatchObject({ code: 'RESERVATION_TRANSITION_INTERDITE' });
  });

  it('404 RESSOURCE_INTROUVABLE quand la réservation n’existe pas pour ce tenant', async () => {
    const tx = txFactice([{ rows: [] }]);
    const service = new ServiceReservation(accesFactice(tx));

    await expect(service.satisfaire(CTX, 'r-inconnue')).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE', status: 404 });
  });

  it('active : insère un mouvement sortie_or de quantité NÉGATIVE, puis marque la réservation satisfaite', async () => {
    const tx = txFactice([
      { rows: [ligneReservation()] }, // SELECT FOR UPDATE
      { rows: [{ id: 'mvt-1' }] }, // INSERT mouvement_stock RETURNING id
      { rows: [] }, // UPDATE reservation_piece
      { rows: [ligneReservation({ statut: 'satisfaite', satisfaiteLe: new Date(), mouvementSortieId: 'mvt-1' })] }, // reload
    ]);
    const service = new ServiceReservation(accesFactice(tx));

    const resultat = await service.satisfaire(CTX, 'r1');

    expect(resultat.statut).toBe('satisfaite');
    expect(resultat.mouvementSortieId).toBe('mvt-1');

    const appels = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(appels).toHaveLength(4);
  });
});

describe('ServiceReservation.liberer — RP-23 : geste explicite, motif obligatoire, avertissement si l’OR n’est pas annulé', () => {
  it('refuse (409) une réservation qui n’est plus active', async () => {
    const tx = txFactice([{ rows: [ligneReservation({ statut: 'satisfaite' })] }]);
    const service = new ServiceReservation(accesFactice(tx));

    await expect(service.liberer(CTX, 'r1', { motif: 'Erreur de saisie côté atelier' })).rejects.toMatchObject({
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
