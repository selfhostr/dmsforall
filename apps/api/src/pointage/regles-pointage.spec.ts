import { describe, expect, it } from 'vitest';
import type { EntreeDemarragePointage } from '@dfa/shared';
import type { LignePointage } from '../db/schema';
import {
  calculerAgregatsTempsLigne,
  calculerClotureChevauchement,
  calculerDureeArrondieCentiemes,
  chevauchementDoitProduireAnomalie,
  deriveHorlogeAnormale,
  determinerDecisionClotureAutomatique,
  dureeDepasseLeSeuil,
  estLignePointable,
  estOrPointable,
  journeeTravailCourante,
  ligneDevenueNonPointable,
  ligneDoitPasserEnCours,
  orDevenuNonPointable,
  orDoitPasserEnCours,
  pointageCorrespondEntree,
  resoudreCibleReprise,
  SEUIL_DERIVE_HORLOGE_MS,
  type CandidatClotureAutomatique,
  type LigneOrPourAgregat,
  type PointagePourAgregat,
  type PointageProductifDuJour,
} from './regles-pointage';

function pointageEnBase(surcharge: Partial<LignePointage> = {}): LignePointage {
  return {
    id: 'p1',
    tenantId: 't1',
    siteId: 's1',
    technicienId: 'tech1',
    statut: 'en_cours',
    nature: 'productif_ligne',
    ordreReparationId: 'or1',
    ligneOrId: 'l1',
    activiteIndirecte: null,
    source: 'ecran_atelier',
    appareilId: null,
    debutLe: new Date('2026-07-31T08:00:00.000Z'),
    finLe: null,
    dureeArrondieCentiemes: null,
    decalageHorlogeMsDebut: null,
    decalageHorlogeMsFin: null,
    clotureAutomatique: false,
    anomalieMotif: null,
    anomalieDetecteeLe: null,
    anomalieTraiteeLe: null,
    derniereCorrectionMotif: null,
    derniereCorrectionParUtilisateurId: null,
    derniereCorrectionLe: null,
    debutLeOrigine: null,
    finLeOrigine: null,
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    modifieLe: new Date('2026-07-31T08:00:00.000Z'),
    ...surcharge,
  } as LignePointage;
}

function entreeDemarrage(
  surcharge: Partial<EntreeDemarragePointage> = {},
): EntreeDemarragePointage {
  return {
    id: 'p1',
    siteId: 's1',
    technicienId: 'tech1',
    nature: 'productif_ligne',
    ordreReparationId: 'or1',
    ligneOrId: 'l1',
    debutLe: '2026-07-31T08:00:00.000Z',
    source: 'ecran_atelier',
    ...surcharge,
  } as EntreeDemarragePointage;
}

describe('estOrPointable (RM-92)', () => {
  it.each(['planifie', 'ouvert', 'en_cours', 'controle'] as const)(
    '%s reste pointable',
    (statut) => {
      expect(estOrPointable(statut)).toBe(true);
    },
  );

  it.each(['termine', 'facture', 'restitue', 'cloture', 'annule'] as const)(
    '%s n’est plus pointable',
    (statut) => {
      expect(estOrPointable(statut)).toBe(false);
    },
  );
});

describe('estLignePointable (RM-93, élargi — voir regles-pointage.ts)', () => {
  it.each(['validee', 'en_cours'] as const)('%s est pointable', (statut) => {
    expect(estLignePointable(statut)).toBe(true);
  });

  it.each(['proposee', 'a_valider', 'refusee', 'annulee', 'realisee', 'facturee'] as const)(
    '%s n’est pas pointable',
    (statut) => {
      expect(estLignePointable(statut)).toBe(false);
    },
  );
});

describe('cascade RM-117', () => {
  it("une ligne 'validee' doit passer en_cours", () => {
    expect(ligneDoitPasserEnCours('validee')).toBe(true);
  });

  it("une ligne déjà 'en_cours' (RM-121, second technicien) ne redéclenche pas la transition", () => {
    expect(ligneDoitPasserEnCours('en_cours')).toBe(false);
  });

  it("un OR 'ouvert' doit passer en_cours (T-04)", () => {
    expect(orDoitPasserEnCours('ouvert')).toBe(true);
  });

  it("un OR déjà 'en_cours' ne redéclenche rien", () => {
    expect(orDoitPasserEnCours('en_cours')).toBe(false);
  });
});

