import { describe, expect, it } from 'vitest';

import {
  NOMBRE_MAX_TENTATIVES_ENVOI,
  calculerPaliersDus,
  choisirCanalEtDestinataire,
  clientBloqueContact,
  construireContenuRappelFacture,
  factureEligibleRelance,
  formaterMontantChf,
  statutApresEchecEnvoi,
  statutInitialPlanification,
  verifierArretAutomatiqueFacture,
} from './regles-planification';

const J = 24 * 60 * 60 * 1000;

describe('calculerPaliersDus — §4, RA-05 (déterminisme, base de l’idempotence)', () => {
  const dateEcheance = new Date('2026-07-01T00:00:00.000Z');

  it('aucun palier dû avant le premier délai', () => {
    const maintenant = new Date(dateEcheance.getTime() + 6 * J);
    expect(calculerPaliersDus(dateEcheance, [7, 15], maintenant)).toEqual([]);
  });

  it('palier 1 dû pile à J+7, palier 2 pas encore', () => {
    const maintenant = new Date(dateEcheance.getTime() + 7 * J);
    const paliers = calculerPaliersDus(dateEcheance, [7, 15], maintenant);
    expect(paliers).toEqual([
      { palier: 1, echeancePrevue: new Date(dateEcheance.getTime() + 7 * J) },
    ]);
  });

  it('les deux paliers dus une fois J+15 dépassé', () => {
    const maintenant = new Date(dateEcheance.getTime() + 20 * J);
    const paliers = calculerPaliersDus(dateEcheance, [7, 15], maintenant);
    expect(paliers.map((p) => p.palier)).toEqual([1, 2]);
  });

  it(
    'déterministe : deux appels identiques rendent EXACTEMENT le même résultat — la garantie ' +
      'que la planification peut être rejouée sans jamais changer d’avis sur ce qui est dû ' +
      '(la protection physique contre le doublon reste la contrainte unique en base, RA-05)',
    () => {
      const maintenant = new Date(dateEcheance.getTime() + 20 * J);
      const premier = calculerPaliersDus(dateEcheance, [7, 15], maintenant);
      const second = calculerPaliersDus(dateEcheance, [7, 15], maintenant);
      expect(second).toEqual(premier);
    },
  );

  it('un tableau de délais vide ne produit jamais de palier', () => {
    expect(
      calculerPaliersDus(dateEcheance, [], new Date(dateEcheance.getTime() + 100 * J)),
    ).toEqual([]);
  });
});

describe('factureEligibleRelance — RA-08', () => {
  it('exclut un dossier en contentieux', () => {
    expect(factureEligibleRelance({ contentieux: true, statutReglement: 'non_regle' })).toBe(false);
  });

  it('exclut un dossier réglé', () => {
    expect(factureEligibleRelance({ contentieux: false, statutReglement: 'regle' })).toBe(false);
  });

  it('éligible sinon (non réglé, hors contentieux)', () => {
    expect(factureEligibleRelance({ contentieux: false, statutReglement: 'partiel' })).toBe(true);
    expect(factureEligibleRelance({ contentieux: false, statutReglement: null })).toBe(true);
  });
});

describe('clientBloqueContact — RA-14', () => {
  it('vrai seulement si plusAucunContact', () => {
    expect(clientBloqueContact({ plusAucunContact: true })).toBe(true);
    expect(clientBloqueContact({ plusAucunContact: false })).toBe(false);
  });
});

describe(
  'choisirCanalEtDestinataire — RA-03 (Famille A : aucun paramètre de consentement, ' +
    'jamais consulté — la signature elle-même en fait la preuve)',
  () => {
    it('retient le premier canal configuré qui a une coordonnée valide', () => {
      const resultat = choisirCanalEtDestinataire(['sms', 'email'], {
        email: 'client@example.ch',
        telephoneE164: '+41791234567',
      });
      expect(resultat).toEqual({ canal: 'sms', destinataire: '+41791234567' });
    });

    it('passe au canal suivant si le premier n’a pas de coordonnée', () => {
      const resultat = choisirCanalEtDestinataire(['sms', 'email'], {
        email: 'client@example.ch',
        telephoneE164: null,
      });
      expect(resultat).toEqual({ canal: 'email', destinataire: 'client@example.ch' });
    });

    it('rend null si aucun canal configuré n’a de coordonnée — jamais une erreur (RA-03)', () => {
      expect(
        choisirCanalEtDestinataire(['sms', 'email'], { email: null, telephoneE164: null }),
      ).toBeNull();
    });

    it(
      'un client SANS AUCUN consentement marketing (aucun champ de ce type n’existe même dans ' +
        'l’entrée) obtient quand même un canal dès qu’une coordonnée existe — Famille A',
      () => {
        const resultat = choisirCanalEtDestinataire(['email'], {
          email: 'client@example.ch',
          telephoneE164: null,
        });
        expect(resultat).not.toBeNull();
      },
    );
  },
);

describe('statutInitialPlanification — §8', () => {
  it('prete quand une coordonnée a été résolue', () => {
    expect(statutInitialPlanification({ canal: 'email', destinataire: 'a@b.ch' })).toBe('prete');
  });

  it('a_planifier quand aucune coordonnée n’a été résolue (RA-03)', () => {
    expect(statutInitialPlanification(null)).toBe('a_planifier');
  });
});

