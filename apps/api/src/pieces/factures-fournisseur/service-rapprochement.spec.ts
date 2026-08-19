import { describe, expect, it } from 'vitest';

import type { DonneesFactureExtraites, LigneFactureExtraite } from './lecture/types';
import {
  assemblerResultatRapprochement,
  normaliserPourComparaisonExacte,
  rapprocherLignes,
  trouverCommandeExacte,
  trouverFournisseurExact,
  type CandidatCommandeFournisseur,
  type CandidatFournisseur,
} from './service-rapprochement';

function donnees(partiel: Partial<DonneesFactureExtraites>): DonneesFactureExtraites {
  return { enTete: {}, lignes: [], diagnostics: [], texteIntegral: null, ...partiel };
}

function ligneExtraite(partiel: Partial<LigneFactureExtraite>): LigneFactureExtraite {
  return {
    referenceArticle: 'ABC-123',
    designation: 'Filtre à huile',
    quantiteMillieme: 4000,
    prixUnitaireCentimes: 1250,
    totalLigneCentimes: 5000,
    origine: 'texte_pdf',
    ...partiel,
  };
}

describe('normaliserPourComparaisonExacte', () => {
  it('trim, espaces multiples et casse — rien d’autre', () => {
    expect(normaliserPourComparaisonExacte('  Garage   Martin  Sàrl ')).toBe('garage martin sàrl');
  });

  it('deux noms réellement différents restent différents', () => {
    expect(normaliserPourComparaisonExacte('Garage Martin')).not.toBe(
      normaliserPourComparaisonExacte('Garage Martini'),
    );
  });
});

describe('trouverFournisseurExact', () => {
  const candidats: readonly CandidatFournisseur[] = [
    { id: 'f1', nom: 'Bosch Service SA' },
    { id: 'f2', nom: 'Febi Distribution' },
  ];

  it('correspondance exacte (normalisée) -> id', () => {
    const d = donnees({
      enTete: { nomCreancier: { valeur: '  bosch service sa  ', origine: 'qr' } },
    });
    expect(trouverFournisseurExact(d, candidats)).toBe('f1');
  });

  it('aucune correspondance -> null', () => {
    const d = donnees({ enTete: { nomCreancier: { valeur: 'Un Inconnu SA', origine: 'qr' } } });
    expect(trouverFournisseurExact(d, candidats)).toBeNull();
  });

  it('nom créancier absent -> null (jamais de recherche à l’aveugle)', () => {
    expect(trouverFournisseurExact(donnees({}), candidats)).toBeNull();
  });

  it('deux fournisseurs au même nom normalisé -> null (ambiguïté, jamais un choix arbitraire)', () => {
    const doublon: readonly CandidatFournisseur[] = [
      { id: 'f1', nom: 'Bosch Service SA' },
      { id: 'f3', nom: 'bosch service sa' },
    ];
    const d = donnees({ enTete: { nomCreancier: { valeur: 'Bosch Service SA', origine: 'qr' } } });
    expect(trouverFournisseurExact(d, doublon)).toBeNull();
  });
});

describe('trouverCommandeExacte', () => {
  const candidats: readonly CandidatCommandeFournisseur[] = [
    { id: 'c1', reference: 'PO-2026-0042', lignes: [] },
    { id: 'c2', reference: null, lignes: [] },
  ];

  it('référence trouvée EXACTEMENT (sous-chaîne normalisée) dans le texte -> id', () => {
    const d = donnees({ texteIntegral: 'Facture pour votre commande PO-2026-0042, merci.' });
    expect(trouverCommandeExacte(d, candidats)).toBe('c1');
  });

  it('texte intégral absent -> null', () => {
    expect(trouverCommandeExacte(donnees({ texteIntegral: null }), candidats)).toBeNull();
  });

  it('référence absente du texte -> null', () => {
    const d = donnees({ texteIntegral: 'Aucune référence ici.' });
    expect(trouverCommandeExacte(d, candidats)).toBeNull();
  });

  it('deux commandes dont la référence apparaît toutes deux -> null (ambiguïté)', () => {
    const deux: readonly CandidatCommandeFournisseur[] = [
      { id: 'c1', reference: 'PO-42', lignes: [] },
      { id: 'c2', reference: 'PO-4', lignes: [] }, // sous-chaîne de "PO-42" ET présente seule
    ];
    const d = donnees({ texteIntegral: 'Réf PO-42 et aussi PO-4 séparément mentionnée.' });
    expect(trouverCommandeExacte(d, deux)).toBeNull();
  });
});