describe('calculerClotureChevauchement (RM-89/RM-90)', () => {
  it('enchaînement normal : ferme au début du nouveau pointage, aucune inversion', () => {
    const ancien = new Date('2026-07-31T08:00:00.000Z');
    const nouveau = new Date('2026-07-31T09:30:00.000Z');
    const maintenant = new Date('2026-07-31T09:30:05.000Z');
    const resultat = calculerClotureChevauchement(ancien, nouveau, maintenant);
    expect(resultat.finLe).toEqual(nouveau);
    expect(resultat.ordreInverse).toBe(false);
  });

  it(
    'BUG CORRIGÉ — horloge en désordre (nouveau déclaré avant ancien) : ferme sur l’horloge ' +
      'SERVEUR, pas sur l’ancien départ — avant ce correctif, `finLe := ancienDebutLe` mettait la ' +
      'durée à zéro quelle que soit la durée réellement écoulée ; ce test verrouille la valeur ' +
      'exacte désormais produite',
    () => {
      const ancien = new Date('2026-07-31T08:00:00.000Z');
      const nouveau = new Date('2026-07-31T07:00:00.000Z'); // horloge du second appareil en retard
      const maintenant = new Date('2026-07-31T18:45:00.000Z'); // 10h45 réellement écoulées
      const resultat = calculerClotureChevauchement(ancien, nouveau, maintenant);
      expect(resultat.ordreInverse).toBe(true);
      expect(resultat.finLe).toEqual(maintenant);
      expect(resultat.finLe.getTime()).not.toEqual(ancien.getTime());
    },
  );

  it('horloge en désordre ET horloge serveur elle-même antérieure à l’ancien départ (cas résiduel, extrême) : repli sur l’ancien départ, jamais de durée négative', () => {
    const ancien = new Date('2026-07-31T09:00:00.000Z');
    const nouveau = new Date('2026-07-31T08:00:00.000Z');
    const maintenant = new Date('2026-07-31T08:30:00.000Z'); // toujours avant `ancien`
    const resultat = calculerClotureChevauchement(ancien, nouveau, maintenant);
    expect(resultat.ordreInverse).toBe(true);
    expect(resultat.finLe).toEqual(ancien);
    expect(resultat.finLe.getTime()).toBeGreaterThanOrEqual(ancien.getTime());
  });

  it('égalité stricte (même instant) : pas une inversion, durée nulle acceptée', () => {
    const meme = new Date('2026-07-31T08:00:00.000Z');
    const resultat = calculerClotureChevauchement(meme, meme, meme);
    expect(resultat.ordreInverse).toBe(false);
    expect(resultat.finLe).toEqual(meme);
  });
});

describe('chevauchementDoitProduireAnomalie (RM-89 défaut vs RM-90 P-06)', () => {
  it('RM-89 (P-06 faux, défaut) : une inversion produit une anomalie', () => {
    expect(chevauchementDoitProduireAnomalie(true, false)).toBe(true);
  });

  it('RM-90 (P-06 vrai) : la même inversion est tolérée, aucune anomalie', () => {
    expect(chevauchementDoitProduireAnomalie(true, true)).toBe(false);
  });

  it('sans inversion, jamais d’anomalie, quel que soit P-06', () => {
    expect(chevauchementDoitProduireAnomalie(false, false)).toBe(false);
    expect(chevauchementDoitProduireAnomalie(false, true)).toBe(false);
  });
});

