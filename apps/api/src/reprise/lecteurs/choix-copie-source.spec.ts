import { describe, expect, it } from 'vitest';
import {
  choisirCopieSourceDeVerite,
  detecterIncoherenceRoleVide,
  estGabaritVide,
  regrouperCopiesRivales,
  type CandidatCopie,
} from './choix-copie-source';
import type { RapportTable } from './types';

function tableResume(nom: string, lignesActives: number, dateMaxObservee: Date | null) {
  return { nom, colonnes: ['A', 'B'], lignesActives, dateMaxObservee };
}

describe('estGabaritVide', () => {
  it('reconnaît un jeu de tables structurellement complet mais vide comme un gabarit', () => {
    const candidat: CandidatCopie = {
      cheminRepertoire: '/archive/Program Files/App/Vide',
      tables: [
        tableResume('Clients', 0, null),
        tableResume('Vehicules', 0, null),
        tableResume('Factures', 0, null),
      ],
    };
    expect(estGabaritVide(candidat)).toBe(true);
  });

  it('ne classe pas une copie peuplée comme gabarit, même avec quelques tables vides résiduelles', () => {
    const candidat: CandidatCopie = {
      cheminRepertoire: '/archive/Prod',
      tables: [tableResume('Clients', 500, new Date()), tableResume('LogsTemp', 0, null)],
    };
    expect(estGabaritVide(candidat)).toBe(false);
  });
});

describe('regrouperCopiesRivales', () => {
  it('regroupe des répertoires dont le jeu de noms de table se recoupe largement', () => {
    const a: CandidatCopie = {
      cheminRepertoire: '/rep/A',
      tables: [tableResume('Clients', 10, null), tableResume('Vehicules', 5, null)],
    };
    const b: CandidatCopie = {
      cheminRepertoire: '/rep/B',
      tables: [tableResume('Clients', 12, null), tableResume('Vehicules', 6, null)],
    };
    const c: CandidatCopie = {
      cheminRepertoire: '/rep/AutreSysteme',
      tables: [tableResume('Produits', 100, null), tableResume('Stock', 40, null)],
    };

    const groupes = regrouperCopiesRivales([a, b, c]);
    const groupeAB = groupes.find((g) => g.chemins.includes('/rep/A'));
    expect(groupeAB?.chemins.sort()).toEqual(['/rep/A', '/rep/B']);
    expect(
      groupes.some((g) => g.chemins.length === 1 && g.chemins[0] === '/rep/AutreSysteme'),
    ).toBe(true);
  });
});

describe('choisirCopieSourceDeVerite', () => {
  it('retient la copie dont la date maximale observée dans les données est la plus récente, même dans le répertoire le moins évident', () => {
    const ancienEmplacement: CandidatCopie = {
      cheminRepertoire: '/D/App/Data',
      tables: [tableResume('Clients', 900, new Date('2024-01-01T00:00:00Z'))],
    };
    const sauvegarde: CandidatCopie = {
      cheminRepertoire: '/D/Backups/2025-01-01',
      tables: [tableResume('Clients', 950, new Date('2025-01-01T00:00:00Z'))],
    };
    // Le répertoire le moins évident (nom anodin) porte en réalité l'écriture la plus récente.
    const copieAnodine: CandidatCopie = {
      cheminRepertoire: '/D/tmp/x7',
      tables: [tableResume('Clients', 960, new Date('2026-08-04T00:00:00Z'))],
    };

    const resultat = choisirCopieSourceDeVerite([ancienEmplacement, sauvegarde, copieAnodine]);
    expect(resultat.copieRetenue).toBe('/D/tmp/x7');
    expect(resultat.copiesEcartees).toHaveLength(2);
    expect(resultat.copiesEcartees.every((c) => c.motif.length > 10)).toBe(true);
  });

  it('écarte un gabarit vierge structurellement complet, même si sa fraîcheur fichier paraît récente', () => {
    const vivante: CandidatCopie = {
      cheminRepertoire: '/rep/vivante',
      tables: [tableResume('Clients', 300, new Date('2026-01-01'))],
    };
    const gabarit: CandidatCopie = {
      cheminRepertoire: '/rep/installation-neuve',
      tables: [
        tableResume('Clients', 0, null),
        tableResume('Vehicules', 0, null),
        tableResume('Factures', 0, null),
      ],
    };

    const resultat = choisirCopieSourceDeVerite([vivante, gabarit]);
    expect(resultat.copieRetenue).toBe('/rep/vivante');
    const ecart = resultat.copiesEcartees.find(
      (c) => c.cheminRepertoire === '/rep/installation-neuve',
    );
    expect(ecart?.motif).toMatch(/gabarit/);
  });

  it('rend copieRetenue=null quand toutes les copies sont des gabarits vides, avec une incohérence explicite', () => {
    const gabarit: CandidatCopie = {
      cheminRepertoire: '/rep/vide',
      tables: [
        tableResume('Clients', 0, null),
        tableResume('Vehicules', 0, null),
        tableResume('Factures', 0, null),
      ],
    };
    const resultat = choisirCopieSourceDeVerite([gabarit]);
    expect(resultat.copieRetenue).toBeNull();
    expect(resultat.incoherences.length).toBeGreaterThan(0);
  });

  it("signale une incohérence quand la copie retenue (plus fraîche) n'est pas la plus volumineuse", () => {
    const fraiche: CandidatCopie = {
      cheminRepertoire: '/rep/fraiche',
      tables: [tableResume('Clients', 50, new Date('2026-06-01'))],
    };
    const volumineuse: CandidatCopie = {
      cheminRepertoire: '/rep/grosse',
      tables: [tableResume('Clients', 5000, new Date('2024-01-01'))],
    };
    const resultat = choisirCopieSourceDeVerite([fraiche, volumineuse]);
    expect(resultat.copieRetenue).toBe('/rep/fraiche');
    expect(resultat.incoherences.some((m) => m.includes('grosse'))).toBe(true);
  });

  it('rend copieRetenue=null sur une liste vide, sans planter', () => {
    expect(choisirCopieSourceDeVerite([])).toEqual({
      copieRetenue: null,
      copiesEcartees: [],
      groupes: [],
      incoherences: [],
    });
  });
});

describe('detecterIncoherenceRoleVide', () => {
  it("signale un rôle central absent alors qu'un rôle dépendant est peuplé (cas mesuré : facturation sans fichier clients)", () => {
    const rapports: RapportTable[] = [
      {
        table: 'Factures',
        lignesActives: 2000,
        lignesSupprimees: 0,
        evaluations: [{ role: 'document_vente', confiance: 0.8, raison: 'r', signaux: [] }],
      },
      {
        table: 'AutreTable',
        lignesActives: 10,
        lignesSupprimees: 0,
        evaluations: [{ role: 'inconnu', confiance: 0.9, raison: 'r', signaux: [] }],
      },
    ];
    const messages = detecterIncoherenceRoleVide(rapports);
    expect(messages.some((m) => m.includes('client'))).toBe(true);
  });

  it('ne signale rien quand le rôle central est bien représenté', () => {
    const rapports: RapportTable[] = [
      {
        table: 'Clients',
        lignesActives: 500,
        lignesSupprimees: 0,
        evaluations: [{ role: 'client', confiance: 0.7, raison: 'r', signaux: [] }],
      },
      {
        table: 'Factures',
        lignesActives: 2000,
        lignesSupprimees: 0,
        evaluations: [{ role: 'document_vente', confiance: 0.8, raison: 'r', signaux: [] }],
      },
    ];
    expect(detecterIncoherenceRoleVide(rapports)).toEqual([]);
  });
});