describe('rapprocherLignes — écarts en centimes entiers, jamais de flottant', () => {
  const commande: CandidatCommandeFournisseur = {
    id: 'cmd-1',
    reference: 'PO-1',
    lignes: [
      {
        id: 'ligne-cmd-1',
        articleId: 'art-1',
        referenceArticle: 'ABC-123',
        quantiteReliquatMillieme: 4000,
        prixAchatAttenduCentimes: 1200,
      },
    ],
  };

  it('ligne exacte, prix ET quantité conformes -> écart nul (zéro, pas absent)', () => {
    const ligne = ligneExtraite({
      referenceArticle: 'ABC-123',
      quantiteMillieme: 4000,
      prixUnitaireCentimes: 1200,
      totalLigneCentimes: 4800,
    });
    const [resultat] = rapprocherLignes([ligne], commande);
    expect(resultat?.articleId).toBe('art-1');
    expect(resultat?.commandeFournisseurLigneId).toBe('ligne-cmd-1');
    expect(resultat?.ecart).toEqual({
      prixUnitaireCentimes: 0,
      quantiteMillieme: 0,
      totalCentimes: 0,
    });
  });

  it('surfacturation détectée exactement — le cas qui fait perdre de l’argent', () => {
    const ligne = ligneExtraite({
      referenceArticle: 'ABC-123',
      quantiteMillieme: 4000,
      prixUnitaireCentimes: 1250, // 50 centimes de trop par unité
      totalLigneCentimes: 5000,
    });
    const [resultat] = rapprocherLignes([ligne], commande);
    expect(resultat?.ecart).toEqual({
      prixUnitaireCentimes: 50, // 1250 - 1200
      quantiteMillieme: 0,
      totalCentimes: 200, // 5000 facturé - (1200 * 4000 / 1000 = 4800 attendu)
    });
  });

  it('quantité livrée inférieure au reliquat — écart de quantité négatif', () => {
    const ligne = ligneExtraite({
      referenceArticle: 'ABC-123',
      quantiteMillieme: 2000,
      prixUnitaireCentimes: 1200,
      totalLigneCentimes: 2400,
    });
    const [resultat] = rapprocherLignes([ligne], commande);
    expect(resultat?.ecart?.quantiteMillieme).toBe(-2000);
  });

  it('référence sans correspondance exacte -> ligne non rapprochée, écart null', () => {
    const ligne = ligneExtraite({ referenceArticle: 'INCONNUE-999' });
    const [resultat] = rapprocherLignes([ligne], commande);
    expect(resultat?.articleId).toBeNull();
    expect(resultat?.commandeFournisseurLigneId).toBeNull();
    expect(resultat?.ecart).toBeNull();
  });

  it('aucune commande rapprochée -> aucune ligne rapprochée', () => {
    const ligne = ligneExtraite({});
    const [resultat] = rapprocherLignes([ligne], null);
    expect(resultat?.articleId).toBeNull();
    expect(resultat?.ecart).toBeNull();
  });

  it('ligne sans référence lue -> jamais rapprochée à l’aveugle', () => {
    const ligne = ligneExtraite({ referenceArticle: null });
    const [resultat] = rapprocherLignes([ligne], commande);
    expect(resultat?.articleId).toBeNull();
  });

  it('prix attendu jamais renseigné côté commande -> pas d’écart, mais ligne quand même rapprochée', () => {
    const commandeSansPrix: CandidatCommandeFournisseur = {
      ...commande,
      lignes: [{ ...commande.lignes[0]!, prixAchatAttenduCentimes: null }],
    };
    const ligne = ligneExtraite({ referenceArticle: 'ABC-123' });
    const [resultat] = rapprocherLignes([ligne], commandeSansPrix);
    expect(resultat?.articleId).toBe('art-1');
    expect(resultat?.ecart).toBeNull();
  });

  it('rapprochement approximatif refusé : deux lignes de commande partagent la même référence -> ni l’une ni l’autre', () => {
    const commandeAmbigue: CandidatCommandeFournisseur = {
      id: 'cmd-2',
      reference: 'PO-2',
      lignes: [
        {
          id: 'l1',
          articleId: 'art-1',
          referenceArticle: 'DUP-1',
          quantiteReliquatMillieme: 1000,
          prixAchatAttenduCentimes: 100,
        },
        {
          id: 'l2',
          articleId: 'art-2',
          referenceArticle: 'DUP-1',
          quantiteReliquatMillieme: 1000,
          prixAchatAttenduCentimes: 200,
        },
      ],
    };
    const ligne = ligneExtraite({ referenceArticle: 'DUP-1' });
    const [resultat] = rapprocherLignes([ligne], commandeAmbigue);
    expect(resultat?.articleId).toBeNull();
    expect(resultat?.commandeFournisseurLigneId).toBeNull();
  });
});

describe('assemblerResultatRapprochement', () => {
  it('assemble fournisseur + commande + lignes en un seul résultat', () => {
    const commande: CandidatCommandeFournisseur = {
      id: 'cmd-1',
      reference: 'PO-1',
      lignes: [
        {
          id: 'l1',
          articleId: 'art-1',
          referenceArticle: 'ABC-123',
          quantiteReliquatMillieme: 4000,
          prixAchatAttenduCentimes: 1200,
        },
      ],
    };
    const d = donnees({ lignes: [ligneExtraite({})] });
    const resultat = assemblerResultatRapprochement(d, 'f1', commande);
    expect(resultat.fournisseurId).toBe('f1');
    expect(resultat.commandeFournisseurId).toBe('cmd-1');
    expect(resultat.lignes).toHaveLength(1);
  });

  it('sans fournisseur ni commande -> tout est null, sans planter', () => {
    const d = donnees({ lignes: [ligneExtraite({})] });
    const resultat = assemblerResultatRapprochement(d, null, null);
    expect(resultat.fournisseurId).toBeNull();
    expect(resultat.commandeFournisseurId).toBeNull();
    expect(resultat.lignes[0]?.ecart).toBeNull();
  });
});