describe('calculerDureeArrondieCentiemes (RM-97, P-19)', () => {
  it("'quart' (900 s) : 50 minutes (3000 s) arrondit à 45 min -> 75 centièmes", () => {
    // 3000 / 900 = 3.33 -> round -> 3 * 900 = 2700 s = 0.75 h = 75 centièmes.
    expect(calculerDureeArrondieCentiemes(3000, 'quart')).toBe(75);
  });

  it("'quart' : 6m40 (400 s, moins que la moitié de l'unité 900 s) arrondit à 0", () => {
    expect(calculerDureeArrondieCentiemes(400, 'quart')).toBe(0);
  });

  it("'dixieme' (360 s) : 20 minutes (1200 s) arrondit à 1200/360=3.33 -> 3*360=1080s -> 30 centièmes", () => {
    expect(calculerDureeArrondieCentiemes(1200, 'dixieme')).toBe(30);
  });

  it("'minute' (60 s) : 90 secondes arrondit à 60 s (arrondi commercial : 1.5 -> 2 en JS Math.round) -> vérifie la valeur exacte produite", () => {
    // 90 / 60 = 1.5 -> Math.round(1.5) = 2 -> 120 s = 1/30 h -> 100/30 = 3.33... -> round -> 3.
    expect(calculerDureeArrondieCentiemes(90, 'minute')).toBe(3);
  });

  it('une durée nulle reste nulle quel que soit l’arrondi', () => {
    expect(calculerDureeArrondieCentiemes(0, 'quart')).toBe(0);
    expect(calculerDureeArrondieCentiemes(0, 'minute')).toBe(0);
  });

  it('jamais de flottant en sortie (garde arithmétique financière/temporelle du dépôt)', () => {
    const resultat = calculerDureeArrondieCentiemes(3661, 'minute');
    expect(Number.isInteger(resultat)).toBe(true);
  });

  /**
   * Valeurs limites explicitement demandées (défaut constaté : un pointage de 60 s rendait
   * `dureeArrondieCentiemes: 0` pendant qu'un autre affichage lisait `dureeBruteSecondes` comme
   * « 1 min » — DEUX lectures d'une même donnée, jamais réconciliées). Ces tests verrouillent, à la
   * valeur EXACTE (jamais `toBeCloseTo` — RM-97 est de l'argent), le comportement des trois arrondis
   * P-19 sur `[0, 1, 59, 60, 61, 89, 90]` secondes : les bornes autour d'1 minute (59/60/61) et
   * autour d'1,5 minute (89/90 — le point de bascule d'un arrondi commercial au-dessus de 90 s
   * exactement) pour `'minute'`, et la confirmation que `'dixieme'`/`'quart'` rendent TOUS 0 sur
   * cette plage (rien dans ces 90 premières secondes n'atteint la moitié de leur unité — 180 s pour
   * `'dixieme'`, 450 s pour `'quart'` — c'est le comportement voulu de P-19, pas un défaut).
   */
  describe('valeurs limites 0/1/59/60/61/89/90 s — les trois arrondis P-19', () => {
    it.each([
      [0, 0],
      [1, 0],
      [59, 2],
      [60, 2],
      [61, 2],
      [89, 2],
      [90, 3],
    ])('minute : %i s -> %i centièmes', (secondes, attendu) => {
      expect(calculerDureeArrondieCentiemes(secondes, 'minute')).toBe(attendu);
    });

    it.each([0, 1, 59, 60, 61, 89, 90])(
      'dixieme : %i s -> 0 centième (bien en-deçà de la moitié de l’unité, 180 s)',
      (secondes) => {
        expect(calculerDureeArrondieCentiemes(secondes, 'dixieme')).toBe(0);
      },
    );

    it.each([0, 1, 59, 60, 61, 89, 90])(
      'quart : %i s -> 0 centième (bien en-deçà de la moitié de l’unité, 450 s) — ' +
        'c’est CE cas, avec l’arrondi par défaut du tenant (`quart`), qui produit `0 min` pour un ' +
        'pointage de 60 s : comportement voulu de P-19, pas un défaut',
      (secondes) => {
        expect(calculerDureeArrondieCentiemes(secondes, 'quart')).toBe(0);
      },
    );
  });
});

describe('dureeDepasseLeSeuil (RM-96, défaut 10 h)', () => {
  it('9h59 ne dépasse pas un seuil de 10h', () => {
    expect(dureeDepasseLeSeuil(9 * 3600 + 59 * 60, 10)).toBe(false);
  });

  it('exactement 10h ne dépasse pas (borne incluse dans le seuil, exclue de l’anomalie)', () => {
    expect(dureeDepasseLeSeuil(10 * 3600, 10)).toBe(false);
  });

  it('10h01 dépasse un seuil de 10h', () => {
    expect(dureeDepasseLeSeuil(10 * 3600 + 60, 10)).toBe(true);
  });
});

describe('deriveHorlogeAnormale', () => {
  it('absent (hors ligne, non déclaré) : jamais anormal', () => {
    expect(deriveHorlogeAnormale(undefined)).toBe(false);
    expect(deriveHorlogeAnormale(null)).toBe(false);
  });

  it('dans la tolérance (+/- 5 min) : normal', () => {
    expect(deriveHorlogeAnormale(SEUIL_DERIVE_HORLOGE_MS)).toBe(false);
    expect(deriveHorlogeAnormale(-SEUIL_DERIVE_HORLOGE_MS)).toBe(false);
  });

  it('au-delà de la tolérance, dans les deux sens (avance ou retard) : anormal', () => {
    expect(deriveHorlogeAnormale(SEUIL_DERIVE_HORLOGE_MS + 1)).toBe(true);
    expect(deriveHorlogeAnormale(-(SEUIL_DERIVE_HORLOGE_MS + 1))).toBe(true);
  });
});

describe('RM-123 : détection différée', () => {
  it.each(['annulee', 'refusee'] as const)('ligne %s devient non pointable', (statut) => {
    expect(ligneDevenueNonPointable(statut)).toBe(true);
  });

  it.each(['validee', 'en_cours', 'realisee'] as const)('ligne %s reste correcte', (statut) => {
    expect(ligneDevenueNonPointable(statut)).toBe(false);
  });

  it.each(['facture', 'restitue', 'cloture', 'annule'] as const)(
    'OR %s devient non pointable',
    (statut) => {
      expect(orDevenuNonPointable(statut)).toBe(true);
    },
  );

  it.each(['ouvert', 'en_cours', 'controle'] as const)('OR %s reste correct', (statut) => {
    expect(orDevenuNonPointable(statut)).toBe(false);
  });
});

