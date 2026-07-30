import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneVehiculeKilometrage } from '../db/schema';

/**
 * `ServiceVehiculeTravailReporte.creerDepuisRefus` — port `CreationTravailReporte` (RM-73), la
 * moitié « côté fournisseur » du geste « un client refuse une ligne d'OR -> le garage garde le
 * travail en mémoire pour le passage suivant ». Le port lui-même sera appelé par
 * `atelier/service-ligne-or.ts::refuserLignes` (hors périmètre de cet agent) une fois câblé — ce
 * fichier prouve ce que `vehicules` livre dès aujourd'hui, sans base réelle (fonctions de requête
 * et transaction MOQUÉES, même doctrine que `service-vehicule-kilometrage.spec.ts` et
 * `service-vehicule-contexte-atelier.spec.ts`).
 */
vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  lireDernierKilometrage: vi.fn(),
  listerTravauxReportes: vi.fn(),
}));

import { ServiceVehiculeTravailReporte, type EntreeCreationTravailReporteDepuisRefus } from './service-vehicule-travail-reporte';
import * as vehiculeRequetes from './vehicule-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const AUTRE_TENANT: ContexteTenant = { tenantId: 'tenant-b', utilisateurId: 'user-2', requeteId: 'req-2' };
const VEHICULE_ID = 'vehicule-1';
const MAINTENANT = new Date('2026-07-30T09:15:00.000Z');

const DERNIER_RELEVE: LigneVehiculeKilometrage = {
  id: 'km-1',
  tenantId: 'tenant-a',
  vehiculeId: VEHICULE_ID,
  valeur: 84_500,
  unite: 'km',
  valeurKm: 84_500,
  releveLe: new Date('2026-07-01T08:00:00.000Z'),
  source: 'reception',
  motifRegression: null,
  ordreReparationId: null,
  saisiParId: null,
  creeLe: new Date('2026-07-01T08:00:00.000Z'),
};

function entreeRefus(partiel: Partial<EntreeCreationTravailReporteDepuisRefus> = {}): EntreeCreationTravailReporteDepuisRefus {
  return {
    vehiculeId: VEHICULE_ID,
    ordreReparationId: 'or-1',
    ligneOrId: 'ligne-1',
    designation: 'Plaquettes de frein avant',
    urgence: 'a_surveiller',
    montantEstimeCentimes: 24_000,
    securite: false,
    motifRefus: 'Client reporte au prochain contrôle.',
    ...partiel,
  };
}

/** Fausse transaction : `select(...).from(...).where(...).limit(...)` (recherche de doublon) puis,
 *  si aucun n'existe, `insert(...).values(...)`. */
function txFactice(existantOuvert: readonly { id: string }[]) {
  const limit = vi.fn(async () => existantOuvert);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  return { tx: { select, insert } as unknown as TransactionDfa, select, insert, values };
}

beforeEach(() => {
  vi.mocked(vehiculeRequetes.lireDernierKilometrage).mockResolvedValue(DERNIER_RELEVE);
});

describe('ServiceVehiculeTravailReporte.creerDepuisRefus (RM-73)', () => {
  it('insère un travail reporté OUVERT avec le lien vers la ligne/OR d’origine, le kilométrage courant et l’urgence de la ligne', async () => {
    const { tx, insert, values } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus(), MAINTENANT);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        vehiculeId: VEHICULE_ID,
        designation: 'Plaquettes de frein avant',
        urgence: 'a_surveiller',
        montantEstimeCentimes: 24_000,
        kmConstat: 84_500,
        dateConstat: '2026-07-30',
        ordreReparationOrigineId: 'or-1',
        ligneOrOrigineId: 'ligne-1',
        securite: false,
        statut: 'ouvert',
      }),
    );
  });

  it('retient l’urgence "a_faire" quand la ligne refusée n’en portait aucune (interprétation signalée)', async () => {
    const { insert, values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ urgence: null }), MAINTENANT);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ urgence: 'a_faire' }));
  });

  it('kmConstat reste `null` quand aucun relevé kilométrique n’existe pour le véhicule', async () => {
    vi.mocked(vehiculeRequetes.lireDernierKilometrage).mockResolvedValueOnce(null);
    const { insert, values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus(), MAINTENANT);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ kmConstat: null }));
  });

  it('PERSISTE `motifRefus` dans la colonne dédiée (migrations/0021, vehicule_travail_reporte.motif_refus)', async () => {
    const { values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);
    const motif = 'Client reporte au prochain contrôle technique.';

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ motifRefus: motif }), MAINTENANT);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ motifRefus: motif }));
  });

  it('normalise `motifRefus` en `null` quand il est vide ou blanc — sinon `vehicule_travail_reporte_motif_refus_non_vide_chk` refuserait l’insertion', async () => {
    const { values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ motifRefus: '   ' }), MAINTENANT);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ motifRefus: null }));
  });

  it('`motifRefus` reste `null` quand aucun motif n’a été fourni au refus (schemaRefusLignes.motif est optionnel)', async () => {
    const { values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ motifRefus: null }), MAINTENANT);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ motifRefus: null }));
  });

  it('est IDEMPOTENT : un travail reporté OUVERT déjà lié à cette ligne d’origine bloque une seconde insertion (rejeu de refuser-lignes)', async () => {
    const { tx, insert, select } = txFactice([{ id: 'travail-existant' }]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus(), MAINTENANT);

    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it('scope chaque insertion sur le tenant de SON appelant — deux tenants qui refusent la même ligneOrId (falsification) n’écrivent jamais l’un pour l’autre', async () => {
    // Falsification : rejouer la MÊME `EntreeCreationTravailReporteDepuisRefus` (même `ligneOrId`,
    // même `vehiculeId`) sous DEUX tenants différents. Si `tenantId` venait d'ailleurs qu'`ctx`
    // (paramètre client, valeur par défaut, fuite d'un tenant précédent), les deux lignes insérées
    // porteraient le même `tenantId` — exactement la classe de faille que RM-01 (isolation
    // multi-tenant) interdit.
    const { tx: txA, values: valuesA } = txFactice([]);
    const { tx: txB, values: valuesB } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(txA, CTX, entreeRefus(), MAINTENANT);
    await service.creerDepuisRefus(txB, AUTRE_TENANT, entreeRefus(), MAINTENANT);

    expect(valuesA).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
    expect(valuesB).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-b' }));
  });
});
