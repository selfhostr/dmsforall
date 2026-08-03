import { describe, expect, it } from 'vitest';
import type { EntreeDemarragePointage } from '@dfa/shared';
import type { LignePointage } from '../db/schema';
import {
  calculerAgregatsTempsLigne,
  calculerClotureChevauchement,
  calculerDureeArrondieCentiemes,
  chevauchementDoitProduireAnomalie,
  deriveHorlogeAnormale,
  dureeDepasseLeSeuil,
  estLignePointable,
  estOrPointable,
  ligneDevenueNonPointable,
  ligneDoitPasserEnCours,
  orDevenuNonPointable,
  orDoitPasserEnCours,
  pointageCorrespondEntree,
  SEUIL_DERIVE_HORLOGE_MS,
  type LigneOrPourAgregat,
  type PointagePourAgregat,
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

function entreeDemarrage(surcharge: Partial<EntreeDemarragePointage> = {}): EntreeDemarragePointage {
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
  it.each(['planifie', 'ouvert', 'en_cours', 'controle'] as const)('%s reste pointable', (statut) => {
    expect(estOrPointable(statut)).toBe(true);
  });

  it.each(['termine', 'facture', 'restitue', 'cloture', 'annule'] as const)('%s n’est plus pointable', (statut) => {
    expect(estOrPointable(statut)).toBe(false);
  });
});

describe('estLignePointable (RM-93, élargi — voir regles-pointage.ts)', () => {
  it.each(['validee', 'en_cours'] as const)('%s est pointable', (statut) => {
    expect(estLignePointable(statut)).toBe(true);
  });

  it.each(['proposee', 'a_valider', 'refusee', 'annulee', 'realisee', 'facturee'] as const)('%s n’est pas pointable', (statut) => {
    expect(estLignePointable(statut)).toBe(false);
  });
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
    const resultat = calculerClotureChevauchement(ancien, nouveau);
    expect(resultat.finLe).toEqual(nouveau);
    expect(resultat.ordreInverse).toBe(false);
  });

  it('horloge en désordre (nouveau déclaré avant ancien) : ferme sur l’ancien début, signale l’inversion — jamais de durée négative', () => {
    const ancien = new Date('2026-07-31T09:00:00.000Z');
    const nouveau = new Date('2026-07-31T08:00:00.000Z');
    const resultat = calculerClotureChevauchement(ancien, nouveau);
    expect(resultat.finLe).toEqual(ancien);
    expect(resultat.ordreInverse).toBe(true);
    expect(resultat.finLe.getTime()).toBeGreaterThanOrEqual(ancien.getTime());
  });

  it('égalité stricte (même instant) : pas une inversion, durée nulle acceptée', () => {
    const meme = new Date('2026-07-31T08:00:00.000Z');
    const resultat = calculerClotureChevauchement(meme, meme);
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

  it.each(['facture', 'restitue', 'cloture', 'annule'] as const)('OR %s devient non pointable', (statut) => {
    expect(orDevenuNonPointable(statut)).toBe(true);
  });

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
    expect(pointageCorrespondEntree(pointageEnBase(), entreeDemarrage({ technicienId: 'tech2' }))).toBe(false);
  });

  it('une cible différente (autre ligne) est une collision réelle', () => {
    expect(pointageCorrespondEntree(pointageEnBase(), entreeDemarrage({ ligneOrId: 'l2' }))).toBe(false);
  });

  it('une nature différente est une collision réelle', () => {
    const entree = { id: 'p1', siteId: 's1', technicienId: 'tech1', nature: 'productif_or', ordreReparationId: 'or1', debutLe: '2026-07-31T08:00:00.000Z', source: 'ecran_atelier' } as EntreeDemarragePointage;
    expect(pointageCorrespondEntree(pointageEnBase(), entree)).toBe(false);
  });

  it('un debutLe différent est une collision réelle', () => {
    expect(pointageCorrespondEntree(pointageEnBase(), entreeDemarrage({ debutLe: '2026-07-31T09:00:00.000Z' }))).toBe(false);
  });
});