describe('pointageCorrespondEntree (idempotence de second niveau, collision sur id)', () => {
  it('un rejeu identique (même geste) correspond', () => {
    expect(pointageCorrespondEntree(pointageEnBase(), entreeDemarrage())).toBe(true);
  });

  it('un rejeu identique dont seuls le canal (source/appareilId) diffèrent correspond quand même', () => {
    const entree = entreeDemarrage({ source: 'mobile', appareilId: 'tablette-042' });
    expect(pointageCorrespondEntree(pointageEnBase(), entree)).toBe(true);
  });

  it('un technicien différent est une collision réelle', () => {
    expect(
      pointageCorrespondEntree(pointageEnBase(), entreeDemarrage({ technicienId: 'tech2' })),
    ).toBe(false);
  });

  it('une cible différente (autre ligne) est une collision réelle', () => {
    expect(pointageCorrespondEntree(pointageEnBase(), entreeDemarrage({ ligneOrId: 'l2' }))).toBe(
      false,
    );
  });

  it('une nature différente est une collision réelle', () => {
    const entree = {
      id: 'p1',
      siteId: 's1',
      technicienId: 'tech1',
      nature: 'productif_or',
      ordreReparationId: 'or1',
      debutLe: '2026-07-31T08:00:00.000Z',
      source: 'ecran_atelier',
    } as EntreeDemarragePointage;
    expect(pointageCorrespondEntree(pointageEnBase(), entree)).toBe(false);
  });

  it('un debutLe différent est une collision réelle', () => {
    expect(
      pointageCorrespondEntree(
        pointageEnBase(),
        entreeDemarrage({ debutLe: '2026-07-31T09:00:00.000Z' }),
      ),
    ).toBe(false);
  });
});

describe('calculerAgregatsTempsLigne (GET /pointages/agregats-ligne)', () => {
  function ligne(surcharge: Partial<LigneOrPourAgregat> = {}): LigneOrPourAgregat {
    return {
      id: 'l1',
      ordreReparationId: 'or1',
      numeroOrdre: 1,
      tempsBaremeCentiemes: 100,
      ...surcharge,
    };
  }

  function pointagePourAgregat(surcharge: Partial<PointagePourAgregat> = {}): PointagePourAgregat {
    return { ligneOrId: 'l1', statut: 'termine', dureeArrondieCentiemes: 50, ...surcharge };
  }

  it('une ligne barémée jamais pointée apparaît quand même, à zéro — « pas commencée » est une information', () => {
    const resultat = calculerAgregatsTempsLigne([ligne()], []);
    expect(resultat).toEqual([
      {
        ligneOrId: 'l1',
        ordreReparationId: 'or1',
        dureePointeeCentiemes: 0,
        nombrePointages: 0,
        pointageEnCours: false,
        tempsBaremeCentiemes: 100,
        ecartCentiemes: -100,
      },
    ]);
  });

  it('une ligne ni barémée ni pointée est omise (rien à raconter)', () => {
    const resultat = calculerAgregatsTempsLigne([ligne({ tempsBaremeCentiemes: null })], []);
    expect(resultat).toEqual([]);
  });

  it('une ligne pointée mais sans temps barémé apparaît, écart null (rien à comparer)', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne({ tempsBaremeCentiemes: null })],
      [pointagePourAgregat()],
    );
    expect(resultat).toEqual([
      expect.objectContaining({
        dureePointeeCentiemes: 50,
        tempsBaremeCentiemes: null,
        ecartCentiemes: null,
      }),
    ]);
  });

  it('plusieurs pointages fermés sur la même ligne : la durée pointée est la SOMME', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne()],
      [
        pointagePourAgregat({ dureeArrondieCentiemes: 50 }),
        pointagePourAgregat({ dureeArrondieCentiemes: 30, statut: 'valide' }),
      ],
    );
    expect(resultat[0]?.dureePointeeCentiemes).toBe(80);
    expect(resultat[0]?.nombrePointages).toBe(2);
  });

  it("un pointage 'en_cours' compte dans nombrePointages/pointageEnCours mais JAMAIS dans la durée (RM-97 : pas encore figée)", () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne()],
      [pointagePourAgregat({ statut: 'en_cours', dureeArrondieCentiemes: null })],
    );
    expect(resultat[0]).toMatchObject({
      dureePointeeCentiemes: 0,
      nombrePointages: 1,
      pointageEnCours: true,
    });
  });

  it.each(['termine', 'valide', 'verrouille'] as const)(
    "un pointage '%s' EST compté dans la durée acquise",
    (statut) => {
      const resultat = calculerAgregatsTempsLigne(
        [ligne()],
        [pointagePourAgregat({ statut, dureeArrondieCentiemes: 25 })],
      );
      expect(resultat[0]?.dureePointeeCentiemes).toBe(25);
    },
  );

  it('ecartCentiemes = pointé − barémé, positif = dépassement du temps vendu', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne({ tempsBaremeCentiemes: 60 })],
      [pointagePourAgregat({ dureeArrondieCentiemes: 90 })],
    );
    expect(resultat[0]?.ecartCentiemes).toBe(30);
  });

  it('ecartCentiemes négatif = marge de temps restante (pointé sous le barème)', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne({ tempsBaremeCentiemes: 100 })],
      [pointagePourAgregat({ dureeArrondieCentiemes: 40 })],
    );
    expect(resultat[0]?.ecartCentiemes).toBe(-60);
  });

  it('un pointage sans ligneOrId (defensif — la requête SQL les exclut déjà) est ignoré sans planter', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne()],
      [pointagePourAgregat({ ligneOrId: null })],
    );
    expect(resultat[0]?.dureePointeeCentiemes).toBe(0);
    expect(resultat[0]?.nombrePointages).toBe(0);
  });

  it('un pointage sur une ligne absente de la liste (autre OR) est ignoré — jamais une entrée fantôme', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne({ id: 'l1' })],
      [pointagePourAgregat({ ligneOrId: 'l-autre' })],
    );
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.ligneOrId).toBe('l1');
    expect(resultat[0]?.dureePointeeCentiemes).toBe(0);
  });

  it('résultat trié par numeroOrdre croissant, quel que soit l’ordre d’entrée', () => {
    const resultat = calculerAgregatsTempsLigne(
      [
        ligne({ id: 'l3', numeroOrdre: 3 }),
        ligne({ id: 'l1', numeroOrdre: 1 }),
        ligne({ id: 'l2', numeroOrdre: 2 }),
      ],
      [],
    );
    expect(resultat.map((a) => a.ligneOrId)).toEqual(['l1', 'l2', 'l3']);
  });

  it('aucune ligne, aucun pointage : liste vide', () => {
    expect(calculerAgregatsTempsLigne([], [])).toEqual([]);
  });

  it('jamais de flottant en sortie (garde arithmétique temporelle du dépôt)', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne({ tempsBaremeCentiemes: 33 })],
      [pointagePourAgregat({ dureeArrondieCentiemes: 17 })],
    );
    expect(Number.isInteger(resultat[0]?.dureePointeeCentiemes)).toBe(true);
    expect(Number.isInteger(resultat[0]?.ecartCentiemes)).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* RM-91 / RM-119 / CT-57 : determinerDecisionClotureAutomatique                                   */
