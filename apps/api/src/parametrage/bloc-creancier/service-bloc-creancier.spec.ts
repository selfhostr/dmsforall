/**
 * Contrôle d'accès (`direction`/`comptable` seuls, `admin` exclu — `RF-115`) : ce fichier ne le
 * teste PLUS. Il vit désormais exclusivement au niveau du garde (`@ExigerDroit` sur
 * `BlocCreancierController`), pas ici — voir le commentaire de tête de `service-bloc-creancier.ts`.
 * `ServiceBlocCreancier` est atteint uniquement par des appelants déjà autorisés ; ses tests
 * couvrent la logique métier (validation IBAN, upsert), pas le rôle.
 *
 * La garantie « admin ne peut pas toucher à l'IBAN » reste couverte, ailleurs :
 *  - `apps/api/src/auth/matrice-droits.spec.ts` prouve que
 *    `MATRICE_DROITS.admin` ne contient ni `facturation.parametrage.creancier.lire` ni
 *    `.modifier`, et qu'`admin` n'est jamais recopié depuis `direction` sur ce bloc.
 *  - `apps/api/src/common/droits/toutes-les-actions-couvertes.spec.ts` prouve que ces deux actions
 *    sont bien portées par un `@ExigerDroit` réel sur une route montée (pas seulement déclarées
 *    dans la matrice sans contrôle nulle part).
 *  - `apps/api/src/common/droits/toutes-les-routes-decorees.spec.ts` prouve que `GET`/`PATCH` de
 *    `BlocCreancierController` portent chacune un marqueur d'autorisation (ici `@ExigerDroit`, plus
 *    de `@AucunDroitRequis`).
 * Ensemble : la matrice n'accorde pas le droit à `admin`, la route ne peut pas exister sans
 * `@ExigerDroit`, et `GardeDroit` (APP_GUARD global, refus par défaut) applique la matrice à
 * chaque requête AVANT que ce service ne soit atteint.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant } from '../../db';
import { schema } from '../../db';
import { ServiceBlocCreancier } from './service-bloc-creancier';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: 'uid', requeteId: null };

// IBAN de test ISO officiel (créditeur exemple), modulo 97 vérifié = 1, IID 762 (hors plage QR).
const IBAN_ORDINAIRE_VALIDE = 'CH93 0076 2011 6238 5295 7';
// IBAN de test officiel Swiss Implementation Guidelines (exemple QR-IBAN), IID 31999 (borne haute
// incluse de la plage réservée), modulo 97 vérifié = 1.
const QR_IBAN_VALIDE = 'CH44 3199 9123 0008 89012';
// Même IBAN ordinaire, dernier chiffre altéré : modulo 97 vérifié ≠ 1 (28), clé de contrôle fausse.
const IBAN_CLE_FAUSSE = 'CH93 0076 2011 6238 5295 8';

function ligneBrute(champs: Partial<schema.LigneTenantBlocCreancier> = {}): schema.LigneTenantBlocCreancier {
  return {
    id: 'bloc-id',
    tenantId: 'tid',
    nom: 'Garage Martin SA',
    rue: 'Rue de la Gare',
    numero: '12',
    npa: '1000',
    localite: 'Lausanne',
    pays: 'CH',
    iban: 'CH9300762011623852957',
    qrIban: null,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-07-27T09:14:22.000Z'),
    ...champs,
  } as schema.LigneTenantBlocCreancier;
}

/** Fausse `AccesBase` : `select().from().where()` et `insert().values().onConflictDoUpdate().returning()`. */
function accesFactice(options: {
  readonly ligneSelect?: schema.LigneTenantBlocCreancier | undefined;
  readonly ligneUpsert?: schema.LigneTenantBlocCreancier | undefined;
}): AccesBase & { readonly valeursInserees: unknown[] } {
  const valeursInserees: unknown[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(options.ligneSelect ? [options.ligneSelect] : []),
      }),
    }),
    insert: () => ({
      values: (valeurs: unknown) => {
        valeursInserees.push(valeurs);
        return {
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve(options.ligneUpsert ? [options.ligneUpsert] : []),
          }),
        };
      },
    }),
  };
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
    valeursInserees,
  };
}

