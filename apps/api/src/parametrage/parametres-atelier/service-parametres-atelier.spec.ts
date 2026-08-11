import { describe, expect, it, vi } from 'vitest';
import type { EntreeModificationParametresAtelier } from '@dfa/shared';
import type { AccesBase, ContexteTenant } from '../../db';
import { schema } from '../../db';
import { ServiceParametresAtelier } from './service-parametres-atelier';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

function ligneBrute(
  champs: Partial<schema.LigneParametreAtelier> = {},
): schema.LigneParametreAtelier {
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

/** Fausse `AccesBase` : `select().from().where()` et `update().set().where().returning()`. */
function accesFactice(options: {
  readonly ligneSelect?: schema.LigneParametreAtelier | undefined;
  readonly ligneUpdate?: schema.LigneParametreAtelier | undefined;
}): AccesBase {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(options.ligneSelect ? [options.ligneSelect] : []),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(options.ligneUpdate ? [options.ligneUpdate] : []),
        }),
      }),
    }),
  };
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceParametresAtelier.obtenir', () => {
  it('projette la ligne trouvée', async () => {
    const service = new ServiceParametresAtelier(accesFactice({ ligneSelect: ligneBrute() }));
    const dto = await service.obtenir(CTX);
    expect(dto.or.prefixe).toBe('OR');
    expect(dto.version).toBe(new Date('2026-07-27T09:14:22.000Z').getTime());
  });

  it('ligne absente : RESSOURCE_INTROUVABLE (jamais un objet vide silencieux)', async () => {
    const service = new ServiceParametresAtelier(accesFactice({ ligneSelect: undefined }));
    await expect(service.obtenir(CTX)).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
  });
});