/* -------------------------------------------------------------------------------------------- */

function candidatCloture(
  surcharge: Partial<CandidatClotureAutomatique> = {},
): CandidatClotureAutomatique {
  return {
    id: 'p1',
    debutLe: new Date('2026-06-10T06:00:00.000Z'), // 08:00 heure suisse (CEST, +2h)
    heureCloturePointage: '18:00',
    arrondiPointage: 'quart',
    anomalieMotif: null,
    anomalieDetecteeLe: null,
    ...surcharge,
  };
}

describe('determinerDecisionClotureAutomatique — RM-91/RM-119/CT-57', () => {
  it("rend null : l'heure de clôture du jour d'ouverture n'est pas encore atteinte", () => {
    // 18:00 heure suisse le 10.06.2026 (CEST, +2h) = 16:00:00.000Z. `maintenant` = 15:00Z = 17:00
    // local, une heure AVANT la clôture — rien à faire.
    const decision = determinerDecisionClotureAutomatique(
      candidatCloture(),
      new Date('2026-06-10T15:00:00.000Z'),
    );
    expect(decision).toBeNull();
  });

  it("clôture au bon instant, avec la durée exacte, dès que l'heure de clôture du jour d'ouverture est atteinte", () => {
    // debutLe 06:00Z (08:00 local), clôture 18:00 local = 16:00Z, maintenant 17:00Z (après).
    const decision = determinerDecisionClotureAutomatique(
      candidatCloture(),
      new Date('2026-06-10T17:00:00.000Z'),
    );
    expect(decision).not.toBeNull();
    expect(decision?.finLe.toISOString()).toBe('2026-06-10T16:00:00.000Z');
    // 10h brutes -> arrondi 'quart' -> 1000 centièmes (10.00h), valeur exacte, jamais approximée.
    expect(decision?.dureeArrondieCentiemes).toBe(1000);
  });

  it('CT-57 — absence prolongée : un pointage oublié deux semaines se clôture le SOIR MÊME de son ouverture, pas à la date de détection', () => {
    // Ouvert le 05.01.2026 à 08:00 heure suisse (CET, +1h) = 07:00Z. Clôture du site 18:00 local.
    const candidat = candidatCloture({
      debutLe: new Date('2026-01-05T07:00:00.000Z'),
    });
    // Le job ne tourne enfin QUE deux semaines plus tard.
    const decision = determinerDecisionClotureAutomatique(
      candidat,
      new Date('2026-01-19T09:00:00.000Z'),
    );
    expect(decision).not.toBeNull();
    // finLe = l'heure de clôture DU 05.01.2026 (17:00Z, 18:00 CET) — jamais le 19.01, jamais
    // `maintenant`.
    expect(decision?.finLe.toISOString()).toBe('2026-01-05T17:00:00.000Z');
    expect(decision?.dureeArrondieCentiemes).toBe(1000); // même 10h que le cas nominal.
  });

  it('garde pointage_periode_coherente_chk : un pointage démarré APRÈS l’heure de clôture nominale de son propre jour ne reçoit jamais un finLe antérieur à debutLe', () => {
    // Démarré à 19:30 heure suisse (17:30Z), après la clôture nominale (18:00 local = 16:00Z).
    const candidat = candidatCloture({ debutLe: new Date('2026-06-10T17:30:00.000Z') });
    const decision = determinerDecisionClotureAutomatique(
      candidat,
      new Date('2026-06-10T20:00:00.000Z'),
    );
    expect(decision).not.toBeNull();
    expect(decision?.finLe.getTime()).toBe(candidat.debutLe.getTime());
    expect(decision?.dureeArrondieCentiemes).toBe(0);
  });

  it('sans anomalie préexistante : pose cloture_fin_journee, détectée à `maintenant`', () => {
    const maintenant = new Date('2026-06-10T17:00:00.000Z');
    const decision = determinerDecisionClotureAutomatique(candidatCloture(), maintenant);
    expect(decision?.anomalieMotif).toBe('cloture_fin_journee');
    expect(decision?.anomalieDetecteeLe.getTime()).toBe(maintenant.getTime());
  });

  it('anomalie PRÉEXISTANTE (RM-123) préservée — jamais écrasée par la clôture automatique', () => {
    const detecteeLeOrigine = new Date('2026-06-10T10:00:00.000Z');
    const candidat = candidatCloture({
      anomalieMotif: 'ligne_non_pointable',
      anomalieDetecteeLe: detecteeLeOrigine,
    });
    const decision = determinerDecisionClotureAutomatique(
      candidat,
      new Date('2026-06-10T17:00:00.000Z'),
    );
    expect(decision?.anomalieMotif).toBe('ligne_non_pointable');
    expect(decision?.anomalieDetecteeLe.getTime()).toBe(detecteeLeOrigine.getTime());
  });

  it('accepte le format HH:MM:SS rendu par la colonne `time` de Postgres', () => {
    const decision = determinerDecisionClotureAutomatique(
      candidatCloture({ heureCloturePointage: '18:00:00' }),
      new Date('2026-06-10T17:00:00.000Z'),
    );
    expect(decision?.finLe.toISOString()).toBe('2026-06-10T16:00:00.000Z');
  });
});

