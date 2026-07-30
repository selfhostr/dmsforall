import { describe, expect, it } from 'vitest';
import type { schema } from '../../db';
import { versColonnesMiseAJour, versDtoParametresAtelier } from './mappeur-parametres-atelier';

function ligneFactice(champs: Partial<schema.LigneParametreAtelier> = {}): schema.LigneParametreAtelier {
  return {
    tenantId: 'tid',
    orPrefixe: 'OR',
    orPorteeNumerotation: 'tenant',
    orResetAnnuel: true,
    uniteTemps: 'heures_decimales',
    plafondDefautCentimes: 30000,
    plafondAvoirReceptionnaireCentimes: null,
    chevauchementPointageAutorise: false,
    pointageObligatoirePourTerminer: false,
    controleQualite: 'jamais',
    signatureReception: 'recommandee',
    kmEntreeObligatoire: true,
    kmSortieObligatoire: false,
    restitutionAvantPaiement: true,
    multiPayeursAutorise: false,
    arrondiPointage: 'quart',
    orSansRdvAutorise: true,
    rdvRetroactifAuto: false,
    etatPlanifieActif: false,
    langueDocuments: 'client',
    politiqueDemontageRefuse: 'offrir',
    visibiliteHistoriqueNouveauDetenteur: 'technique',
    attentePiecesLongueDefaut: 'A',
    mentionSecurite: 'obligatoire',
    deuxOrMemeVehicule: 'avertir',
    expertiseAlerteMois: 2,
    noShowSeuilAlerte: 2,
    blocageJoursAlerte: 3,
    pointageDureeMaxHeures: 12,
    tamponPretMinutes: 30,
    produitsAtelier: {},
    rabaisMaxParRole: {},
    periodicitesExpertise: {},
    relanceNonRetire: {},
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-07-27T09:14:22.000Z'),
    ...champs,
  } as schema.LigneParametreAtelier;
}

describe('versDtoParametresAtelier', () => {
  it('projette les 4 fonctionnalités gelées, toutes false au lot 1', () => {
    const dto = versDtoParametresAtelier(ligneFactice());
    expect(dto.fonctionnalites).toEqual({
      facturation: false,
      stockPieces: false,
      depotPneus: false,
      prets: false,
    });
  });

  it('version = modifieLe.getTime(), stable pour une même ligne', () => {
    const ligne = ligneFactice();
    const dto1 = versDtoParametresAtelier(ligne);
    const dto2 = versDtoParametresAtelier(ligne);
    expect(dto1.version).toBe(ligne.modifieLe.getTime());
    expect(dto1.version).toBe(dto2.version);
  });

  it('orPrefixe NULL en base devient chaîne vide (jamais null) dans la réponse', () => {
    const dto = versDtoParametresAtelier(ligneFactice({ orPrefixe: null }));
    expect(dto.or.prefixe).toBe('');
  });

  it('plafondDefautCentimes NULL en base (Q-02 : aucun plafond convenu) reste null dans la réponse', () => {
    const dto = versDtoParametresAtelier(ligneFactice({ plafondDefautCentimes: null }));
    expect(dto.reception.plafondDefautCentimes).toBeNull();
  });

  it('plafondDefautCentimes NULL n\'est JAMAIS confondu avec 0 (accord requis pour tout)', () => {
    const dtoNul = versDtoParametresAtelier(ligneFactice({ plafondDefautCentimes: null }));
    const dtoZero = versDtoParametresAtelier(ligneFactice({ plafondDefautCentimes: 0 }));
    expect(dtoNul.reception.plafondDefautCentimes).not.toBe(dtoZero.reception.plafondDefautCentimes);
    expect(dtoZero.reception.plafondDefautCentimes).toBe(0);
  });

  it('plafondAvoirReceptionnaireCentimes NULL en base (RF-117 : aucun plafond convenu) reste null dans la réponse', () => {
    const dto = versDtoParametresAtelier(ligneFactice({ plafondAvoirReceptionnaireCentimes: null }));
    expect(dto.reception.plafondAvoirReceptionnaireCentimes).toBeNull();
  });

  it('plafondAvoirReceptionnaireCentimes NULL n\'est JAMAIS confondu avec 0 (toute émission doit escalader)', () => {
    const dtoNul = versDtoParametresAtelier(ligneFactice({ plafondAvoirReceptionnaireCentimes: null }));
    const dtoZero = versDtoParametresAtelier(ligneFactice({ plafondAvoirReceptionnaireCentimes: 0 }));
    expect(dtoNul.reception.plafondAvoirReceptionnaireCentimes).not.toBe(dtoZero.reception.plafondAvoirReceptionnaireCentimes);
    expect(dtoZero.reception.plafondAvoirReceptionnaireCentimes).toBe(0);
  });

  it('plafondAvoirReceptionnaireCentimes nominal restitué tel quel', () => {
    const dto = versDtoParametresAtelier(ligneFactice({ plafondAvoirReceptionnaireCentimes: 500000 }));
    expect(dto.reception.plafondAvoirReceptionnaireCentimes).toBe(500000);
  });

  it('facturation.piecesClientAutorisees et seuilDemontageCentimes : valeurs par défaut sans colonne', () => {
    const dto = versDtoParametresAtelier(ligneFactice());
    expect(dto.facturation.piecesClientAutorisees).toBe(false);
    expect(dto.facturation.seuilDemontageCentimes).toBeNull();
  });

  it('planning.rappel : valeur par défaut sans colonne (sms, 1 jour avant)', () => {
    const dto = versDtoParametresAtelier(ligneFactice());
    expect(dto.planning.rappel).toEqual({ canal: 'sms', joursAvant: 1 });
  });

  it('produitsAtelier JSONB vide -> mode "desactive" par défaut', () => {
    const dto = versDtoParametresAtelier(ligneFactice({ produitsAtelier: {} }));
    expect(dto.facturation.produitsAtelier).toEqual({ mode: 'desactive', pourmille: null, plafondCentimes: null });
  });

  it('produitsAtelier JSONB rempli -> restitué tel quel', () => {
    const dto = versDtoParametresAtelier(
      ligneFactice({ produitsAtelier: { mode: 'pourcentage_plafonne', pourmille: 30, plafondCentimes: 5000 } }),
    );
    expect(dto.facturation.produitsAtelier).toEqual({ mode: 'pourcentage_plafonne', pourmille: 30, plafondCentimes: 5000 });
  });
});