describe('ServiceBlocCreancier.obtenir', () => {
  it('ligne absente : paramétrage VIDE, jamais RESSOURCE_INTROUVABLE', async () => {
    const service = new ServiceBlocCreancier(accesFactice({ ligneSelect: undefined }));
    const dto = await service.obtenir(CTX);
    expect(dto).toEqual({
      nom: null,
      rue: null,
      numero: null,
      npa: null,
      localite: null,
      pays: 'CH',
      iban: null,
      qrIban: null,
      version: 0,
    });
  });

  it('ligne présente : projetée telle quelle', async () => {
    const service = new ServiceBlocCreancier(accesFactice({ ligneSelect: ligneBrute() }));
    const dto = await service.obtenir(CTX);
    expect(dto.nom).toBe('Garage Martin SA');
    expect(dto.iban).toBe('CH9300762011623852957');
    expect(dto.version).toBe(new Date('2026-07-27T09:14:22.000Z').getTime());
  });
});

describe('ServiceBlocCreancier.modifier', () => {
  it('IBAN ordinaire valide : accepté, normalisé en forme compacte', async () => {
    const acces = accesFactice({ ligneUpsert: ligneBrute({ iban: 'CH9300762011623852957' }) });
    const service = new ServiceBlocCreancier(acces);
    const dto = await service.modifier(CTX, { iban: IBAN_ORDINAIRE_VALIDE });
    expect(dto.iban).toBe('CH9300762011623852957');
    expect(acces.valeursInserees[0]).toMatchObject({ tenantId: 'tid', iban: 'CH9300762011623852957' });
  });

  it('QR-IBAN valide dans le champ qrIban : accepté', async () => {
    const acces = accesFactice({ ligneUpsert: ligneBrute({ qrIban: 'CH4431999123000889012', iban: null }) });
    const service = new ServiceBlocCreancier(acces);
    const dto = await service.modifier(CTX, { qrIban: QR_IBAN_VALIDE });
    expect(dto.qrIban).toBe('CH4431999123000889012');
  });

  it('clé de contrôle modulo 97 fausse : VALIDATION_ECHOUEE, AVANT tout accès base', async () => {
    const acces = accesFactice({});
    const service = new ServiceBlocCreancier(acces);
    await expect(service.modifier(CTX, { iban: IBAN_CLE_FAUSSE })).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('QR-IBAN posé dans le champ "iban" : refusé (les deux colonnes ne se mélangent pas)', async () => {
    const acces = accesFactice({});
    const service = new ServiceBlocCreancier(acces);
    await expect(service.modifier(CTX, { iban: QR_IBAN_VALIDE })).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      erreurs: [expect.objectContaining({ champ: 'iban', code: 'IBAN_EST_UN_QR_IBAN' })],
    });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('IBAN ordinaire posé dans le champ "qrIban" : refusé (symétrique)', async () => {
    const acces = accesFactice({});
    const service = new ServiceBlocCreancier(acces);
    await expect(service.modifier(CTX, { qrIban: IBAN_ORDINAIRE_VALIDE })).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      erreurs: [expect.objectContaining({ champ: 'qrIban', code: 'QR_IBAN_SANS_IID_RESERVE' })],
    });
  });

  it('champ à null : efface la valeur (changement de banque), sans validation IBAN', async () => {
    const acces = accesFactice({ ligneUpsert: ligneBrute({ iban: null }) });
    const service = new ServiceBlocCreancier(acces);
    const dto = await service.modifier(CTX, { iban: null });
    expect(dto.iban).toBeNull();
    expect(acces.valeursInserees[0]).toMatchObject({ iban: null });
  });

  it('corps vide : relit l\'état courant sans upsert', async () => {
    const service = new ServiceBlocCreancier(accesFactice({ ligneSelect: ligneBrute() }));
    const dto = await service.modifier(CTX, {});
    expect(dto.nom).toBe('Garage Martin SA');
  });

  it('numero absent (case postale) reste absent : jamais rendu obligatoire par ce service', async () => {
    const acces = accesFactice({ ligneUpsert: ligneBrute({ numero: null }) });
    const service = new ServiceBlocCreancier(acces);
    const dto = await service.modifier(CTX, { nom: 'Garage Martin SA', numero: null });
    expect(dto.numero).toBeNull();
  });

  it('pays hors CH/LI mal formé (forme zod) n\'atteint jamais ce service — vérifié en amont par schema-bloc-creancier ; ici on vérifie qu\'un pays bien formé passe tel quel', async () => {
    const acces = accesFactice({ ligneUpsert: ligneBrute({ pays: 'LI' }) });
    const service = new ServiceBlocCreancier(acces);
    const dto = await service.modifier(CTX, { pays: 'LI' });
    expect(dto.pays).toBe('LI');
  });
});