describe('ServiceParametresAtelier.modifier', () => {
  it('domaine actif (or.prefixe) : écrit et rend la ligne mise à jour', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute(),
        ligneUpdate: ligneBrute({ orPrefixe: 'REP' }),
      }),
    );
    const dto = await service.modifier(CTX, 'chef_atelier', { or: { prefixe: 'REP' } });
    expect(dto.or.prefixe).toBe('REP');
  });

  it('reception.plafondAvoirReceptionnaireCentimes (RF-117) : écrit et rend la ligne mise à jour pour direction', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondAvoirReceptionnaireCentimes: null }),
        ligneUpdate: ligneBrute({ plafondAvoirReceptionnaireCentimes: 500000 }),
      }),
    );
    const dto = await service.modifier(CTX, 'direction', {
      reception: { plafondAvoirReceptionnaireCentimes: 500000 },
    });
    expect(dto.reception.plafondAvoirReceptionnaireCentimes).toBe(500000);
  });

  it('reception.plafondAvoirReceptionnaireCentimes (RF-117) : écrit et rend la ligne mise à jour pour comptable', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondAvoirReceptionnaireCentimes: null }),
        ligneUpdate: ligneBrute({ plafondAvoirReceptionnaireCentimes: 500000 }),
      }),
    );
    const dto = await service.modifier(CTX, 'comptable', {
      reception: { plafondAvoirReceptionnaireCentimes: 500000 },
    });
    expect(dto.reception.plafondAvoirReceptionnaireCentimes).toBe(500000);
  });

  it('reception.plafondAvoirReceptionnaireCentimes : `null` explicite remet « aucun plafond convenu » pour direction', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondAvoirReceptionnaireCentimes: 500000 }),
        ligneUpdate: ligneBrute({ plafondAvoirReceptionnaireCentimes: null }),
      }),
    );
    const dto = await service.modifier(CTX, 'direction', {
      reception: { plafondAvoirReceptionnaireCentimes: null },
    });
    expect(dto.reception.plafondAvoirReceptionnaireCentimes).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------
  // Issue #45 / RF-115 / RF-117 : matrice rôle × action pour le plafond d'avoir réceptionnaire.
  // ---------------------------------------------------------------------------------------------

  it('RF-115 (issue #45) — admin est REFUSÉ (DROIT_INSUFFISANT) quand il tente de FIXER le plafond, sans écriture en base', async () => {
    const acces = accesFactice({
      ligneSelect: ligneBrute({ plafondAvoirReceptionnaireCentimes: null }),
    });
    const service = new ServiceParametresAtelier(acces);

    await expect(
      service.modifier(CTX, 'admin', {
        reception: { plafondAvoirReceptionnaireCentimes: 999999 },
      }),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('chef_atelier peut toujours modifier un réglage NON financier (or.prefixe) du même endpoint', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute(),
        ligneUpdate: ligneBrute({ orPrefixe: 'ATL' }),
      }),
    );
    const dto = await service.modifier(CTX, 'chef_atelier', { or: { prefixe: 'ATL' } });
    expect(dto.or.prefixe).toBe('ATL');
  });

  it('chef_atelier est REFUSÉ (DROIT_INSUFFISANT) quand il tente de FIXER le plafond, sans écriture en base', async () => {
    const acces = accesFactice({
      ligneSelect: ligneBrute({ plafondAvoirReceptionnaireCentimes: null }),
    });
    const service = new ServiceParametresAtelier(acces);

    await expect(
      service.modifier(CTX, 'chef_atelier', {
        reception: { plafondAvoirReceptionnaireCentimes: 200000 },
      }),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('resoumettre EXACTEMENT la même valeur de plafond ne déclenche pas la garde (admin peut resoumettre le formulaire sans toucher au plafond)', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondAvoirReceptionnaireCentimes: 300000, orPrefixe: 'OR' }),
        ligneUpdate: ligneBrute({ plafondAvoirReceptionnaireCentimes: 300000, orPrefixe: 'REP' }),
      }),
    );
    const dto = await service.modifier(CTX, 'admin', {
      or: { prefixe: 'REP' },
      reception: { plafondAvoirReceptionnaireCentimes: 300000 },
    });
    expect(dto.or.prefixe).toBe('REP');
  });

  // ---------------------------------------------------------------------------------------------
  // Issue #52 (extension d'issue #45) : `reception.plafondDefautCentimes` — même sémantique
  // documentée que `plafondAvoirReceptionnaireCentimes` (voir `db/schema/atelier/parametrage.ts`),
  // même action `parametrage.atelier.plafond_avoir.modifier`, même population de rôles. Patron de
  // tests identique à celui écrit pour RF-117 ci-dessus.
  // ---------------------------------------------------------------------------------------------

  it('reception.plafondDefautCentimes (issue #52) : écrit et rend la ligne mise à jour pour direction', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondDefautCentimes: 30000 }),
        ligneUpdate: ligneBrute({ plafondDefautCentimes: 500000 }),
      }),
    );
    const dto = await service.modifier(CTX, 'direction', {
      reception: { plafondDefautCentimes: 500000 },
    });
    expect(dto.reception.plafondDefautCentimes).toBe(500000);
  });

  it('reception.plafondDefautCentimes (issue #52) : écrit et rend la ligne mise à jour pour comptable', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondDefautCentimes: 30000 }),
        ligneUpdate: ligneBrute({ plafondDefautCentimes: 500000 }),
      }),
    );
    const dto = await service.modifier(CTX, 'comptable', {
      reception: { plafondDefautCentimes: 500000 },
    });
    expect(dto.reception.plafondDefautCentimes).toBe(500000);
  });

  it('RF-115 (issue #52) — admin est REFUSÉ (DROIT_INSUFFISANT) quand il tente de FIXER plafondDefautCentimes, sans écriture en base', async () => {
    const acces = accesFactice({
      ligneSelect: ligneBrute({ plafondDefautCentimes: 30000 }),
    });
    const service = new ServiceParametresAtelier(acces);

    await expect(
      service.modifier(CTX, 'admin', {
        reception: { plafondDefautCentimes: 777777 },
      }),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
    expect(acces.enTenant).toHaveBeenCalled();
  });

  it('chef_atelier est REFUSÉ (DROIT_INSUFFISANT) quand il tente de FIXER plafondDefautCentimes, sans écriture en base', async () => {
    const acces = accesFactice({
      ligneSelect: ligneBrute({ plafondDefautCentimes: 30000 }),
    });
    const service = new ServiceParametresAtelier(acces);

    await expect(
      service.modifier(CTX, 'chef_atelier', {
        reception: { plafondDefautCentimes: 777777 },
      }),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('resoumettre EXACTEMENT la même valeur de plafondDefautCentimes ne déclenche pas la garde (admin peut resoumettre le formulaire sans toucher au plafond)', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondDefautCentimes: 30000, orPrefixe: 'OR' }),
        ligneUpdate: ligneBrute({ plafondDefautCentimes: 30000, orPrefixe: 'REP' }),
      }),
    );
    const dto = await service.modifier(CTX, 'admin', {
      or: { prefixe: 'REP' },
      reception: { plafondDefautCentimes: 30000 },
    });
    expect(dto.or.prefixe).toBe('REP');
  });

  it('chef_atelier peut toujours modifier un réglage NON financier (or.prefixe) alors que plafondDefautCentimes est présent mais inchangé dans le même corps', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute({ plafondDefautCentimes: 30000 }),
        ligneUpdate: ligneBrute({ plafondDefautCentimes: 30000, orPrefixe: 'ATL' }),
      }),
    );
    const dto = await service.modifier(CTX, 'chef_atelier', {
      or: { prefixe: 'ATL' },
      reception: { plafondDefautCentimes: 30000 },
    });
    expect(dto.or.prefixe).toBe('ATL');
  });

  it('domaine inerte (facturation) : 501 FONCTION_NON_DISPONIBLE, AVANT tout accès base', async () => {
    const acces = accesFactice({});
    const service = new ServiceParametresAtelier(acces);
    const entree: EntreeModificationParametresAtelier = {
      facturation: { multiPayeursAutorise: true },
    };

    await expect(service.modifier(CTX, 'chef_atelier', entree)).rejects.toMatchObject({
      code: 'FONCTION_NON_DISPONIBLE',
    });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('controleQualite hors {jamais,toujours} au lot 1 : VALIDATION_ECHOUEE, AVANT tout accès base', async () => {
    const acces = accesFactice({});
    const service = new ServiceParametresAtelier(acces);

    await expect(
      service.modifier(CTX, 'chef_atelier', { travaux: { controleQualite: 'selon_type' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('controleQualite = "toujours" (valeur lot 1 admise) : accepté', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({
        ligneSelect: ligneBrute(),
        ligneUpdate: ligneBrute({ controleQualite: 'toujours' }),
      }),
    );
    const dto = await service.modifier(CTX, 'chef_atelier', {
      travaux: { controleQualite: 'toujours' },
    });
    expect(dto.travaux.controleQualite).toBe('toujours');
  });

  it("corps sans colonne à écrire : relit l'état courant sans UPDATE sans SET", async () => {
    const service = new ServiceParametresAtelier(accesFactice({ ligneSelect: ligneBrute() }));
    const dto = await service.modifier(CTX, 'chef_atelier', {});
    expect(dto.or.prefixe).toBe('OR');
  });

  it('ligne absente pour ce tenant : RESSOURCE_INTROUVABLE, avant même la vérification du plafond', async () => {
    const service = new ServiceParametresAtelier(accesFactice({ ligneSelect: undefined }));
    await expect(
      service.modifier(CTX, 'chef_atelier', { or: { prefixe: 'X' } }),
    ).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });

  it('ligne disparue entre la lecture et le UPDATE (course concurrente) : RESSOURCE_INTROUVABLE', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({ ligneSelect: ligneBrute(), ligneUpdate: undefined }),
    );
    await expect(
      service.modifier(CTX, 'chef_atelier', { or: { prefixe: 'X' } }),
    ).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});