describe('versColonnesMiseAJour', () => {
  it("corps vide -> aucune colonne", () => {
    expect(versColonnesMiseAJour({})).toEqual({});
  });

  it('ne traduit que les champs présents (undefined omis, pas écrasés à undefined)', () => {
    const colonnes = versColonnesMiseAJour({ or: { prefixe: 'RO' } });
    expect(colonnes).toEqual({ orPrefixe: 'RO' });
    expect('orResetAnnuel' in colonnes).toBe(false);
  });

  it('traduit chaque domaine actif vers ses colonnes camelCase', () => {
    const colonnes = versColonnesMiseAJour({
      reception: { kmEntreeObligatoire: false, plafondDefautCentimes: 50000 },
      travaux: { controleQualite: 'toujours' },
      vehicule: { expertiseAlerteMois: 4 },
    });
    expect(colonnes).toEqual({
      kmEntreeObligatoire: false,
      plafondDefautCentimes: 50000,
      controleQualite: 'toujours',
      expertiseAlerteMois: 4,
    });
  });

  it('traduit reception.plafondAvoirReceptionnaireCentimes (RF-117) vers sa colonne camelCase', () => {
    const colonnes = versColonnesMiseAJour({
      reception: { plafondAvoirReceptionnaireCentimes: 500000 },
    });
    expect(colonnes).toEqual({ plafondAvoirReceptionnaireCentimes: 500000 });
  });

  it('reception.plafondAvoirReceptionnaireCentimes = null (explicite) écrit NULL, pas omis', () => {
    const colonnes = versColonnesMiseAJour({
      reception: { plafondAvoirReceptionnaireCentimes: null },
    }) as Record<string, unknown>;
    expect('plafondAvoirReceptionnaireCentimes' in colonnes).toBe(true);
    expect(colonnes.plafondAvoirReceptionnaireCentimes).toBeNull();
  });

  it('reception.plafondAvoirReceptionnaireCentimes omis : colonne absente (jamais écrasée)', () => {
    const colonnes = versColonnesMiseAJour({
      reception: { kmEntreeObligatoire: true },
    }) as Record<string, unknown>;
    expect('plafondAvoirReceptionnaireCentimes' in colonnes).toBe(false);
  });

  it("n'écrit jamais piecesClientAutorisees ni seuilDemontageCentimes (aucune colonne)", () => {
    const colonnes = versColonnesMiseAJour({
      facturation: { multiPayeursAutorise: true },
    }) as Record<string, unknown>;
    expect('piecesClientAutorisees' in colonnes).toBe(false);
    expect('seuilDemontageCentimes' in colonnes).toBe(false);
  });
});
