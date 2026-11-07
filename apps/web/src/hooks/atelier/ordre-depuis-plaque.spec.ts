import { describe, expect, it, vi } from 'vitest';

import type { EntreeCreationClient } from '@dfa/shared';

import {
  EchecEtapeCreation,
  preparerClientEtVehicule,
  type EntreeVehiculeRapide,
  type ProgressionCreation,
} from './ordre-depuis-plaque';

const ENTREE_CLIENT = { type: 'particulier', nom: 'Martin' } as unknown as EntreeCreationClient;
const ENTREE_VEHICULE: EntreeVehiculeRapide = { marque: 'Audi', modele: 'A3', importe: false };

describe('preparerClientEtVehicule', () => {
  it('ne crée rien quand client et véhicule existent', async () => {
    const creerClient = vi.fn();
    const creerVehicule = vi.fn();
    const r = await preparerClientEtVehicule(
      { client: { mode: 'existant', id: 'c1' }, vehicule: { mode: 'existant', id: 'v1' } },
      {},
      { creerClient, creerVehicule },
    );
    expect(r).toEqual({ clientId: 'c1', vehiculeId: 'v1' });
    expect(creerClient).not.toHaveBeenCalled();
    expect(creerVehicule).not.toHaveBeenCalled();
  });

  it('crée le client puis le véhicule rattaché à ce client', async () => {
    const creerClient = vi.fn().mockResolvedValue({ id: 'c-new' });
    const creerVehicule = vi.fn().mockResolvedValue({ id: 'v-new' });
    const r = await preparerClientEtVehicule(
      {
        client: { mode: 'nouveau', entree: ENTREE_CLIENT },
        vehicule: { mode: 'nouveau', entree: ENTREE_VEHICULE },
      },
      {},
      { creerClient, creerVehicule },
    );
    expect(r).toEqual({ clientId: 'c-new', vehiculeId: 'v-new' });
    expect(creerVehicule).toHaveBeenCalledWith({ ...ENTREE_VEHICULE, detenteurId: 'c-new' });
  });

  it("reprise : un véhicule en échec n'entraîne PAS la recréation du client au second essai", async () => {
    const progression: ProgressionCreation = {};
    const creerClient = vi.fn().mockResolvedValue({ id: 'c-new' });
    const creerVehicule = vi
      .fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce({ id: 'v-new' });
    const plan = {
      client: { mode: 'nouveau', entree: ENTREE_CLIENT },
      vehicule: { mode: 'nouveau', entree: ENTREE_VEHICULE },
    } as const;

    const echec = await preparerClientEtVehicule(plan, progression, {
      creerClient,
      creerVehicule,
    }).catch((e: unknown) => e);
    expect(echec).toBeInstanceOf(EchecEtapeCreation);
    expect((echec as EchecEtapeCreation).etape).toBe('vehicule');
    expect(progression).toEqual({ clientId: 'c-new' });

    const r = await preparerClientEtVehicule(plan, progression, { creerClient, creerVehicule });
    expect(r).toEqual({ clientId: 'c-new', vehiculeId: 'v-new' });
    expect(creerClient).toHaveBeenCalledTimes(1);
    expect(creerVehicule).toHaveBeenCalledTimes(2);
  });

  it("échec du client : rien n'est créé après, l'étape fautive est nommée", async () => {
    const creerVehicule = vi.fn();
    const echec = await preparerClientEtVehicule(
      {
        client: { mode: 'nouveau', entree: ENTREE_CLIENT },
        vehicule: { mode: 'nouveau', entree: ENTREE_VEHICULE },
      },
      {},
      { creerClient: vi.fn().mockRejectedValue(new Error('x')), creerVehicule },
    ).catch((e: unknown) => e);
    expect((echec as EchecEtapeCreation).etape).toBe('client');
    expect(creerVehicule).not.toHaveBeenCalled();
  });
});