describe('calculerAgregatsTempsLigne (GET /pointages/agregats-ligne)', () => {
  function ligne(surcharge: Partial<LigneOrPourAgregat> = {}): LigneOrPourAgregat {
    return { id: 'l1', ordreReparationId: 'or1', numeroOrdre: 1, tempsBaremeCentiemes: 100, ...surcharge };
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
    const resultat = calculerAgregatsTempsLigne([ligne({ tempsBaremeCentiemes: null })], [pointagePourAgregat()]);
    expect(resultat).toEqual([
      expect.objectContaining({ dureePointeeCentiemes: 50, tempsBaremeCentiemes: null, ecartCentiemes: null }),
    ]);
  });

  it('plusieurs pointages fermés sur la même ligne : la durée pointée est la SOMME', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne()],
      [pointagePourAgregat({ dureeArrondieCentiemes: 50 }), pointagePourAgregat({ dureeArrondieCentiemes: 30, statut: 'valide' })],
    );
    expect(resultat[0]?.dureePointeeCentiemes).toBe(80);
    expect(resultat[0]?.nombrePointages).toBe(2);
  });

  it("un pointage 'en_cours' compte dans nombrePointages/pointageEnCours mais JAMAIS dans la durée (RM-97 : pas encore figée)", () => {
    const resultat = calculerAgregatsTempsLigne([ligne()], [pointagePourAgregat({ statut: 'en_cours', dureeArrondieCentiemes: null })]);
    expect(resultat[0]).toMatchObject({ dureePointeeCentiemes: 0, nombrePointages: 1, pointageEnCours: true });
  });

  it.each(['termine', 'valide', 'verrouille'] as const)("un pointage '%s' EST compté dans la durée acquise", (statut) => {
    const resultat = calculerAgregatsTempsLigne([ligne()], [pointagePourAgregat({ statut, dureeArrondieCentiemes: 25 })]);
    expect(resultat[0]?.dureePointeeCentiemes).toBe(25);
  });

  it('ecartCentiemes = pointé − barémé, positif = dépassement du temps vendu', () => {
    const resultat = calculerAgregatsTempsLigne([ligne({ tempsBaremeCentiemes: 60 })], [pointagePourAgregat({ dureeArrondieCentiemes: 90 })]);
    expect(resultat[0]?.ecartCentiemes).toBe(30);
  });

  it('ecartCentiemes négatif = marge de temps restante (pointé sous le barème)', () => {
    const resultat = calculerAgregatsTempsLigne([ligne({ tempsBaremeCentiemes: 100 })], [pointagePourAgregat({ dureeArrondieCentiemes: 40 })]);
    expect(resultat[0]?.ecartCentiemes).toBe(-60);
  });

  it('un pointage sans ligneOrId (defensif — la requête SQL les exclut déjà) est ignoré sans planter', () => {
    const resultat = calculerAgregatsTempsLigne([ligne()], [pointagePourAgregat({ ligneOrId: null })]);
    expect(resultat[0]?.dureePointeeCentiemes).toBe(0);
    expect(resultat[0]?.nombrePointages).toBe(0);
  });

  it('un pointage sur une ligne absente de la liste (autre OR) est ignoré — jamais une entrée fantôme', () => {
    const resultat = calculerAgregatsTempsLigne([ligne({ id: 'l1' })], [pointagePourAgregat({ ligneOrId: 'l-autre' })]);
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.ligneOrId).toBe('l1');
    expect(resultat[0]?.dureePointeeCentiemes).toBe(0);
  });

  it('résultat trié par numeroOrdre croissant, quel que soit l’ordre d’entrée', () => {
    const resultat = calculerAgregatsTempsLigne(
      [ligne({ id: 'l3', numeroOrdre: 3 }), ligne({ id: 'l1', numeroOrdre: 1 }), ligne({ id: 'l2', numeroOrdre: 2 })],
      [],
    );
    expect(resultat.map((a) => a.ligneOrId)).toEqual(['l1', 'l2', 'l3']);
  });

  it('aucune ligne, aucun pointage : liste vide', () => {
    expect(calculerAgregatsTempsLigne([], [])).toEqual([]);
  });

  it('jamais de flottant en sortie (garde arithmétique temporelle du dépôt)', () => {
    const resultat = calculerAgregatsTempsLigne([ligne({ tempsBaremeCentiemes: 33 })], [pointagePourAgregat({ dureeArrondieCentiemes: 17 })]);
    expect(Number.isInteger(resultat[0]?.dureePointeeCentiemes)).toBe(true);
    expect(Number.isInteger(resultat[0]?.ecartCentiemes)).toBe(true);
  });
});
