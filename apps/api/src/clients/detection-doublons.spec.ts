import { describe, expect, it, vi } from 'vitest';
import type { TransactionDfa } from '../db';
import { detecterDoublons } from './detection-doublons';

type LigneBrute = {
  readonly client_id: string;
  readonly numero: string;
  readonly nom: string;
  readonly npa: string | null;
};

/**
 * Fausse transaction dont `execute()` rend, dans l'ORDRE D'APPEL, les jeux de lignes fournis.
 * `detecterDoublons` exécute ses requêtes dans un ordre fixe et connu du code
 * (nom+NPA, puis email, puis téléphone, puis IDE — seulement pour les critères fournis) : fournir
 * les jeux de résultats dans cet ordre suffit, sans avoir à interpréter le SQL généré.
 */
function txFactice(jeuxDeReponses: readonly LigneBrute[][]): TransactionDfa {
  const file = [...jeuxDeReponses];
  return {
    execute: vi.fn(() => Promise.resolve({ rows: file.shift() ?? [] })),
  } as unknown as TransactionDfa;
}

describe('detecterDoublons — critère "nom" jamais utilisé seul (RM-05, conservateur)', () => {
  it('nomComplet sans npa ne déclenche aucune recherche et rend un tableau vide', async () => {
    const tx = txFactice([]);
    const candidats = await detecterDoublons(tx, 'tid', { nomComplet: 'Dupont Jean' });
    expect(tx.execute).not.toHaveBeenCalled();
    expect(candidats).toEqual([]);
  });

  it('aucun critère fourni ne déclenche aucune recherche', async () => {
    const tx = txFactice([]);
    const candidats = await detecterDoublons(tx, 'tid', {});
    expect(tx.execute).not.toHaveBeenCalled();
    expect(candidats).toEqual([]);
  });

  it('nomComplet ET npa ensemble déclenchent la recherche "nom_npa", score 0.6', async () => {
    const tx = txFactice([
      [{ client_id: 'c1', numero: 'CL-000001', nom: 'Dupont Jean', npa: '1000' }],
    ]);
    const candidats = await detecterDoublons(tx, 'tid', { nomComplet: 'Dupont Jean', npa: '1000' });
    expect(candidats).toEqual([
      {
        clientId: 'c1',
        numeroClient: 'CL-000001',
        nom: 'Dupont Jean',
        npa: '1000',
        critere: 'nom_npa',
        score: 0.6,
      },
    ]);
  });
});

describe('detecterDoublons — un même client retrouvé par plusieurs critères ne garde que son meilleur score', () => {
  it('email (0.9) puis IDE (1) sur le même client : le score final est celui du critère le plus fiable (IDE)', async () => {
    const memeClient = { client_id: 'c1', numero: 'CL-000001', nom: 'Garage Martin SA', npa: null };
    // Ordre d'exécution du code : email avant ide (pas de nomComplet/npa, pas de téléphone ici).
    const tx = txFactice([[memeClient], [memeClient]]);
    const candidats = await detecterDoublons(tx, 'tid', {
      email: 'contact@martin.ch',
      ide: 'CHE-123.456.789',
    });
    expect(candidats).toHaveLength(1);
    expect(candidats[0]).toMatchObject({ clientId: 'c1', critere: 'ide', score: 1 });
  });

  it("IDE (1) puis email (0.9) fournis dans l'ordre inverse : le score le plus haut, déjà posé, n'est pas dégradé", async () => {
    const memeClient = { client_id: 'c1', numero: 'CL-000001', nom: 'Garage Martin SA', npa: null };
    // Ordre d'exécution du code : email est exécuté AVANT ide, quel que soit l'ordre de saisie des critères.
    const tx = txFactice([[memeClient], [memeClient]]);
    const candidats = await detecterDoublons(tx, 'tid', {
      ide: 'CHE-123.456.789',
      email: 'contact@martin.ch',
    });
    expect(candidats[0]).toMatchObject({ critere: 'ide', score: 1 });
  });
});

describe('detecterDoublons — tri par score décroissant, du plus fiable au moins fiable', () => {
  it('un candidat trouvé par email (0.9) précède un candidat trouvé par nom+npa (0.6)', async () => {
    const parNomNpa = [
      { client_id: 'c-nom', numero: 'CL-000001', nom: 'Dupont Jean', npa: '1000' },
    ];
    const parEmail = [{ client_id: 'c-email', numero: 'CL-000002', nom: 'Muster Hans', npa: null }];
    // Ordre d'exécution du code : nom_npa avant email.
    const tx = txFactice([parNomNpa, parEmail]);
    const candidats = await detecterDoublons(tx, 'tid', {
      nomComplet: 'Dupont Jean',
      npa: '1000',
      email: 'hans@muster.ch',
    });
    expect(candidats.map((c) => c.clientId)).toEqual(['c-email', 'c-nom']);
  });
});

describe('detecterDoublons — critère téléphone (E.164)', () => {
  it('un candidat retrouvé par téléphone porte le score 0.8', async () => {
    const tx = txFactice([
      [{ client_id: 'c1', numero: 'CL-000003', nom: 'Dupont Jean', npa: null }],
    ]);
    const candidats = await detecterDoublons(tx, 'tid', { telephoneE164: '+41791234567' });
    expect(candidats).toEqual([
      {
        clientId: 'c1',
        numeroClient: 'CL-000003',
        nom: 'Dupont Jean',
        npa: null,
        critere: 'telephone',
        score: 0.8,
      },
    ]);
  });
});