describe('journeeTravailCourante (GET /pointages/dernier-du-jour) — bornes HEURE SUISSE (Europe/Zurich), recâblée sur common/temps/fuseau-suisse.ts le 14.08.2026', () => {
  it('un instant en milieu de journée locale produit [00:00:00.000, 23:59:59.999] heure suisse du MÊME jour civil', () => {
    // 13:37:02.123Z = 15:37:02.123 heure suisse (CEST, +2h) le 14.08.2026 — même jour, sans ambiguïté.
    const bornes = journeeTravailCourante(new Date('2026-08-14T13:37:02.123Z'));
    expect(bornes.debutLe.toISOString()).toBe('2026-08-13T22:00:00.000Z'); // 00:00 locale le 14.08
    expect(bornes.finLe.toISOString()).toBe('2026-08-14T21:59:59.999Z'); // 23:59:59.999 locale le 14.08
  });

  it('exactement à la borne inférieure (minuit heure suisse) : ses propres bornes, pas décalées d’un jour', () => {
    const debutLocal = new Date('2026-08-13T22:00:00.000Z'); // 00:00:00.000 heure suisse le 14.08.2026
    const bornes = journeeTravailCourante(debutLocal);
    expect(bornes.debutLe.toISOString()).toBe('2026-08-13T22:00:00.000Z');
    expect(bornes.finLe.toISOString()).toBe('2026-08-14T21:59:59.999Z');
  });

  it('LE CAS QUI DIFFÉRENCIE DU BUG UTC PUR CORRIGÉ (14.08.2026) : 00h30 heure suisse appartient au jour civil suisse EN COURS, pas au jour UTC de la veille', () => {
    // 22:30:00.000Z le 14.08 == 00:30 heure suisse (CEST, +2h) le 15.08 — un pointage démarré à ce
    // moment appartient à la journée de travail du 15.08, PAS du 14.08 (ce qu'aurait rendu
    // `maintenant.toISOString().slice(0, 10)`, l'ancien bornage UTC pur — voir
    // `common/temps/fuseau-suisse.spec.ts` pour la même preuve au niveau de l'utilitaire seul,
    // et ici pour la preuve que `journeeTravailCourante`/`GET /pointages/dernier-du-jour` en
    // hérite réellement).
    const instant = new Date('2026-08-14T22:30:00.000Z');
    const bornes = journeeTravailCourante(instant);
    expect(bornes.debutLe.toISOString()).toBe('2026-08-14T22:00:00.000Z'); // 00:00 locale le 15.08
    expect(bornes.finLe.toISOString()).toBe('2026-08-15T21:59:59.999Z'); // 23:59:59.999 locale le 15.08

    // Le bug reproduit : bornage UTC pur aurait rattaché cet instant au 14.08 (jour UTC), pas au
    // 15.08 (jour civil suisse réel) — cette assertion documente l'écart, elle ne teste pas
    // `journeeTravailCourante` elle-même (qui, elle, rend désormais la bonne réponse ci-dessus).
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-14');
  });
});

