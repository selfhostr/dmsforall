import { describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import {
  rechercherCorrespondanceClient,
  rechercherCorrespondanceTypeApprobation,
  rechercherCorrespondanceTypeApprobationApprox,
  rechercherCorrespondanceTypeApprobationComplete,
  rechercherCorrespondanceVehicule,
} from './correspondance-permis';

/** Même patron de mock que `vehicules/referentiel/service-referentiel-vehicules-ch.spec.ts`. */
const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function txSequence(reponses: readonly (readonly unknown[])[]): TransactionDfa {
  let appel = 0;
  return {
    execute: vi.fn(() => {
      const lignes = reponses[appel] ?? [];
      appel += 1;
      return Promise.resolve({ rows: lignes });
    }),
  } as unknown as TransactionDfa;
}

describe('rechercherCorrespondanceTypeApprobation', () => {
  it('aucun candidat -> non trouvé, aucune requête exécutée', async () => {
    const tx = txSequence([]);
    const resultat = await rechercherCorrespondanceTypeApprobation(tx, []);
    expect(resultat.trouve).toBe(false);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('le premier candidat matche -> trouvé, un seul aller en base', async () => {
    const tx = txSequence([
      [{ code_type_ch: '1VD455', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' }],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobation(tx, ['1VD455', '1VD45']);

    expect(resultat).toEqual({
      trouve: true,
      marque: 'VW',
      modele: 'Polo',
      carburantCode: 'ESSENCE',
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it('le premier candidat ne matche pas mais le deuxième oui -> trouvé après repli, DEUX allers en base (ordre respecté)', async () => {
    const tx = txSequence([
      [],
      [{ code_type_ch: '1VD455', marque: 'VW', modele: 'Polo', carburant_code: null }],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobation(tx, ['1VD455B', '1VD455']);

    expect(resultat.trouve).toBe(true);
    expect(resultat.marque).toBe('VW');
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('aucun candidat ne matche -> non trouvé, un aller en base par candidat', async () => {
    const tx = txSequence([[], []]);
    const resultat = await rechercherCorrespondanceTypeApprobation(tx, ['AAA', 'BBB']);
    expect(resultat.trouve).toBe(false);
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });
});

describe('rechercherCorrespondanceTypeApprobationApprox', () => {
  it('aucun candidat -> non trouvé, aucune requête exécutée (même le `set local` de seuil est évité)', async () => {
    const tx = txSequence([]);
    const resultat = await rechercherCorrespondanceTypeApprobationApprox(tx, []);
    expect(resultat.trouve).toBe(false);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('une ligne à distance 1 -> trouvée', async () => {
    const tx = txSequence([
      [], // `set local pg_trgm.similarity_threshold`
      [{ code_type_ch: '1VD450', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' }],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobationApprox(tx, ['1VD455']);

    expect(resultat).toEqual({
      trouve: true,
      marque: 'VW',
      modele: 'Polo',
      carburantCode: 'ESSENCE',
    });
  });

  it('deux lignes à distances différentes -> la plus proche (distance minimale) gagne', async () => {
    const tx = txSequence([
      [],
      [
        // '1VD400' est à distance 2 de '1VD455' (positions 4 et 5), '1VD450' à distance 1
        // (position 4 seule) — la ligne à distance 1 doit gagner.
        { code_type_ch: '1VD400', marque: 'Autre', modele: 'X', carburant_code: null },
        { code_type_ch: '1VD450', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' },
      ],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobationApprox(tx, ['1VD455']);

    expect(resultat.trouve).toBe(true);
    expect(resultat.marque).toBe('VW');
  });

  it('deux lignes À LA MÊME distance minimale -> ambigu, non trouvé (jamais un choix arbitraire)', async () => {
    const tx = txSequence([
      [],
      [
        { code_type_ch: '1VD450', marque: 'VW', modele: 'Polo', carburant_code: null },
        { code_type_ch: '1VD456', marque: 'Audi', modele: 'A3', carburant_code: null },
      ],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobationApprox(tx, ['1VD455']);

    expect(resultat.trouve).toBe(false);
  });

  it('toutes les lignes ramenées sont à distance > 2 -> non trouvé (le filtre trigramme n’est qu’une PRÉ-sélection, pas le critère final)', async () => {
    const tx = txSequence([
      [],
      [{ code_type_ch: 'XYZ999', marque: 'X', modele: 'Y', carburant_code: null }],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobationApprox(tx, ['1VD455']);

    expect(resultat.trouve).toBe(false);
  });

  it('plusieurs candidats essayés -> le gagnant GLOBAL (toutes requêtes confondues) est celui à la distance minimale, pas celui du premier candidat interrogé', async () => {
    const tx = txSequence([
      [], // set local
      [{ code_type_ch: '1VD400', marque: 'Autre', modele: 'X', carburant_code: null }], // distance 2 de '1VD455'
      [{ code_type_ch: '1VD455', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' }], // distance 0 de '1VD45' -> en fait '1VD455' vs '1VD45' = distance 1 (insertion)
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobationApprox(tx, ['1VD455', '1VD45']);

    expect(resultat.trouve).toBe(true);
    expect(resultat.marque).toBe('VW');
  });

  it('borne à 5 candidats essayés au maximum, même si `candidatsCodeType` en fournit plus', async () => {
    const tx = txSequence([[], [], [], [], [], []]); // 1 set local + 5 requêtes (aucune ligne)
    const candidats = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];

    await rechercherCorrespondanceTypeApprobationApprox(tx, candidats);

    // 1 `set local` + 5 candidats essayés (PAS 7).
    expect(tx.execute).toHaveBeenCalledTimes(6);
  });
});

describe('rechercherCorrespondanceTypeApprobationComplete', () => {
  it('trouvé en EXACT -> l’approximatif n’est jamais interrogé', async () => {
    const tx = txSequence([
      [{ code_type_ch: '1VD455', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' }],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobationComplete(tx, ['1VD455']);

    expect(resultat.trouve).toBe(true);
    expect(tx.execute).toHaveBeenCalledTimes(1); // aucun `set local` ni requête approximative
  });

  it('non trouvé en exact -> repli sur l’approximatif', async () => {
    const tx = txSequence([
      [], // recherche exacte : aucune ligne
      [], // set local
      [{ code_type_ch: '1VD450', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' }],
    ]);

    const resultat = await rechercherCorrespondanceTypeApprobationComplete(tx, ['1VD455']);

    expect(resultat).toEqual({
      trouve: true,
      marque: 'VW',
      modele: 'Polo',
      carburantCode: 'ESSENCE',
    });
  });
});

describe('rechercherCorrespondanceVehicule', () => {
  it('VIN trouvé -> rendu directement ({id, libelle}), la plaque non interrogée', async () => {
    const tx = txSequence([[{ id: 'veh-1', marque: 'VW', modele: 'Polo' }]]);

    const resultat = await rechercherCorrespondanceVehicule(tx, CTX, {
      vin: '1M8GDM9AXKP042788',
      plaque: { canton: 'VD', numero: '123456' },
    });

    expect(resultat).toEqual({ id: 'veh-1', libelle: 'VW Polo' });
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it('VIN absent des véhicules du tenant, plaque fournie -> repli sur la plaque', async () => {
    const tx = txSequence([
      [], // recherche VIN : aucune ligne
      [
        {
          vehicule_id: 'veh-2',
          marque: 'Skoda',
          modele: 'Fabia',
          version: null,
          valeur: 'VD 123456',
          canton: 'VD',
          du: '2020-01-01',
          au: null,
        },
      ], // trouverVehiculeCollisionPlaque
    ]);

    const resultat = await rechercherCorrespondanceVehicule(tx, CTX, {
      vin: '1M8GDM9AXKP042788',
      plaque: { canton: 'VD', numero: '123456' },
    });

    expect(resultat).toEqual({ id: 'veh-2', libelle: 'Skoda Fabia' });
  });

  it('ni VIN ni plaque exploitables -> null, aucune requête', async () => {
    const tx = txSequence([]);
    const resultat = await rechercherCorrespondanceVehicule(tx, CTX, { vin: null, plaque: null });
    expect(resultat).toBeNull();
    expect(tx.execute).not.toHaveBeenCalled();
  });
});

describe('rechercherCorrespondanceClient', () => {
  it('nom ET npa présents -> délègue à detecterDoublons, rend le meilleur candidat ({id, nomAffiche})', async () => {
    const tx = txSequence([
      [{ client_id: 'cli-1', numero: 'CL-001', nom: 'Dupont Jean', npa: '1950' }],
    ]);

    const resultat = await rechercherCorrespondanceClient(tx, CTX, {
      nomComplet: 'Dupont Jean',
      npa: '1950',
    });

    expect(resultat).toEqual({ id: 'cli-1', nomAffiche: 'Dupont Jean' });
  });

  it('npa absent (adresse non lue) -> null, aucune requête (doctrine conservatrice héritée de detecterDoublons)', async () => {
    const tx = txSequence([]);
    const resultat = await rechercherCorrespondanceClient(tx, CTX, {
      nomComplet: 'Dupont Jean',
      npa: null,
    });
    expect(resultat).toBeNull();
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('nom absent -> null, aucune requête', async () => {
    const tx = txSequence([]);
    const resultat = await rechercherCorrespondanceClient(tx, CTX, {
      nomComplet: null,
      npa: '1950',
    });
    expect(resultat).toBeNull();
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('plusieurs candidats -> seul le meilleur (premier, déjà trié par score) est rendu', async () => {
    const tx = txSequence([
      [
        { client_id: 'cli-1', numero: 'CL-001', nom: 'Dupont Jean', npa: '1950' },
        { client_id: 'cli-2', numero: 'CL-002', nom: 'Dupont Jean', npa: '1950' },
      ],
    ]);

    const resultat = await rechercherCorrespondanceClient(tx, CTX, {
      nomComplet: 'Dupont Jean',
      npa: '1950',
    });

    expect(resultat).toEqual({ id: 'cli-1', nomAffiche: 'Dupont Jean' });
  });
});