describe('verifierArretAutomatiqueFacture — RA-08/RA-14, priorité RA-14 (§9 cas n°8)', () => {
  it('rien ne s’oppose à l’envoi : null', () => {
    expect(
      verifierArretAutomatiqueFacture(
        { contentieux: false, statutReglement: 'non_regle' },
        { plusAucunContact: false },
      ),
    ).toBeNull();
  });

  it('contentieux → objet_traite (§9 cas n°4)', () => {
    expect(
      verifierArretAutomatiqueFacture(
        { contentieux: true, statutReglement: 'non_regle' },
        { plusAucunContact: false },
      ),
    ).toEqual({ raison: 'objet_traite' });
  });

  it('réglé → objet_traite (§9 cas n°1)', () => {
    expect(
      verifierArretAutomatiqueFacture(
        { contentieux: false, statutReglement: 'regle' },
        { plusAucunContact: false },
      ),
    ).toEqual({ raison: 'objet_traite' });
  });

  it(
    'RA-14 prime : un client "plus aucun contact" est bloqué même si la facture reste due ' +
      '(§9 cas n°8 — « plus aucun rappel, Famille A comprise »)',
    () => {
      expect(
        verifierArretAutomatiqueFacture(
          { contentieux: false, statutReglement: 'non_regle' },
          { plusAucunContact: true },
        ),
      ).toEqual({ raison: 'client_ne_plus_contacter' });
    },
  );

  it(
    'RA-14 prime MÊME sur un dossier par ailleurs déjà objet_traite : la raison rendue reste ' +
      'client_ne_plus_contacter, pas objet_traite',
    () => {
      expect(
        verifierArretAutomatiqueFacture(
          { contentieux: true, statutReglement: 'regle' },
          { plusAucunContact: true },
        ),
      ).toEqual({ raison: 'client_ne_plus_contacter' });
    },
  );
});

describe('statutApresEchecEnvoi — §6.1/§8, politique de réessai', () => {
  it(`retour à prete tant que la tentative < ${NOMBRE_MAX_TENTATIVES_ENVOI}`, () => {
    for (let tentative = 1; tentative < NOMBRE_MAX_TENTATIVES_ENVOI; tentative += 1) {
      expect(statutApresEchecEnvoi(tentative)).toBe('prete');
    }
  });

  it('echouee (définitif) une fois les tentatives épuisées', () => {
    expect(statutApresEchecEnvoi(NOMBRE_MAX_TENTATIVES_ENVOI)).toBe('echouee');
    expect(statutApresEchecEnvoi(NOMBRE_MAX_TENTATIVES_ENVOI + 1)).toBe('echouee');
  });
});

describe("formaterMontantChf — 1'234.50, jamais un float", () => {
  it('groupe les milliers avec une apostrophe', () => {
    expect(formaterMontantChf(123456)).toBe("1'234.56");
  });
  it('sans groupement sous 1000 francs', () => {
    expect(formaterMontantChf(5000)).toBe('50.00');
  });
  it('gère un montant négatif (avoir)', () => {
    expect(formaterMontantChf(-250)).toBe('-2.50');
  });
  it('zéro', () => {
    expect(formaterMontantChf(0)).toBe('0.00');
  });
});

describe('construireContenuRappelFacture — RA-11 (langue lue à l’envoi), RA-12 (contenu figé)', () => {
  const base = {
    palier: 2,
    numero: 'F-2026-000123',
    totalTtcCentimes: 120050,
    soldeCentimes: 120050,
    dateEcheance: new Date('2026-06-01T00:00:00.000Z'),
  };

  it('canal sms : texte seul, pas de sujet/html', () => {
    const contenu = construireContenuRappelFacture({
      ...base,
      langue: 'fr',
      canal: 'sms',
      destinataire: '+41791234567',
    });
    expect(contenu.canal).toBe('sms');
    if (contenu.canal === 'sms') {
      expect(contenu.destinataire).toBe('+41791234567');
      expect(contenu.texte).toContain('F-2026-000123');
      expect(contenu.texte).toContain("1'200.50");
    }
  });

  it('canal email : sujet + texte, html null (aucun gabarit HTML dans ce lot)', () => {
    const contenu = construireContenuRappelFacture({
      ...base,
      langue: 'de',
      canal: 'email',
      destinataire: 'client@example.ch',
    });
    expect(contenu.canal).toBe('email');
    if (contenu.canal === 'email') {
      expect(contenu.destinataire).toBe('client@example.ch');
      expect(contenu.html).toBeNull();
      expect(contenu.sujet.length).toBeGreaterThan(0);
      expect(contenu.texte).toContain('F-2026-000123');
    }
  });

  it('la langue change réellement le texte produit (RA-11)', () => {
    const fr = construireContenuRappelFacture({
      ...base,
      langue: 'fr',
      canal: 'sms',
      destinataire: 'x',
    });
    const de = construireContenuRappelFacture({
      ...base,
      langue: 'de',
      canal: 'sms',
      destinataire: 'x',
    });
    const it_ = construireContenuRappelFacture({
      ...base,
      langue: 'it',
      canal: 'sms',
      destinataire: 'x',
    });
    const textes = [fr, de, it_].map((c) => (c.canal === 'sms' ? c.texte : ''));
    expect(new Set(textes).size).toBe(3);
  });
});