describe('resoudreCibleReprise (GET /pointages/dernier-du-jour)', () => {
  const MAINTENANT = new Date('2026-08-14T15:00:00.000Z');

  function segment(surcharge: Partial<PointageProductifDuJour> = {}): PointageProductifDuJour {
    return {
      id: 'p1',
      ordreReparationId: 'or1',
      ligneOrId: 'l1',
      siteId: 'site1',
      debutLe: new Date('2026-08-14T08:00:00.000Z'),
      finLe: new Date('2026-08-14T09:00:00.000Z'),
      statutOr: 'en_cours',
      statutLigne: 'en_cours',
      numeroOr: 'OR-2026-00042',
      designationLigne: 'Remplacement plaquettes avant',
      ...surcharge,
    };
  }

  it('aucun pointage productif aujourd’hui : null', () => {
    expect(resoudreCibleReprise([], MAINTENANT)).toBeNull();
  });

  it('un seul segment de ligne, encore ouvert : type ligne, interrompuLe = maintenant (pas de vraie interruption), cumul = jusqu’à maintenant', () => {
    const resultat = resoudreCibleReprise(
      [
        segment({
          finLe: null,
          debutLe: new Date('2026-08-14T14:00:00.000Z'), // 1h avant MAINTENANT = 3600s
        }),
      ],
      MAINTENANT,
    );
    expect(resultat).toEqual({
      type: 'ligne',
      ordreReparationId: 'or1',
      numeroOr: 'OR-2026-00042',
      ligneOrId: 'l1',
      libelle: 'Remplacement plaquettes avant',
      siteId: 'site1',
      interrompuLe: MAINTENANT.toISOString(),
      cumulSecondesDuJour: 3600,
    });
  });

  it('le plus récent est un segment CLOS (le technicien a enchaîné sur une activité indirecte, déjà exclue en amont par la requête SQL) : c’est quand même la cible, interrompuLe = son finLe réel', () => {
    const resultat = resoudreCibleReprise(
      [
        segment({
          id: 'p-matin',
          debutLe: new Date('2026-08-14T08:00:00.000Z'),
          finLe: new Date('2026-08-14T09:00:00.000Z'),
        }),
        segment({
          id: 'p-plus-recent',
          debutLe: new Date('2026-08-14T10:00:00.000Z'),
          finLe: new Date('2026-08-14T10:45:00.000Z'), // 45 min = 2700s, le technicien s'est arrêté ici (RM-89/pause)
        }),
      ],
      MAINTENANT,
    );
    expect(resultat?.interrompuLe).toBe('2026-08-14T10:45:00.000Z');
  });

  it('cible la plus récente devenue non pointable (OR facturé) : null, AUCUN repli sur un segment plus ancien encore pointable', () => {
    const resultat = resoudreCibleReprise(
      [
        segment({
          id: 'p-ancien',
          debutLe: new Date('2026-08-14T08:00:00.000Z'),
          statutOr: 'en_cours',
        }),
        segment({
          id: 'p-recent-facture',
          debutLe: new Date('2026-08-14T10:00:00.000Z'),
          statutOr: 'facture',
        }),
      ],
      MAINTENANT,
    );
    expect(resultat).toBeNull();
  });

  it('cible la plus récente sur une ligne devenue annulée (OR sain, ligne non pointable) : null', () => {
    const resultat = resoudreCibleReprise(
      [segment({ statutOr: 'en_cours', statutLigne: 'annulee' })],
      MAINTENANT,
    );
    expect(resultat).toBeNull();
  });

  it('type "or" (productif_or, sans ligne) : OR seul non pointable produit aussi null', () => {
    const resultat = resoudreCibleReprise(
      [segment({ ligneOrId: null, statutLigne: null, statutOr: 'annule' })],
      MAINTENANT,
    );
    expect(resultat).toBeNull();
  });

  it('cumulSecondesDuJour = somme EXACTE de trois segments productifs sur la MÊME ligne (jamais toBeCloseTo)', () => {
    const resultat = resoudreCibleReprise(
      [
        segment({
          id: 'seg1',
          debutLe: new Date('2026-08-14T08:00:00.000Z'),
          finLe: new Date('2026-08-14T08:37:00.000Z'), // 2220s
        }),
        segment({
          id: 'seg2',
          debutLe: new Date('2026-08-14T09:00:00.000Z'),
          finLe: new Date('2026-08-14T09:12:30.000Z'), // 750s
        }),
        segment({
          id: 'seg3',
          debutLe: new Date('2026-08-14T13:00:00.000Z'),
          finLe: new Date('2026-08-14T13:00:11.000Z'), // 11s
        }),
      ],
      MAINTENANT,
    );
    // 2220 + 750 + 11 = 2981, exact.
    expect(resultat?.cumulSecondesDuJour).toBe(2981);
    expect(Number.isInteger(resultat?.cumulSecondesDuJour)).toBe(true);
  });

  it('type "ligne" : un pointage productif_ligne sur une AUTRE ligne du même OR ne compte JAMAIS dans le cumul', () => {
    const resultat = resoudreCibleReprise(
      [
        segment({
          id: 'ligne-cible',
          ligneOrId: 'l1',
          debutLe: new Date('2026-08-14T08:00:00.000Z'),
          finLe: new Date('2026-08-14T08:10:00.000Z'), // 600s
        }),
        segment({
          id: 'autre-ligne-meme-or',
          ligneOrId: 'l2',
          debutLe: new Date('2026-08-14T07:00:00.000Z'),
          finLe: new Date('2026-08-14T07:30:00.000Z'), // 1800s — ne doit PAS s'additionner
        }),
      ],
      MAINTENANT,
    );
    expect(resultat?.cumulSecondesDuJour).toBe(600);
  });

  it('type "or" : cumule uniquement les segments productif_or du MÊME OR (ligneOrId null), jamais les segments productif_ligne du même OR', () => {
    const resultat = resoudreCibleReprise(
      [
        segment({
          id: 'or-recent',
          ligneOrId: null,
          statutLigne: null,
          debutLe: new Date('2026-08-14T10:00:00.000Z'),
          finLe: new Date('2026-08-14T10:20:00.000Z'), // 1200s
        }),
        segment({
          id: 'or-plus-tot',
          ligneOrId: null,
          statutLigne: null,
          debutLe: new Date('2026-08-14T08:00:00.000Z'),
          finLe: new Date('2026-08-14T08:05:00.000Z'), // 300s
        }),
        segment({
          id: 'ligne-meme-or',
          ligneOrId: 'l1',
          debutLe: new Date('2026-08-14T09:00:00.000Z'),
          finLe: new Date('2026-08-14T09:30:00.000Z'), // 1800s — ne doit PAS s'additionner (nature différente)
        }),
      ],
      MAINTENANT,
    );
    expect(resultat).toMatchObject({ type: 'or', ligneOrId: null });
    expect(resultat?.cumulSecondesDuJour).toBe(1500); // 1200 + 300
  });

  it('type "or" : ligneOrId de la réponse est null (jamais celui d’un segment productif_ligne croisé)', () => {
    const resultat = resoudreCibleReprise(
      [segment({ ligneOrId: null, statutLigne: null })],
      MAINTENANT,
    );
    expect(resultat?.type).toBe('or');
    expect(resultat?.ligneOrId).toBeNull();
  });

  it('libelle = numéro de l’OR quand la ligne n’a pas de désignation saisie (colonne nullable en base)', () => {
    const resultat = resoudreCibleReprise(
      [segment({ designationLigne: null, numeroOr: 'OR-2026-00099' })],
      MAINTENANT,
    );
    expect(resultat?.libelle).toBe('OR-2026-00099');
  });

  it('libelle = numéro de l’OR pour une cible type "or" (pas de ligne à désigner)', () => {
    const resultat = resoudreCibleReprise(
      [segment({ ligneOrId: null, statutLigne: null, numeroOr: 'OR-2026-00050' })],
      MAINTENANT,
    );
    expect(resultat?.libelle).toBe('OR-2026-00050');
  });

  it('tri défensif : la fonction ne suppose pas que l’appelant a trié — le plus récent reste bien sélectionné même en entrée désordonnée', () => {
    const resultat = resoudreCibleReprise(
      [
        segment({
          id: 'ancien',
          debutLe: new Date('2026-08-14T08:00:00.000Z'),
          ligneOrId: 'l-ancien',
        }),
        segment({
          id: 'recent',
          debutLe: new Date('2026-08-14T12:00:00.000Z'),
          ligneOrId: 'l-recent',
        }),
        segment({
          id: 'milieu',
          debutLe: new Date('2026-08-14T10:00:00.000Z'),
          ligneOrId: 'l-milieu',
        }),
      ],
      MAINTENANT,
    );
    expect(resultat?.ligneOrId).toBe('l-recent');
  });

  it('défensif : ordreReparationId null malgré le filtre SQL (ne devrait jamais arriver) n’est jamais promu en cible — null, pas de crash', () => {
    const resultat = resoudreCibleReprise([segment({ ordreReparationId: null })], MAINTENANT);
    expect(resultat).toBeNull();
  });
});
