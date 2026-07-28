import { describe, expect, it, vi } from 'vitest';
import type { EntreeModificationParametresAtelier } from '@dfa/shared';
import type { AccesBase, ContexteTenant } from '../../db';
import { schema } from '../../db';
import { ServiceParametresAtelier } from './service-parametres-atelier';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

function ligneBrute(champs: Partial<schema.LigneParametreAtelier> = {}): schema.LigneParametreAtelier {
  return {
    tenantId: 'tid',
    orPrefixe: 'OR',
    orPorteeNumerotation: 'tenant',
    orResetAnnuel: true,
    uniteTemps: 'heures_decimales',
    plafondDefautCentimes: 30000,
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
      accesFactice({ ligneUpdate: ligneBrute({ orPrefixe: 'REP' }) }),
    );
    const dto = await service.modifier(CTX, { or: { prefixe: 'REP' } });
    expect(dto.or.prefixe).toBe('REP');
  });

  it('domaine inerte (facturation) : 501 FONCTION_NON_DISPONIBLE, AVANT tout accès base', async () => {
    const acces = accesFactice({});
    const service = new ServiceParametresAtelier(acces);
    const entree: EntreeModificationParametresAtelier = { facturation: { multiPayeursAutorise: true } };

    await expect(service.modifier(CTX, entree)).rejects.toMatchObject({ code: 'FONCTION_NON_DISPONIBLE' });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('controleQualite hors {jamais,toujours} au lot 1 : VALIDATION_ECHOUEE, AVANT tout accès base', async () => {
    const acces = accesFactice({});
    const service = new ServiceParametresAtelier(acces);

    await expect(
      service.modifier(CTX, { travaux: { controleQualite: 'selon_type' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('controleQualite = "toujours" (valeur lot 1 admise) : accepté', async () => {
    const service = new ServiceParametresAtelier(
      accesFactice({ ligneUpdate: ligneBrute({ controleQualite: 'toujours' }) }),
    );
    const dto = await service.modifier(CTX, { travaux: { controleQualite: 'toujours' } });
    expect(dto.travaux.controleQualite).toBe('toujours');
  });

  it('corps sans colonne à écrire : relit l\'état courant sans UPDATE sans SET', async () => {
    const service = new ServiceParametresAtelier(accesFactice({ ligneSelect: ligneBrute() }));
    const dto = await service.modifier(CTX, {});
    expect(dto.or.prefixe).toBe('OR');
  });

  it('ligne disparue entre la validation et le UPDATE : RESSOURCE_INTROUVABLE', async () => {
    const service = new ServiceParametresAtelier(accesFactice({ ligneUpdate: undefined }));
    await expect(service.modifier(CTX, { or: { prefixe: 'X' } })).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});
